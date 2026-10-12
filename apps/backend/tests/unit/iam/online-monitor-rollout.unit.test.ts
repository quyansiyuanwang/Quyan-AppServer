import { readFileSync } from "node:fs";
import { Project } from "ts-morph";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mode: "enforce", warn: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/services/system/config.service", () => ({ ConfigService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/ip-geolocation.service", () => ({ IpGeolocationService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user-online-session.repository", () => ({
  UserOnlineSessionRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/user-online-monitor-iam.service", () => ({
  UserOnlineMonitorIamService: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/auth-session", () => ({
  buildForceOfflineAuthSessionKey: vi.fn(),
  extractAuthSessionId: vi.fn(),
  getForceOfflineAuthSessionTtlSeconds: vi.fn(),
  setAuthSessionIdCookie: vi.fn(),
}));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: mocks.warn }), LogCategory: { SECURITY: "security" } }));
import { UserHeartbeatService } from "@/services/users/user-heartbeat.service";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
let service: UserHeartbeatService, repository: any, iam: any, permissions: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "enforce";
  repository = { closeExpiredSessions: vi.fn() };
  iam = {
    overview: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    detail: vi.fn().mockResolvedValue({ userId: "peer" }),
    timeline: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: false }) };
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", roleSessionId: "session" },
    headers: {},
  } as unknown as TypedRequest;
  service = new (UserHeartbeatService as unknown as new (...args: any[]) => UserHeartbeatService)(
    repository,
    { getHeartbeatConfig: vi.fn().mockResolvedValue({ timeoutSeconds: 60 }) },
    {},
    {},
    {},
    {},
    iam,
    permissions,
  );
});
describe("online monitor read rollout", () => {
  it("enforce never enters unscoped legacy queries or expiry mutations", async () => {
    await service.getOverview({ page: 1, pageSize: 10 }, request);
    await service.getUserDetail("peer", request);
    await service.getUserTimeline({ userId: "peer", page: 1, pageSize: 10 }, request);
    expect(iam.overview).toHaveBeenCalledWith({ page: 1, pageSize: 10 }, 60, request);
    expect(iam.detail).toHaveBeenCalledWith("peer", 60, request);
    expect(repository.closeExpiredSessions).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"])(
    "%s checks legacy session-scoped permission before any monitoring mutation",
    async (mode) => {
      mocks.mode = mode;
      await expect(service.getOverview({ page: 1, pageSize: 10 }, request)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.getUserDetail("peer", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.USER_ONLINE_MONITOR_READ], {
        assumedRoleSessionId: "session",
      });
      expect(repository.closeExpiredSessions).not.toHaveBeenCalled();
      expect(iam.overview).not.toHaveBeenCalled();
    },
  );
  it("enforce failures never fall back to global monitoring", async () => {
    iam.detail.mockRejectedValue(new Error("unavailable"));
    await expect(service.getUserDetail("peer", request)).rejects.toThrow("unavailable");
    expect(repository.closeExpiredSessions).not.toHaveBeenCalled();
  });
  it("declares explicit resources on all three monitor read routes", () => {
    const project = new Project({ useInMemoryFileSystem: true }),
      file = "src/api/controllers/v1/users/user-heartbeat.controller.ts";
    const source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    const routes = collectIamRoutes([source], "/backend").filter(
      (r) => r.key.startsWith("GET ") && r.key.includes("/monitor/"),
    );
    expect(routes).toHaveLength(3);
    expect(routes.every((r) => r.coverage === "explicit" && r.issues.length === 0)).toBe(true);
  });
});
