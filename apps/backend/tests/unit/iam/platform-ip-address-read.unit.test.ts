import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/platform-ip-address-read.repository", () => ({
  PlatformIpAddressReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/ipblacklist.service", () => ({ IPBlackListService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import {
  Permission,
  iamLegacyPermissionsForAction,
  iamActionsForLegacyPermission,
  getIamResourceType,
} from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformIpAddressReadIamService } from "@/services/system/platform-ip-address-read-iam.service";
import { platformIpAddressArn, platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { platformIpAddressResourceResolver } from "@/iam/request/platform-ip-address-resource-resolvers";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
const ip = "192.0.2.1",
  checkAction = "quyan:system:ip_blacklist:CheckIPAddress",
  errorAction = "quyan:system:ip_blacklist:GetIPAddressErrorStatus";
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  reports = { isIpBlacklisted: vi.fn(), getBlacklistInfo: vi.fn(), getIpErrorStatus: vi.fn() };
const service = new PlatformIpAddressReadIamService(iam, snapshots, repository, permissions, reports);
const target = { id: "ban-one", ipAddress: ip, status: 1, updateTime: new Date(0) };
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: { ip },
    headers: { "x-action": errorAction },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({});
  snapshots.recheck.mockResolvedValue(undefined);
  repository.target.mockResolvedValue(target);
  permissions.checkUserPermissions.mockResolvedValue({
    hasPermission: true,
    checkedPermissions: [Permission.IP_BLACKLIST_READ],
  });
  reports.isIpBlacklisted.mockResolvedValue(true);
  reports.getBlacklistInfo.mockResolvedValue({ ...target, reason: "protected-ban-reason" });
  reports.getIpErrorStatus.mockResolvedValue({
    ipAddress: ip,
    errorWeight: 7,
    errorBreakdown: [{ description: "protected-error" }],
  });
});
afterEach(() => (env.security.iamAuthorizationMode = "enforce"));
describe("specific IP status resource authorization", () => {
  it("declares independent production actions with the legacy read alias", () => {
    for (const action of [checkAction, errorAction]) {
      expect(iamLegacyPermissionsForAction(action)).toEqual([Permission.IP_BLACKLIST_READ]);
      expect(iamActionsForLegacyPermission(Permission.IP_BLACKLIST_READ)).toContain(action);
    }
  });
  it.each([
    ["192.0.2.1", "192.0.2.1"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["::ffff:c000:0201", "192.0.2.1"],
    ["::1", "127.0.0.1"],
    ["0:0:0:0:0:0:0:1", "127.0.0.1"],
    ["2001:0DB8:0:0:0:0:0:1", "2001_db8__1"],
    ["2001:db8::1", "2001_db8__1"],
  ])("normalizes %s to the registered address resource %s", (input, id) => {
    expect(platformIpAddressIdentifier(input)).toBe(id);
    expect(platformIpAddressArn(input)).toBe("acs:platform:*:platform:ip-address/" + id);
    expect(getIamResourceType(platformIpAddressArn(input))!.id).toBe("platform/ip-address");
  });
  it("uses the server Action and omits sensitive status payloads from audit", async () => {
    await service.check(ip, request());
    expect(
      iam.authorize.mock.calls.every(
        ([input]) => input.action === checkAction && input.resource === platformIpAddressArn(ip),
      ),
    ).toBe(true);
    await service.errorStatus(ip, request());
    expect(iam.authorize.mock.calls.at(-1)![0].action).toBe(errorAction);
    expect(JSON.stringify(vi.mocked(auditIamDecision).mock.calls)).not.toContain("protected-");
  });
  it.each([
    "",
    "*",
    "192.0.2.*",
    "192.0.2.1/32",
    "../192.0.2.1",
    "192.0.2.1\n",
    "192.0.2.1 ",
    "fe80::1%eth0",
    "999.0.0.1",
    "name.example",
  ])("refuses an unsafe address %s before any state read", async (input) => {
    expect(platformIpAddressIdentifier(input)).toBeUndefined();
    const req = request();
    req.params.ip = input;
    expect(await platformIpAddressResourceResolver({ request: req, principal: {} as never })).toBeUndefined();
    await expect(service.check(input, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(reports.isIpBlacklisted).not.toHaveBeenCalled();
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("rejects %s before database and lazy-decay reads", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.errorStatus(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
    expect(reports.getIpErrorStatus).not.toHaveBeenCalled();
  });
  it("requires verified platform qualification before reading any IP state", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture revoked"));
    await expect(service.check(ip, request())).rejects.toThrow("fixture revoked");
    expect(reports.isIpBlacklisted).not.toHaveBeenCalled();
  });
  it("permits an explicitly allowed unlisted address and refuses an insertion during the read", async () => {
    repository.target.mockResolvedValue(null);
    reports.isIpBlacklisted.mockResolvedValue(false);
    expect(await service.check(ip, request())).toEqual({ isBlacklisted: false, blacklistInfo: null });
    repository.target.mockResolvedValueOnce(null).mockResolvedValue(target);
    await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    undefined,
    { ...target, status: 0 },
    { ...target, ipAddress: "192.0.2.2" },
    { ...target, updateTime: new Date(NaN) },
  ])("rejects malformed target metadata before payload reads", async (row) => {
    repository.target.mockResolvedValue(row);
    await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(reports.isIpBlacklisted).not.toHaveBeenCalled();
  });
  it("refuses stale, foreign and omitted blacklist payloads", async () => {
    for (const row of [
      null,
      { ...target, id: "other" },
      { ...target, ipAddress: "192.0.2.2" },
      { ...target, updateTime: new Date(1) },
    ]) {
      reports.getBlacklistInfo.mockResolvedValue(row);
      await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("refuses a foreign address in the real-time error response", async () => {
    reports.getIpErrorStatus.mockResolvedValue({ ipAddress: "192.0.2.2" });
    await expect(service.errorStatus(ip, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses policy and qualification changes after reading status", async () => {
    reports.isIpBlacklisted.mockImplementation(async () => {
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return true;
    });
    await expect(service.check(ip, request())).rejects.toThrow("fixture revoked");
  });
  it("detects a changed or deleted ban after the payload read", async () => {
    repository.target.mockResolvedValueOnce(target).mockResolvedValue({ ...target, updateTime: new Date(1) });
    await expect(service.check(ip, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.target.mockResolvedValueOnce(target).mockResolvedValue(null);
    await expect(service.errorStatus(ip, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains one legacy status read in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await service.check(ip, request());
    await service.errorStatus(ip, request());
    expect(reports.isIpBlacklisted).toHaveBeenCalledTimes(1);
    expect(reports.getBlacklistInfo).toHaveBeenCalledTimes(1);
    expect(reports.getIpErrorStatus).toHaveBeenCalledTimes(1);
  });
  it("supports AccessKey and denies OAuth, missing or impersonated contexts", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await expect(service.check(ip, req)).resolves.toBeTruthy();
    req.oauthAccessToken = {} as never;
    await expect(service.check(ip, req)).rejects.toMatchObject({ statusCode: 403 });
    const other = request();
    other.authContext!.principalUserId = "peer";
    await expect(service.check(ip, other)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.check(ip, {} as never)).rejects.toMatchObject({ statusCode: 403 });
  });
});
