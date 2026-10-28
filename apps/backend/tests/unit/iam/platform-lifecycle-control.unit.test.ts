import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-lifecycle-history.repository", () => ({
  PlatformLifecycleHistoryRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/system/platform-lifecycle-control.repository", () => ({
  PlatformLifecycleControlRepository: { getInstance: vi.fn() },
}));
import { PlatformLifecycleControlIamService } from "@/services/system/platform-lifecycle-control-iam.service";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformLifecycleControlIamService, iam: any, repo: any, snapshots: any, request: TypedRequest<any>;
beforeEach(() => {
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
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
  repo = {
    policyTarget: vi.fn().mockResolvedValue({ id: "policy", dataset: "api_logs", status: 1, updateTime: new Date(0) }),
    scheduleTargets: vi.fn().mockResolvedValue([]),
    updatePolicy: vi.fn(),
    updateSchedule: vi.fn(),
  };
  service = new (PlatformLifecycleControlIamService as any)(iam, snapshots, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest<any>;
});
describe("lifecycle control mutation authorization", () => {
  it("registers independent write actions and preserves 2FA and replay in both routes", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true }),
      file = p.addSourceFileAtPath("src/api/controllers/v1/system/data-lifecycle.controller.ts");
    for (const [key, operation, method] of [
      ["PUT /v1/data-lifecycle/policies/{dataset}", "UpdatePolicy", "updatePolicy"],
      ["PUT /v1/data-lifecycle/schedule", "UpdateSchedule", "updateSchedule"],
    ]) {
      const action = "quyan:system:data_lifecycle:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        accessLevel: "Write",
        sensitive: true,
        authorizationBoundary: "platform",
      });
      expect(collectIamRoutes(p.getSourceFiles(), process.cwd()).find((r) => r.key === key)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      const text = file.getClassOrThrow("DataLifecycleController").getMethodOrThrow(method).getText();
      for (const marker of [
        "ReplayProtected",
        "TwoFactorChallengeProtected",
        "replayProtectionMiddleware",
        "twoFactorChallengeMiddleware",
      ])
        expect(text).toContain(marker);
    }
  });
  it("prepares a trusted user/group guard using fixed server action and dataset", async () => {
    const guard = (await service.prepare("quyan:system:data_lifecycle:UpdatePolicy", request, "api_logs"))!;
    expect(guard).toMatchObject({
      action: "quyan:system:data_lifecycle:UpdatePolicy",
      dataset: "api_logs",
      policy: { id: "policy" },
      users: { targetUserId: "actor" },
    });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "acs:platform:*:platform:lifecycle-dataset/api_logs" }),
    );
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.updatePolicy).not.toHaveBeenCalled();
  });
  it("uses one schedule resource and no client specified config keys", async () => {
    const guard = (await service.prepare("quyan:system:data_lifecycle:UpdateSchedule", request))!;
    expect(guard).toMatchObject({
      action: "quyan:system:data_lifecycle:UpdateSchedule",
      configs: [],
      dataset: undefined,
    });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "acs:platform:*:platform:lifecycle-schedule/default" }),
    );
    expect(repo.policyTarget).not.toHaveBeenCalled();
  });
  it("fails before targets on Deny, unknown actions or untrusted identity", async () => {
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny" });
    await expect(
      service.prepare("quyan:system:data_lifecycle:UpdatePolicy", request, "api_logs"),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("*" as any, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.prepare("quyan:system:data_lifecycle:UpdateSchedule", request, "api_logs"),
    ).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.prepare("quyan:system:data_lifecycle:UpdateSchedule", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.policyTarget).not.toHaveBeenCalled();
    expect(repo.scheduleTargets).not.toHaveBeenCalled();
  });
  it("rejects disabled policies/configs and snapshot revocation without modifying data", async () => {
    repo.policyTarget.mockResolvedValue({ id: "policy", dataset: "api_logs", status: 0 });
    await expect(
      service.prepare("quyan:system:data_lifecycle:UpdatePolicy", request, "api_logs"),
    ).rejects.toMatchObject({ statusCode: 403 });
    repo.scheduleTargets.mockResolvedValue([{ status: 0 }]);
    await expect(service.prepare("quyan:system:data_lifecycle:UpdateSchedule", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    snapshots.recheck.mockRejectedValue(new Error("revoked"));
    await expect(service.prepare("quyan:system:data_lifecycle:UpdateSchedule", request)).rejects.toThrow("revoked");
    expect(repo.updateSchedule).not.toHaveBeenCalled();
  });
  it("shadow validates metadata without writing or issuing a native guard", async () => {
    expect(
      await service.prepare("quyan:system:data_lifecycle:UpdatePolicy", request, "api_logs", false),
    ).toBeUndefined();
    expect(repo.updatePolicy).not.toHaveBeenCalled();
  });
});
