import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/platform-ip-error-weight-mutation.repository", () => ({
  PlatformIpErrorWeightMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/ipblacklist.service", () => ({ IPBlackListService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission, getIamActionDefinition, iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformIpErrorWeightMutationIamService } from "@/services/system/platform-ip-error-weight-mutation-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
const ip = "2001:db8::1",
  setAction = "quyan:system:ip_blacklist:SetIPAddressErrorWeight",
  resetAction = "quyan:system:ip_blacklist:ResetIPAddressErrorWeight";
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { authorizationRevision: vi.fn(), admit: vi.fn() },
  redis = { writeIpErrorWeightWithResult: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  reports = { setIpErrorWeight: vi.fn(), resetIpErrorWeight: vi.fn() };
const service = new PlatformIpErrorWeightMutationIamService(iam, snapshots, repository, redis, permissions, reports);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    headers: { "x-action": resetAction },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.authorizationRevision.mockResolvedValue("a".repeat(64));
  repository.admit.mockImplementation(async (guard, effect) => {
    await guard.users.recheck();
    await effect();
  });
  redis.writeIpErrorWeightWithResult.mockResolvedValue(true);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("IP weight mutation authorization", () => {
  it("registers distinct sensitive Write actions on an IP resource", () => {
    for (const action of [setAction, resetAction]) {
      expect(getIamActionDefinition(action)).toMatchObject({
        accessLevel: "Write",
        resourceTypes: ["platform/ip-address"],
        sensitive: true,
      });
      expect(iamLegacyPermissionsForAction(action)).toEqual([Permission.IP_BLACKLIST_UPDATE]);
    }
  });
  it("ignores a forged Action and confirms one admitted write", async () => {
    const req = request();
    await service.set(ip, 7, req);
    expect(
      iam.authorize.mock.calls.every(
        ([value]) => value.action === setAction && value.resource === platformIpAddressArn(ip),
      ),
    ).toBe(true);
    expect(redis.writeIpErrorWeightWithResult).toHaveBeenCalledExactlyOnceWith(ip, { kind: "set", weight: 7 });
    expect(reports.setIpErrorWeight).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(auditIamDecision).mock.calls)).not.toContain("x-action");
  });
  it("uses an independent reset action", async () => {
    await service.reset(ip, request());
    expect(iam.authorize.mock.calls.at(-1)![0].action).toBe(resetAction);
    expect(redis.writeIpErrorWeightWithResult).toHaveBeenCalledExactlyOnceWith(ip, { kind: "reset" });
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("rejects %s before admission", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    await expect(service.set(ip, 7, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.admit).not.toHaveBeenCalled();
    expect(redis.writeIpErrorWeightWithResult).not.toHaveBeenCalled();
  });
  it("requires real platform qualification before admission", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture qualification revoked"));
    await expect(service.reset(ip, request())).rejects.toThrow();
    expect(redis.writeIpErrorWeightWithResult).not.toHaveBeenCalled();
  });
  it.each(["revision", "qualification", "decision"])("refuses %s changes at admission", async (kind) => {
    repository.admit.mockImplementation(async (guard, effect) => {
      if (kind === "revision") repository.authorizationRevision.mockResolvedValue("b".repeat(64));
      if (kind === "qualification") snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      if (kind === "decision")
        iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] });
      await guard.users.recheck();
      await effect();
    });
    await expect(service.set(ip, 7, request())).rejects.toThrow();
    expect(redis.writeIpErrorWeightWithResult).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, 1_000_001, NaN, Infinity])("rejects invalid weight %s before a write", async (weight) => {
    await expect(service.set(ip, weight, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(redis.writeIpErrorWeightWithResult).not.toHaveBeenCalled();
  });
  it.each(["not-an-ip", "192.0.2.*", ""])("rejects unsafe address %s", async (value) => {
    await expect(service.reset(value, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.admit).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "impersonation"])("rejects %s context", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = "owner";
    await expect(service.reset(ip, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(redis.writeIpErrorWeightWithResult).not.toHaveBeenCalled();
  });
  it.each(["access_key", "assumed_role"])("retains %s identity", async (subjectType) => {
    const req = request();
    req.authContext!.subjectType = subjectType as never;
    if (subjectType === "assumed_role") {
      req.authContext!.assumedRoleId = "role";
      req.authContext!.roleSessionId = "session";
    }
    await service.reset(ip, req);
    expect(iam.authorize.mock.calls.at(-1)![0].principal.subjectType).toBe(subjectType);
  });
  it.each([false, null])("does not claim success for Redis reply %s", async (reply) => {
    redis.writeIpErrorWeightWithResult.mockResolvedValue(reply);
    await expect(service.set(ip, 7, request())).rejects.toMatchObject({
      statusCode: 500,
      messageKey: "ipBlacklist.weightMutationUnavailable",
    });
    expect(redis.writeIpErrorWeightWithResult).toHaveBeenCalledTimes(1);
  });
  it.each(["legacy", "shadow"] as const)("retains original effect in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] });
    await service.set(ip, 0, request());
    await service.reset(ip, request());
    expect(reports.setIpErrorWeight).toHaveBeenCalledExactlyOnceWith(ip, 0);
    expect(reports.resetIpErrorWeight).toHaveBeenCalledExactlyOnceWith(ip);
    expect(redis.writeIpErrorWeightWithResult).not.toHaveBeenCalled();
    expect(repository.admit).not.toHaveBeenCalled();
  });
  it("does not bypass legacy denial in shadow", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.reset(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(reports.resetIpErrorWeight).not.toHaveBeenCalled();
  });
});
