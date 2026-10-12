import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/system/platform-ip-whitelist-read-iam.service", () => ({
  PlatformIpWhitelistReadIamService: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/platform-ip-whitelist-write-iam.service", () => ({
  PlatformIpWhitelistWriteIamService: { getInstance: vi.fn() },
}));
import { IPWhiteListService } from "@/services/system/ipwhitelist.service";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
let service: IPWhiteListService,
  repo: any,
  redis: any,
  reads: any,
  permissions: any,
  writes: any,
  business: any,
  request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  repo = {
    findAll: vi.fn().mockResolvedValue({ whitelists: [], total: 0 }),
    isWhitelisted: vi.fn().mockResolvedValue(true),
  };
  redis = { isRedisAvailable: vi.fn().mockReturnValue(true), get: vi.fn().mockResolvedValue("1"), set: vi.fn() };
  reads = { list: vi.fn().mockResolvedValue({ whitelists: [], total: 0 }), status: vi.fn().mockResolvedValue(false) };
  writes = {
    create: vi.fn().mockResolvedValue({ id: "entry", ipAddress: "192.0.2.1", reason: "fixture", expiresAt: null }),
    remove: vi.fn().mockResolvedValue(true),
  };
  business = { logOperation: vi.fn() };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (IPWhiteListService as unknown as new (...args: any[]) => IPWhiteListService)(
    repo,
    redis,
    business,
    reads,
    permissions,
    writes,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session", assumedRoleId: "role" },
    ip: "192.0.2.1",
    headers: {},
  } as unknown as TypedRequest;
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
describe("IP whitelist management mode bridge", () => {
  it("uses resource-scoped native reads and never trusts the old whitelist cache in enforce", async () => {
    expect(await service.isManagedWhitelisted("2001:db8::1", request)).toBe(false);
    await service.listManaged(10, 0, request);
    expect(redis.get).not.toHaveBeenCalled();
    expect(repo.findAll).not.toHaveBeenCalled();
    reads.status.mockRejectedValue(new Error("fixture deny"));
    await expect(service.isManagedWhitelisted("2001:db8::1", request)).rejects.toThrow("fixture deny");
    expect(redis.get).not.toHaveBeenCalled();
  });
  it("retains current-role legacy checks in shadow without loading a second display list", async () => {
    env.security.iamAuthorizationMode = "shadow";
    reads.list.mockRejectedValue(new Error("fixture shadow deny"));
    await service.listManaged(10, 0, request);
    expect(reads.list).toHaveBeenCalledWith(10, 0, request, false);
    expect(repo.findAll).toHaveBeenCalledTimes(1);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.IP_WHITELIST_READ], {
      assumedRoleSessionId: "session",
    });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.listManaged(10, 0, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.findAll).toHaveBeenCalledTimes(1);
  });
  it("routes native mutations to transactional authorization and rejects actor spoofing", async () => {
    await service.addManaged("192.0.2.1", "fixture", "actor", undefined, request);
    await service.removeManaged("192.0.2.1", "actor", request);
    expect(writes.create).toHaveBeenCalledWith("192.0.2.1", "fixture", "actor", undefined, request);
    expect(writes.remove).toHaveBeenCalledWith("192.0.2.1", "actor", request);
    expect(business.logOperation).toHaveBeenCalledTimes(2);
    await expect(service.removeManaged("192.0.2.1", "other", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(writes.remove).toHaveBeenCalledTimes(1);
  });
  it("does not grant expired or revoked records from a cached positive", async () => {
    repo.isWhitelisted.mockResolvedValue(false);
    expect(await service.isWhitelisted("192.0.2.1")).toBe(false);
    expect(repo.isWhitelisted).toHaveBeenCalledWith("192.0.2.1");
    expect(redis.set).toHaveBeenCalledWith("ip:whitelist:192.0.2.1", "0", 60);
  });
  it("does not cache already expired native creations as whitelist grants", async () => {
    repo.isWhitelisted.mockResolvedValue(false);
    writes.create.mockResolvedValue({ id: "entry", ipAddress: "192.0.2.1", reason: "", expiresAt: new Date(0) });
    await service.addManaged("192.0.2.1", "", "actor", new Date(0), request);
    expect(redis.set).toHaveBeenCalledWith("ip:whitelist:192.0.2.1", "0", 60);
  });
  it("preserves committed mutations if the cache is unavailable", async () => {
    redis.set.mockRejectedValue(new Error("fixture cache outage"));
    expect(await service.removeManaged("192.0.2.1", "actor", request)).toBe(true);
    expect(business.logOperation).toHaveBeenCalledTimes(1);
  });
  it("keeps internal anti-abuse whitelist reads independent of management identity", async () => {
    expect(await service.isWhitelisted("192.0.2.1")).toBe(true);
    expect(reads.status).not.toHaveBeenCalled();
    expect(permissions.checkUserPermissions).not.toHaveBeenCalled();
  });
});
