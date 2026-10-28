import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-api-log-read.repository", () => ({
  PlatformApiLogReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/system.service", () => ({ SystemService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformApiLogStatsIamService } from "@/services/system/platform-api-log-stats-iam.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
import type { PlatformApiLogCollectionTarget } from "@/store/system/platform-api-log-read.store";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrateStats: vi.fn() },
  reports = { getLogStats: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformApiLogStatsIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: {},
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
let rows: PlatformApiLogCollectionTarget[], denied: Set<string>;
const target = (index: number) => ({
  id: "log-" + String(index).padStart(5, "0"),
  status: 1,
  createTime: new Date(Date.UTC(2026, 9, 14) - index),
  updateTime: new Date(0),
});
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [target(1), target(2), target(3)];
  denied = new Set([rows[1]!.id]);
  iam.loadPolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({});
  snapshots.recheck.mockResolvedValue(undefined);
  repository.where.mockResolvedValue({ status: 1 });
  repository.scan.mockImplementation(async (_where, after, boundary) =>
    rows
      .filter(
        (row) =>
          (!after ||
            row.createTime < after.createTime ||
            (row.createTime.getTime() === after.createTime.getTime() && row.id < after.id)) &&
          (!boundary ||
            row.createTime < boundary.createTime ||
            (row.createTime.getTime() === boundary.createTime.getTime() && row.id <= boundary.id)),
      )
      .slice(0, IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
  );
  repository.hydrateStats.mockImplementation(async (page) =>
    page.map((row: PlatformApiLogCollectionTarget) => ({
      ...row,
      method: "GET",
      path: "/api/user/123",
      statusCode: row.id === rows[2]?.id ? 503 : 200,
      userID: row.id === rows[2]?.id ? null : "alice",
      ipAddress: "192.0.2.1",
    })),
  );
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource: string) => ({
      decision: denied.has(resource.split("/").pop()!) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  permissions.checkUserPermissions.mockResolvedValue({
    hasPermission: true,
    checkedPermissions: [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ],
  });
  reports.getLogStats.mockResolvedValue({ summary: { totalRequests: 99 } });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("API log statistics authorize every contribution before aggregation", () => {
  it("omits denied rows from all totals, users, addresses and distributions", async () => {
    const result = await service.statistics({}, request());
    expect(result.summary).toEqual({
      totalRequests: 2,
      successRequests: 1,
      redirectRequests: 0,
      clientErrorRequests: 0,
      serverErrorRequests: 1,
      uniqueUsers: 1,
      anonymousRequests: 1,
      uniqueIPs: 1,
    });
    expect(result.byStatusCode).toEqual([
      { key: "200", label: "200", count: 1, share: 50 },
      { key: "503", label: "503", count: 1, share: 50 },
    ]);
    expect(result.byPath).toEqual([{ key: "/api/user/:id", label: "/api/user/:id", count: 2, share: 100 }]);
    expect(repository.hydrateStats).toHaveBeenCalledWith([rows[0], rows[2]]);
    expect(reports.getLogStats).not.toHaveBeenCalled();
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:system:log:GetLogStatistics")).toBe(
      true,
    );
  });
  it("does not hydrate any fields when every contribution is denied", async () => {
    denied = new Set(rows.map((row) => row.id));
    expect((await service.statistics({}, request())).summary.totalRequests).toBe(0);
    expect(repository.hydrateStats).not.toHaveBeenCalled();
  });
  it("aggregates allowed batches without a full payload read and caps attached decisions", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, i) => target(i + 1));
    denied = new Set();
    const req = request();
    expect((await service.statistics({}, req)).summary.totalRequests).toBe(rows.length);
    expect(repository.hydrateStats.mock.calls.map(([batch]) => batch.length)).toEqual([500, 1]);
    expect(repository.scan).toHaveBeenCalledTimes(4);
    expect(req.iamDecisions!.length).toBeLessThanOrEqual(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  it("retains one query and explicit requested date range for both scans", async () => {
    const startDate = new Date("2026-10-13T12:00:00Z"),
      endDate = new Date("2026-10-15T12:00:00Z");
    const result = await service.statistics({ startDate, endDate, method: "GET", search: "needle" }, request());
    expect(repository.where).toHaveBeenCalledTimes(1);
    expect(repository.where).toHaveBeenCalledWith({ startDate, endDate, method: ["GET"], search: "needle" });
    expect(new Date(result.range.startDate).getHours()).toBe(0);
    expect(new Date(result.range.endDate).getHours()).toBe(23);
    expect(result.range.days).toBe(3);
  });
  it("fails closed when a contributing row changes after hydration", async () => {
    const hydrate = repository.hydrateStats.getMockImplementation()!;
    repository.hydrateStats.mockImplementation(async (batch) => {
      const result = await hydrate(batch);
      rows[2] = { ...rows[2]!, updateTime: new Date(1) };
      return result;
    });
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks qualification after reading a batch", async () => {
    const hydrate = repository.hydrateStats.getMockImplementation()!;
    repository.hydrateStats.mockImplementation(async (batch) => {
      const result = await hydrate(batch);
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return result;
    });
    await expect(service.statistics({}, request())).rejects.toThrow("fixture revoked");
  });
  it("rejects stale, omitted, duplicate or foreign hydrated rows", async () => {
    repository.hydrateStats.mockResolvedValue([]);
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.hydrateStats.mockResolvedValue([rows[0], rows[0]]);
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.hydrateStats.mockResolvedValue([{ ...rows[0], updateTime: new Date(1) }, rows[2]]);
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.hydrateStats.mockResolvedValue([rows[0], target(9)]);
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects incomplete decisions before reading statistics fields", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrateStats).not.toHaveBeenCalled();
  });
  it.each([
    { startDate: new Date(NaN) },
    { page: 1 },
    { action: "invented" },
    { startDate: new Date("2026-10-15"), endDate: new Date("2026-10-14") },
  ])("rejects invalid query inputs", async (filters) => {
    await expect(service.statistics(filters as never, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.where).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains exactly one legacy aggregate in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    expect((await service.statistics({}, request())).summary.totalRequests).toBe(99);
    expect(reports.getLogStats).toHaveBeenCalledTimes(1);
    expect(repository.hydrateStats).not.toHaveBeenCalled();
    expect(repository.scan).toHaveBeenCalledTimes(mode === "shadow" ? 1 : 0);
  });
  it("accepts either legacy permission independently and forwards role session", async () => {
    env.security.iamAuthorizationMode = "legacy";
    for (const present of [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ]) {
      permissions.checkUserPermissions.mockResolvedValue({ checkedPermissions: [present], missingPermissions: [] });
      const req = request();
      req.authContext!.roleSessionId = "session";
      await service.statistics({}, req);
    }
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
      "actor",
      [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ],
      { assumedRoleSessionId: "session" },
    );
  });
  it("rejects anonymous, OAuth and unknown mode", async () => {
    const req = request();
    delete req.user;
    await expect(service.statistics({}, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.statistics({}, { ...request(), oauthAccessToken: {} } as TypedRequest)).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "invalid" as never;
    await expect(service.statistics({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
