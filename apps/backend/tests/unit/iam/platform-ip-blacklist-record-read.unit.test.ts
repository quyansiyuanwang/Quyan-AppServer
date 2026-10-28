import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/platform-ip-blacklist-record-read.repository", () => ({
  PlatformIPBlacklistRecordReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/platform-management-principal", () => ({ platformManagementGroupSnapshot: vi.fn() }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission, iamActionsForLegacyPermission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformIPBlacklistRecordReadIamService } from "@/services/system/platform-ip-blacklist-record-read-iam.service";
import { PlatformIPBlacklistRecordReadRepository } from "@/store/security/platform-ip-blacklist-record-read.repository";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { platformIpBlacklistRecordResourceResolver } from "@/iam/request/platform-ip-address-resource-resolvers";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
const action = "quyan:system:ip_blacklist:GetBlacklist",
  target = { id: "ban-one", ipAddress: "192.0.2.1", status: 1, createTime: new Date(0), updateTime: new Date(0) };
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn(), hydrate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformIPBlacklistRecordReadIamService(iam, snapshots, repository, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: { id: target.id },
    headers: { "x-action": "quyan:system:ip_blacklist:ListBlacklists" },
    body: { ipAddress: "192.0.2.9", accountOwnerId: "other" },
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
  repository.hydrate.mockResolvedValue({ ...target, reason: "protected-ban-reason" });
  permissions.checkUserPermissions.mockResolvedValue({
    hasPermission: true,
    checkedPermissions: [Permission.IP_BLACKLIST_READ],
  });
  vi.mocked(PlatformIPBlacklistRecordReadRepository.getInstance).mockReturnValue(repository as never);
  vi.mocked(platformManagementGroupSnapshot).mockResolvedValue({} as never);
});
afterEach(() => (env.security.iamAuthorizationMode = "enforce"));
describe("record IDs resolve to a qualified server-owned IP resource", () => {
  it("uses the registered Action and actual record address despite forged body and headers", async () => {
    expect(iamActionsForLegacyPermission(Permission.IP_BLACKLIST_READ)).toContain(action);
    expect(await platformIpBlacklistRecordResourceResolver({ request: request(), principal: {} as never })).toBe(
      platformIpAddressArn(target.ipAddress),
    );
    const result = await service.read(target.id, request());
    expect(result.id).toBe(target.id);
    expect(repository.hydrate).toHaveBeenCalledWith(target);
    expect(
      iam.authorize.mock.calls.every(
        ([input]) => input.action === action && input.resource === platformIpAddressArn(target.ipAddress),
      ),
    ).toBe(true);
    expect(JSON.stringify(vi.mocked(auditIamDecision).mock.calls)).not.toContain("protected-ban-reason");
  });
  it.each(["", "../ban", "ban/*", "ban\n", "x".repeat(192)])("refuses unsafe record ID %s", async (id) => {
    const req = request();
    req.params.id = id;
    expect(await platformIpBlacklistRecordResourceResolver({ request: req, principal: {} as never })).toBeUndefined();
    await expect(service.read(id, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("requires global qualification before ID metadata is resolved", async () => {
    vi.mocked(platformManagementGroupSnapshot).mockRejectedValue(new Error("fixture unqualified"));
    await expect(
      platformIpBlacklistRecordResourceResolver({ request: request(), principal: {} as never }),
    ).rejects.toThrow("fixture unqualified");
    expect(repository.target).not.toHaveBeenCalled();
    snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
    await expect(service.read(target.id, request())).rejects.toThrow("fixture unqualified");
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("rejects %s before protected hydration", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    await expect(service.read(target.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...target, status: 0 },
    { ...target, id: "peer" },
    { ...target, ipAddress: "*" },
    { ...target, createTime: new Date(NaN) },
  ])("refuses unavailable or invalid source metadata", async (row) => {
    repository.target.mockResolvedValue(row);
    await expect(service.read(target.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...target, id: "peer" },
    { ...target, ipAddress: "192.0.2.9" },
    { ...target, status: 0 },
    { ...target, updateTime: new Date(1) },
  ])("rejects omitted, stale or foreign hydrated records", async (row) => {
    repository.hydrate.mockResolvedValue(row);
    await expect(service.read(target.id, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks the address, version and qualification after reading details", async () => {
    repository.target.mockResolvedValueOnce(target).mockResolvedValue({ ...target, ipAddress: "192.0.2.9" });
    await expect(service.read(target.id, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.target.mockResolvedValue(target);
    repository.hydrate.mockImplementation(async () => {
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return target;
    });
    await expect(service.read(target.id, request())).rejects.toThrow("fixture revoked");
  });
  it.each(["legacy", "shadow"] as const)("returns one qualified detail read in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    expect((await service.read(target.id, request())).id).toBe(target.id);
    expect(repository.hydrate).toHaveBeenCalledTimes(1);
    expect(permissions.checkUserPermissions).toHaveBeenCalledTimes(1);
  });
  it("returns a localized missing-record error in legacy without a wildcard fallback", async () => {
    env.security.iamAuthorizationMode = "legacy";
    repository.target.mockResolvedValue(null);
    await expect(service.read(target.id, request())).rejects.toMatchObject({
      statusCode: 404,
      messageKey: "ipBlacklist.recordNotFound",
    });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("supports AccessKey but denies OAuth, missing and impersonated contexts", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await expect(service.read(target.id, req)).resolves.toBeTruthy();
    req.oauthAccessToken = {} as never;
    await expect(service.read(target.id, req)).rejects.toMatchObject({ statusCode: 403 });
    const peer = request();
    peer.authContext!.principalUserId = "peer";
    await expect(service.read(target.id, peer)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.read(target.id, {} as never)).rejects.toMatchObject({ statusCode: 403 });
  });
});
