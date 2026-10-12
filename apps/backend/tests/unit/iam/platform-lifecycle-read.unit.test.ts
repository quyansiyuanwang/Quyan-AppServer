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
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/system/platform-lifecycle-history.repository", () => ({
  PlatformLifecycleHistoryRepository: { getInstance: vi.fn() },
}));
import { env } from "@/config/env";
import { getIamActionDefinition, getIamResourceType } from "@quyan/shared";
import { PlatformLifecycleReadIamService } from "@/services/system/platform-lifecycle-read-iam.service";
import {
  platformLifecycleDatasetArn,
  platformLifecycleScheduleArn,
} from "@/iam/resources/platform-lifecycle-resources";
import {
  platformLifecycleDatasetResourceResolver,
  platformLifecycleScheduleResourceResolver,
} from "@/iam/request/platform-lifecycle-resource-resolvers";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const action = "quyan:system:data_lifecycle:ListPolicies" as const;
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
let service: PlatformLifecycleReadIamService, iam: any, snapshots: any, permissions: any, request: TypedRequest<any>;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global" }, users: [] }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (PlatformLifecycleReadIamService as any)(iam, snapshots, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { dataset: "api_logs" },
    query: { action: "*", accountId: "foreign" },
  } as unknown as TypedRequest<any>;
});
describe("lifecycle read resource authorization", () => {
  it("registers four independent server actions and binds all read routes", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/data-lifecycle.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [key, operation, type] of [
      ["GET /v1/data-lifecycle/policies", "ListPolicies", "lifecycle-dataset"],
      ["GET /v1/data-lifecycle/schedule", "GetSchedule", "lifecycle-schedule"],
      ["GET /v1/data-lifecycle/policies/{dataset}/preview", "PreviewPolicy", "lifecycle-dataset"],
      ["GET /v1/data-lifecycle/policies/{dataset}/candidates", "ListCandidates", "lifecycle-dataset"],
    ]) {
      const registered = "quyan:system:data_lifecycle:" + operation;
      expect(getIamActionDefinition(registered)).toMatchObject({
        authorizationBoundary: "platform",
        resourceTypes: ["platform/" + type],
      });
      expect(routes.find((r) => r.key === key)).toMatchObject({
        coverage: "explicit",
        actions: [registered],
        issues: [],
      });
    }
    expect(getIamResourceType(platformLifecycleScheduleArn())).toMatchObject({ accountScope: "platform" });
  });
  it("extracts only the registered dataset and never client action or account", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformLifecycleDatasetResourceResolver({ request, principal })).toBe(
      "acs:platform:*:platform:lifecycle-dataset/api_logs",
    );
    expect(await platformLifecycleScheduleResourceResolver({ request, principal })).toBe(
      "acs:platform:*:platform:lifecycle-schedule/default",
    );
    for (const dataset of ["unknown", "*", "API_LOGS", "api_logs/../server_logs"]) {
      request.params.dataset = dataset;
      expect(await platformLifecycleDatasetResourceResolver({ request, principal })).toBeUndefined();
    }
    expect(platformLifecycleDatasetArn("server_logs")).toContain("lifecycle-dataset/server_logs");
  });
  it("filters before work and reevaluates every resource contributing to the response", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, deny]).mockResolvedValueOnce([allow]);
    const work = vi.fn(async (allowed: ReadonlySet<string>) => [...allowed]);
    expect(await service.readDatasets(action, ["api_logs", "business_logs"], request, work)).toEqual(["api_logs"]);
    expect(iam.authorizeMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action,
        resources: [platformLifecycleDatasetArn("api_logs"), platformLifecycleDatasetArn("business_logs")],
      }),
    );
    expect(iam.authorizeMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action, resources: [platformLifecycleDatasetArn("api_logs")] }),
    );
    expect(snapshots.recheck).toHaveBeenCalledTimes(2);
    expect(permissions.checkUserPermissions).not.toHaveBeenCalled();
  });
  it("returns no authorized datasets for a denied list but never executes denied single-resource work", async () => {
    iam.authorizeMany.mockResolvedValue([deny]);
    expect(await service.readDatasets(action, ["api_logs"], request, async (allowed) => [...allowed])).toEqual([]);
    const work = vi.fn();
    await expect(
      service.readDatasets("quyan:system:data_lifecycle:PreviewPolicy", ["api_logs"], request, work),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.readSchedule(request, work)).rejects.toMatchObject({ statusCode: 403 });
    expect(work).not.toHaveBeenCalled();
  });
  it("rejects unknown action, dataset, malformed decision and untrusted contexts without work", async () => {
    const work = vi.fn();
    for (const datasets of [[], ["*"], ["unknown"]])
      await expect(service.readDatasets(action, datasets, request, work)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.readDatasets("*" as any, ["api_logs"], request, work)).rejects.toMatchObject({
      statusCode: 403,
    });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.readDatasets(action, ["api_logs"], request, work)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.readSchedule(request, work)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.readSchedule(undefined, work)).rejects.toMatchObject({ statusCode: 403 });
    expect(work).not.toHaveBeenCalled();
  });
  it("does not release previously computed data after final Deny or snapshot revocation", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([deny]);
    await expect(
      service.readDatasets(action, ["api_logs"], request, async () => ({ count: 12 })),
    ).rejects.toMatchObject({ statusCode: 403 });
    snapshots.recheck.mockRejectedValueOnce(new Error("revoked"));
    await expect(service.readSchedule(request, async () => ({ time: "03:20" }))).rejects.toThrow("revoked");
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps %s enforcement and executes the legacy read only once",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      iam.authorizeMany.mockResolvedValue([deny]);
      const work = vi.fn(async (allowed: ReadonlySet<string>) => [...allowed]);
      expect(await service.readDatasets(action, ["api_logs"], request, work)).toEqual(["api_logs"]);
      expect(work).toHaveBeenCalledTimes(1);
      expect(permissions.checkUserPermissions).toHaveBeenCalledTimes(1);
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.readDatasets(action, ["api_logs"], request, work)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(work).toHaveBeenCalledTimes(1);
    },
  );
});
