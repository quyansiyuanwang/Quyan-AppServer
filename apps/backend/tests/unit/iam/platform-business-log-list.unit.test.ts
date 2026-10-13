import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-business-log-read.repository", () => ({
  PlatformBusinessLogReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformBusinessLogListIamService } from "@/services/system/platform-business-log-list-iam.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
import type { PlatformCollectionTarget } from "@/store/system/platform-collection.store";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  reports = { mapLogListRows: vi.fn(), getLogs: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformBusinessLogListIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: {},
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
let rows: PlatformCollectionTarget[], denied: Set<string>;
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
  repository.hydrate.mockImplementation(async (page) =>
    page.map((row: PlatformCollectionTarget) => ({ ...row, requestHeaders: { fixture: "allowed-only" } })),
  );
  reports.mapLogListRows.mockImplementation(async (page) =>
    page.map((row: PlatformCollectionTarget) => ({ ...row, username: "fixture" })),
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
    checkedPermissions: [Permission.SYSTEM_BUSINESS_LOG_READ],
  });
  reports.getLogs.mockResolvedValue({ logs: [], total: 99 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("Business log lists authorize before pagination and hydration", () => {
  it("counts allowed records and hydrates only the requested authorized page", async () => {
    const result = await service.list(2, 1, {}, request());
    expect(result.total).toBe(2);
    expect(result.logs.map((log) => log.id)).toEqual([rows[2]!.id]);
    expect(repository.hydrate).toHaveBeenCalledWith([rows[2]]);
    expect(reports.getLogs).not.toHaveBeenCalled();
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:system:business_log:ListLogs")).toBe(
      true,
    );
  });
  it("keeps candidate scans bounded across a denied first batch and a permitted later row", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, index) => target(index));
    denied = new Set(rows.slice(0, -1).map((row) => row.id));
    const req = request(),
      result = await service.list(1, 1, {}, req);
    expect(result.total).toBe(1);
    expect(result.logs.map((row) => row.id)).toEqual([rows[rows.length - 1]!.id]);
    expect(repository.hydrate.mock.calls[0]![0]).toHaveLength(1);
    expect(req.iamDecisions!.length).toBeLessThanOrEqual(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  it("reuses one resolved predicate and a fixed boundary for both scans", async () => {
    await service.list(1, 1, { actor: "name", target: "needle", success: false }, request());
    expect(repository.where).toHaveBeenCalledTimes(1);
    expect(repository.where).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "name", target: "needle", success: false }),
    );
    expect(repository.scan.mock.calls[1]![2]).toEqual({ id: rows[0]!.id, createTime: rows[0]!.createTime });
  });
  it("does not read payloads for denied resources or leak the unfiltered total", async () => {
    denied = new Set(rows.map((row) => row.id));
    expect(await service.list(1, 10, {}, request())).toEqual({ logs: [], total: 0 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("handles a user search with no matches without scanning logs", async () => {
    repository.where.mockResolvedValue(undefined);
    expect(await service.list(1, 10, { actor: "absent" }, request())).toEqual({ logs: [], total: 0 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("rejects a change to an off-page total contribution during hydration", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      rows[2] = { ...rows[2]!, updateTime: new Date(1) };
      return page;
    });
    await expect(service.list(1, 1, {}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not let a backdated insertion into the selected snapshot silently change totals", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      rows.push(target(4));
      return page;
    });
    await expect(service.list(1, 1, {}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains the fixed snapshot when a newer log is appended during hydration", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      rows.unshift(target(0));
      return page;
    });
    expect((await service.list(1, 1, {}, request())).total).toBe(2);
  });
  it("rechecks eligibility after mapping usernames and sizes", async () => {
    reports.mapLogListRows.mockImplementation(async (page) => {
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return page;
    });
    await expect(service.list(1, 1, {}, request())).rejects.toThrow("fixture revoked");
  });
  it("refuses incomplete decisions and stale or mismatched hydration results", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(1, 1, {}, request())).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
    );
    repository.hydrate.mockResolvedValue([{ ...rows[0], updateTime: new Date(1) }]);
    await expect(service.list(1, 1, {}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { page: 0, size: 10, filters: {} },
    { page: 1, size: 101, filters: {} },
    { page: 1, size: 10, filters: { action: "invented" } },
    { page: 1, size: 10, filters: { startDate: new Date(NaN) } },
  ])("rejects invalid inputs before any data reads", async ({ page, size, filters }) => {
    await expect(service.list(page, size, filters as never, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.where).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps exactly one legacy list query in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    expect(await service.list(1, 1, {}, request())).toEqual({ logs: [], total: 99 });
    expect(reports.getLogs).toHaveBeenCalledTimes(1);
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
});
