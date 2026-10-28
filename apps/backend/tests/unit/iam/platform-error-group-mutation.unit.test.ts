import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-error-group-mutation.repository", () => ({
  PlatformErrorGroupMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/error-report.service", () => ({ ErrorReportService: { getInstance: vi.fn() } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformErrorGroupMutationIamService } from "@/services/system/platform-error-group-mutation-iam.service";
import { getIamActionDefinition, isKnownIamAction, IAM_ACTION_DEFINITIONS } from "@quyan/shared";
import { env } from "@/config/env";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const action = "quyan:system:error_report:UpdateErrorGroupStatus",
  get = "quyan:system:error_report:GetErrorGroup";
const body = { resolutionStatus: "resolved" as const },
  target = { id: "error-id", status: 1, updateTime: new Date(0), resolutionStatus: "open" };
let service: PlatformErrorGroupMutationIamService,
  iam: any,
  snapshots: any,
  repository: any,
  permissions: any,
  reports: any,
  request: any;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", matchedStatements: [] }),
  };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({
      group: { id: "global", updateTime: new Date(0) },
      users: [
        { id: "actor", updateTime: new Date(0) },
        { id: "owner", updateTime: new Date(0) },
      ],
    }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  repository = {
    target: vi.fn().mockResolvedValue(target),
    authorizationRevision: vi.fn().mockResolvedValue("a".repeat(64)),
    update: vi.fn(async (guard: any, input: any) => {
      await guard.users.recheck();
      return { ...target, ...input, message: "fixture error" };
    }),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  reports = {
    getGroup: vi.fn().mockResolvedValue(target),
    updateGroupStatus: vi.fn().mockResolvedValue({ ...target, ...body, message: "fixture error" }),
  };
  service = new (PlatformErrorGroupMutationIamService as any)(iam, snapshots, repository, permissions, reports);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: target.id },
    headers: { "x-action": "*" },
  };
});
describe("error group guarded status updates", () => {
  it("registers mandatory read dependency without granting it automatically", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["platform/error-group"],
      requiredActions: [get],
      authorizationBoundary: "platform",
      sensitive: true,
    });
    for (const definition of IAM_ACTION_DEFINITIONS)
      for (const dependency of definition.requiredActions ?? []) {
        expect(isKnownIamAction(dependency)).toBe(true);
        expect(dependency).not.toBe(definition.action);
      }
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/error-report.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "PUT /v1/error-reports/{id}/status")).toMatchObject({
      actions: [action],
      coverage: "explicit",
      issues: [],
    });
    expect(routes.filter((r) => !r.key.includes("/client")).every((r) => r.coverage === "explicit")).toBe(true);
  });
  it("checks both actions before writing and supplies a persisted revision guard", async () => {
    expect(await service.update(target.id, body, request)).toMatchObject({
      resolutionStatus: "resolved",
      message: "fixture error",
    });
    expect(iam.authorize.mock.calls.map(([r]: any) => r.action)).toEqual([action, get, action, get, action, get]);
    expect(
      iam.authorize.mock.calls.every(([r]: any) => r.resource === "acs:platform:*:platform:error-group/error-id"),
    ).toBe(true);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        action,
        target,
        authorizationRevision: "a".repeat(64),
        users: expect.objectContaining({ targetUserId: "actor" }),
      }),
      body,
    );
    expect(reports.getGroup).not.toHaveBeenCalled();
  });
  it.each([action, get])("does not write or hydrate a summary if %s is denied", async (denied) => {
    iam.authorize.mockImplementation(async ({ action: current }: any) => ({
      decision: current === denied ? "ExplicitDeny" : "Allow",
      matchedStatements: [],
    }));
    await expect(service.update(target.id, body, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(reports.getGroup).not.toHaveBeenCalled();
  });
  it.each([null, { ...target, id: "other" }, { ...target, status: 0 }, { ...target, updateTime: new Date("invalid") }])(
    "refuses unavailable metadata %j",
    async (row) => {
      repository.target.mockResolvedValue(row);
      await expect(service.update(target.id, body, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it.each([{}, { resolutionStatus: "unknown" }, { ...body, accountOwnerId: "other" }])(
    "rejects malformed status %j",
    async (input) => {
      await expect(service.update(target.id, input as any, request)).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it("refuses either missing platform eligibility even when policies Allow", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture missing eligibility"));
    await expect(service.update(target.id, body, request)).rejects.toThrow("fixture missing eligibility");
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("propagates authorization failure from the commit guard", async () => {
    repository.update.mockImplementation(async (guard: any) => {
      iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", matchedStatements: [] });
      await guard.users.recheck();
      return "unreachable";
    });
    await expect(service.update(target.id, body, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves %s enforcement and existing full response", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", matchedStatements: [] });
    expect(await service.update(target.id, body, request)).toMatchObject({ message: "fixture error" });
    expect(reports.updateGroupStatus).toHaveBeenCalledExactlyOnceWith(target.id, "resolved");
    expect(repository.update).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.update(target.id, body, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(reports.updateGroupStatus).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "oauth", "principal", "id", "mode"])("fails closed on %s", async (kind) => {
    let id = target.id;
    if (kind === "missing") delete request.authContext;
    if (kind === "oauth") request.oauthAccessToken = {};
    if (kind === "principal") request.authContext.principalUserId = "other";
    if (kind === "id") id = "../other";
    if (kind === "mode") env.security.iamAuthorizationMode = "invalid" as any;
    await expect(service.update(id, body, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
});
