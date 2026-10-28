import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
import { env } from "@/config/env";
import { PlatformMaintenancePreviewIamService } from "@/services/system/platform-maintenance-preview-iam.service";
import {
  platformMaintenanceDatasetBatchResourceResolver,
  platformMaintenanceDatasetResourceResolver,
} from "@/iam/request/platform-maintenance-resource-resolvers";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const action = "quyan:system:data_maintenance:PreviewOptimize" as const;
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
let service: PlatformMaintenancePreviewIamService,
  iam: any,
  repo: any,
  permissions: any,
  request: TypedRequest<any>,
  read: any;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "platform" }, users: [] }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (PlatformMaintenancePreviewIamService as any)(iam, repo, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { dataset: "api_logs" },
    body: { datasets: ["api_logs", "business_logs"] },
  } as unknown as TypedRequest<any>;
  read = vi.fn().mockResolvedValue({ totalRows: 2 });
});
describe("maintenance dataset preview authorization", () => {
  it("declares separate real dataset actions and validates the entire batch resolver", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/data-maintenance.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [path, op] of [
      ["optimize/preview", "PreviewOptimize"],
      ["imports/preview/{dataset}", "PreviewImport"],
    ]) {
      const name = "quyan:system:data_maintenance:" + op;
      expect(getIamActionDefinition(name)).toMatchObject({
        resourceTypes: ["platform/maintenance-dataset"],
        authorizationBoundary: "platform",
        accessLevel: "Read",
      });
      expect(routes.find((r) => r.key === "POST /v1/data-maintenance/" + path)).toMatchObject({
        coverage: "explicit",
        actions: [name],
        issues: [],
      });
    }
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformMaintenanceDatasetBatchResourceResolver({ request, principal })).toEqual([
      "acs:platform:*:platform:maintenance-dataset/api_logs",
      "acs:platform:*:platform:maintenance-dataset/business_logs",
    ]);
    request.body = { datasets: ["api_logs", "invalid"] };
    expect(await platformMaintenanceDatasetBatchResourceResolver({ request, principal })).toBeUndefined();
    expect(await platformMaintenanceDatasetResourceResolver({ request, principal })).toBe(
      "acs:platform:*:platform:maintenance-dataset/api_logs",
    );
    request.params.dataset = "ai_request_logs";
    expect(await platformMaintenanceDatasetResourceResolver({ request, principal })).toBeUndefined();
  });
  it("requires all dataset grants, deduplicates targets and invokes reads once", async () => {
    expect(await service.read(action, ["api_logs", "api_logs"], request, read)).toEqual({ totalRows: 2 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action, resources: ["acs:platform:*:platform:maintenance-dataset/api_logs"] }),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(repo.recheck).toHaveBeenCalledTimes(2);
  });
  it("does not call the read when any dataset is denied or decisions are incomplete", async () => {
    iam.authorizeMany.mockResolvedValue([allow, deny]);
    await expect(service.read(action, ["api_logs", "business_logs"], request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    iam.authorizeMany.mockResolvedValue([allow]);
    await expect(service.read(action, ["api_logs", "business_logs"], request, read)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects unsupported datasets, actions, malformed identity and multi-dataset import", async () => {
    for (const datasets of [[], ["*"], ["ai_request_logs"], ["server_logs"], ["api_logs/foreign"]])
      await expect(service.read(action, datasets, request, read)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.read("quyan:system:data_maintenance:PreviewImport", ["api_logs", "business_logs"], request, read),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.read("quyan:system:data_maintenance:GetRun" as any, ["api_logs"], request, read),
    ).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.read(action, ["api_logs"], request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects final revoked grants or platform snapshot changes instead of returning data", async () => {
    read.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([deny]);
      return { totalRows: 2 };
    });
    await expect(service.read(action, ["api_logs"], request, read)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValue([allow]);
    read.mockResolvedValue({});
    repo.recheck.mockRejectedValue(new Error("fixture revoked"));
    await expect(service.read(action, ["api_logs"], request, read)).rejects.toThrow("fixture revoked");
  });
  it.each(["legacy", "shadow"] as const)("preserves original reads once in %s despite IAM denial", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockResolvedValue([deny]);
    expect(await service.read(action, ["api_logs"], request, read)).toEqual({ totalRows: 2 });
    expect(read).toHaveBeenCalledTimes(1);
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.read(action, ["api_logs"], request, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("fails closed on IAM availability and does not run work without an authenticated principal", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.read(action, ["api_logs"], request, read)).rejects.toThrow("fixture unavailable");
    await expect(service.read(action, ["api_logs"], undefined, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
});
