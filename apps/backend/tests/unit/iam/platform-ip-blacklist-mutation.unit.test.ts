import { RECORD_STATUS } from "@/constant/status";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/platform-ip-blacklist-mutation.repository", () => ({
  PlatformIpBlacklistMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/ipblacklist", () => ({ IPBlackListRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/system/ipblacklist.service", () => ({ IPBlackListService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformIpBlacklistMutationIamService } from "@/services/system/platform-ip-blacklist-mutation-iam.service";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { platformIpBlacklistMutationResourceResolver } from "@/iam/request/platform-ip-address-resource-resolvers";
import type { TypedRequest } from "@/types/express";
const action = "quyan:system:ip_blacklist:UpdateBlacklist",
  ip = "192.0.2.1",
  target = { id: "ban-one", ipAddress: ip, status: 1, updateTime: new Date(0) };
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { authorizationRevision: vi.fn(), target: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = { findByIpAnyStatus: vi.fn(), update: vi.fn() };
const reports = { manualBan: vi.fn(), unban: vi.fn(), logManualBan: vi.fn(), logManualUnban: vi.fn() };
const service = new PlatformIpBlacklistMutationIamService(iam, snapshots, repository, permissions, legacy, reports);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { ipAddress: ip },
    headers: { "x-action": "quyan:system:ip_blacklist:GetBlacklist" },
    body: { Resource: "*" },
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
  repository.target.mockResolvedValue(target);
  repository.update.mockImplementation(async (row, input, guard) => {
    await guard.users.recheck();
    return { ...row, ...input };
  });
  repository.create.mockImplementation(async (row, input, guard) => {
    await guard.users.recheck();
    return { ...target, ipAddress: input.ipAddress, reason: input.reason };
  });
  repository.remove.mockImplementation(async (row, guard) => {
    await guard.users.recheck();
    return true;
  });
  reports.manualBan.mockResolvedValue(target);
  reports.unban.mockResolvedValue(true);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.findByIpAnyStatus.mockResolvedValue(target);
  legacy.update.mockResolvedValue(target);
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("blacklist record update resource authorization", () => {
  it("declares a separate sensitive Write action and qualified IP resolver", async () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["platform/ip-address"],
      legacyPermission: Permission.IP_BLACKLIST_UPDATE,
      sensitive: true,
    });
    const req = request();
    expect(
      await platformIpBlacklistMutationResourceResolver({
        request: req,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe(platformIpAddressArn(ip));
  });
  it("uses the fixed action and validated fields only", async () => {
    await service.update(ip, { banReason: "fixture", expireTime: "2027-01-01T00:00:00Z" }, request());
    expect(
      iam.authorize.mock.calls.every(
        ([value]) => value.action === action && value.resource === platformIpAddressArn(ip),
      ),
    ).toBe(true);
    expect(repository.update.mock.calls[0]![1]).toEqual({
      reason: "fixture",
      expireTime: new Date("2027-01-01T00:00:00Z"),
    });
    expect(legacy.update).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("refuses %s before writing", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    await expect(service.update(ip, { banReason: "fixture" }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...target, status: RECORD_STATUS.DELETED },
    { ...target, ipAddress: "192.0.2.2" },
    { ...target, updateTime: new Date(NaN) },
  ])("refuses missing or unsafe metadata %#", async (row) => {
    repository.target.mockResolvedValue(row);
    await expect(service.update(ip, {}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([{ expireTime: "invalid" }, { banReason: "x".repeat(501) }, { status: 1 }, { Resource: "*" }])(
    "rejects invalid update input %#",
    async (body) => {
      await expect(service.update(ip, body, request())).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it("rechecks revocation immediately before writing", async () => {
    repository.update.mockImplementation(async (row, input, guard) => {
      repository.authorizationRevision.mockResolvedValue("b".repeat(64));
      await guard.users.recheck();
      return { ...row, ...input };
    });
    await expect(service.update(ip, {}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy.update).not.toHaveBeenCalled();
  });
  it("requires platform eligibility before reading the record", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture qualification revoked"));
    await expect(service.update(ip, {}, request())).rejects.toThrow();
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "impersonation", "invalid-ip"])("refuses %s", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = "owner";
    await expect(service.update(kind === "invalid-ip" ? "192.0.2.*" : ip, {}, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each(["access_key", "assumed_role"])("supports %s with the same action", async (kind) => {
    const req = request();
    req.authContext!.subjectType = kind as never;
    if (kind === "assumed_role") {
      req.authContext!.assumedRoleId = "role";
      req.authContext!.roleSessionId = "session";
    }
    await service.update(ip, {}, req);
    expect(iam.authorize.mock.calls[0]![0].principal.subjectType).toBe(kind);
  });
  it.each(["legacy", "shadow"] as const)("retains the existing update in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    repository.target.mockResolvedValue(null);
    await service.update(ip, { banReason: "fixture" }, request());
    expect(legacy.update).toHaveBeenCalledExactlyOnceWith(target.id, { reason: "fixture" });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("retains a legacy missing-record 404", async () => {
    env.security.iamAuthorizationMode = "legacy";
    legacy.findByIpAnyStatus.mockResolvedValue(null);
    await expect(service.update(ip, {}, request())).rejects.toMatchObject({
      statusCode: 404,
      messageKey: "ipBlacklist.recordNotFound",
    });
  });
});

describe("manual ban and unban resource authorization", () => {
  const createAction = "quyan:system:ip_blacklist:CreateBlacklist",
    deleteAction = "quyan:system:ip_blacklist:DeleteBlacklist";
  it("creates on the prospective IP and audits only after confirmed commit", async () => {
    repository.target.mockResolvedValue(null);
    await service.create({ ipAddress: ip, duration: 60, reason: "fixture" }, request());
    expect(
      iam.authorize.mock.calls.every(
        ([value]) => value.action === createAction && value.resource === platformIpAddressArn(ip),
      ),
    ).toBe(true);
    expect(repository.create.mock.calls[0]![2].users.principal.subjectUserId).toBe("actor");
    expect(reports.logManualBan).toHaveBeenCalledExactlyOnceWith(ip, 60, "fixture", "actor", expect.anything());
    expect(reports.manualBan).not.toHaveBeenCalled();
  });
  it("uses a separate Delete action without deleting weights", async () => {
    await service.remove(ip, request());
    expect(iam.authorize.mock.calls[0]![0].action).toBe(deleteAction);
    expect(repository.remove).toHaveBeenCalledTimes(1);
    expect(reports.logManualUnban).toHaveBeenCalledTimes(1);
    expect(reports.unban).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("refuses %s on both writes", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    await expect(service.create({ ipAddress: ip, duration: 60 }, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(reports.logManualBan).not.toHaveBeenCalled();
    expect(reports.logManualUnban).not.toHaveBeenCalled();
  });
  it("does not audit success after a transaction failure", async () => {
    repository.create.mockRejectedValue(new Error("fixture transaction failed"));
    repository.remove.mockRejectedValue(new Error("fixture transaction failed"));
    await expect(service.create({ ipAddress: ip, duration: 60 }, request())).rejects.toThrow();
    await expect(service.remove(ip, request())).rejects.toThrow();
    expect(reports.logManualBan).not.toHaveBeenCalled();
    expect(reports.logManualUnban).not.toHaveBeenCalled();
  });
  it("refuses missing/deleted unban targets even with Allow", async () => {
    repository.target.mockResolvedValue(null);
    await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.target.mockResolvedValue({ ...target, status: RECORD_STATUS.DELETED });
    await expect(service.remove(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it.each([-2, 1.5, Number.MAX_SAFE_INTEGER])("rejects invalid duration %s", async (duration) => {
    await expect(service.create({ ipAddress: ip, duration }, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains original ban/unban effects in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await service.create({ ipAddress: ip, duration: -1 }, request());
    await service.remove(ip, request());
    expect(reports.manualBan).toHaveBeenCalledExactlyOnceWith(ip, -1, "手动封禁", "actor", expect.anything());
    expect(reports.unban).toHaveBeenCalledExactlyOnceWith(ip, "actor", expect.anything());
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(reports.logManualBan).not.toHaveBeenCalled();
  });
});
