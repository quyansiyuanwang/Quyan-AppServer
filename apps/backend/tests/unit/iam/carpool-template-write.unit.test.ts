import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformCarpoolTemplateWriteIamService } from "@/services/billing/platform-carpool-template-write-iam.service";
import { platformTemplateArn, platformCarpoolTemplateControlArn } from "@/iam/resources/platform-template-resources";
import {
  platformCarpoolTemplateCreateResources,
  platformCarpoolTemplateUpdateResources,
} from "@/iam/request/platform-carpool-template-write-resource-resolvers";
import {
  IAM_CARPOOL_TEMPLATE_WRITE_OPERATIONS,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  Permission,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { findTemplate: vi.fn(), findActiveMonthlyPassTemplate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformCarpoolTemplateWriteIamService(iam, repository, snapshots, permissions),
  mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "template" },
    body: { monthlyPassTemplateId: "monthly", accountId: "attacker" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.findTemplate.mockResolvedValue({ id: "template", status: 1, name: "Fixture" });
  repository.findActiveMonthlyPassTemplate.mockResolvedValue({ id: "monthly", status: 1, defaultQuota: 100 });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("carpool template write authority", () => {
  it("declares every real endpoint with an independent platform Action", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/carpool.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const entry of IAM_CARPOOL_TEMPLATE_WRITE_OPERATIONS) {
      const action = "quyan:carpool:" + entry.operation;
      expect(routes.find((row) => row.key === entry.route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      expect(getIamActionDefinition(action)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: Permission.CARPOOL_TEMPLATE_WRITE,
      });
      expect(isIamActionResourceCompatible(action, platformTemplateArn("carpool", "template"))).toBe(true);
      expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
    }
  });
  it.each(["CreateTemplate", "UpdateTemplate"] as const)(
    "authorizes %s and the monthly-pass source before hydration",
    async (operation) => {
      const source = await service.prepare(
        operation,
        "actor",
        request(),
        operation === "CreateTemplate" ? undefined : "template",
        "monthly",
      );
      expect(source?.guard.monthlySource?.record.id).toBe("monthly");
      const sourceCall = iam.authorize.mock.calls.findIndex(
        ([input]) => input.resource === platformTemplateArn("monthly-pass", "monthly"),
      );
      expect(sourceCall).toBeGreaterThanOrEqual(0);
      expect(iam.authorize.mock.invocationCallOrder[sourceCall]).toBeLessThan(
        repository.findActiveMonthlyPassTemplate.mock.invocationCallOrder[0]!,
      );
      expect(iam.authorize.mock.calls.every(([input]) => input.action === "quyan:carpool:" + operation)).toBe(true);
    },
  );
  it("checks duplicate source, collection control and generated resource", async () => {
    const result = await service.prepare("DuplicateTemplate", "actor", request(), "template");
    await result!.guard.recheckEntry("new-template");
    for (const resource of [
      platformCarpoolTemplateControlArn(),
      platformTemplateArn("carpool", "template"),
      platformTemplateArn("carpool", "new-template"),
    ])
      expect(iam.authorize.mock.calls.some(([input]) => input.resource === resource)).toBe(true);
    expect(repository.findActiveMonthlyPassTemplate).not.toHaveBeenCalled();
  });
  it("does not hydrate denied source snapshots", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", matchedStatements: [] });
    await expect(service.prepare("UpdateTemplate", "actor", request(), "template", "monthly")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.findTemplate).not.toHaveBeenCalled();
    expect(repository.findActiveMonthlyPassTemplate).not.toHaveBeenCalled();
  });
  it("constructs platform resources independently from account and Action overrides", async () => {
    const context = { request: request(), principal: {} as never };
    expect(await platformCarpoolTemplateCreateResources(context)).toEqual([
      platformCarpoolTemplateControlArn(),
      platformTemplateArn("monthly-pass", "monthly"),
    ]);
    expect(await platformCarpoolTemplateUpdateResources(context)).toEqual([
      platformTemplateArn("carpool", "template"),
      platformTemplateArn("monthly-pass", "monthly"),
    ]);
    const invalid = {
      ...context,
      request: { ...request(), body: { monthlyPassTemplateId: "../invalid" } } as unknown as TypedRequest,
    };
    expect(await platformCarpoolTemplateUpdateResources(invalid)).toBeUndefined();
  });
  it("fails closed on missing context, invalid operation inputs and unavailable management ceiling", async () => {
    await expect(service.prepare("CreateTemplate", "actor", undefined, undefined, "monthly")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("ArchiveTemplate", "actor", request(), "../invalid")).rejects.toMatchObject({
      statusCode: 403,
    });
    snapshots.snapshot.mockRejectedValue(new Error("fixture disabled ceiling"));
    await expect(service.prepare("PublishTemplate", "actor", request(), "template")).rejects.toThrow();
    expect(repository.findTemplate).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy enforcement in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    iam.authorize.mockRejectedValue(new Error("fixture unavailable"));
    expect(await service.prepare("ArchiveTemplate", "actor", request(), "template")).toBeUndefined();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
      "actor",
      [Permission.CARPOOL_TEMPLATE_WRITE],
      expect.anything(),
    );
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.prepare("ArchiveTemplate", "actor", request(), "template")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
