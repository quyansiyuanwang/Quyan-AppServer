import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/platform-ip-blacklist-collection.repository", () => ({
  PlatformIPBlacklistCollectionRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/ipblacklist.service", () => ({ IPBlackListService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformIPBlacklistListIamService } from "@/services/system/platform-ip-blacklist-list-iam.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
import type { PlatformIPBlacklistTarget } from "@/store/security/platform-ip-blacklist-collection.repository";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrate: vi.fn() },
  reports = { getBlacklist: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformIPBlacklistListIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: {},
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
let rows: PlatformIPBlacklistTarget[], denied: Set<string>;
const target = (index: number) => ({
  id: "log-" + String(index).padStart(5, "0"),
  status: 1,
  ipAddress: "2001:db8::" + index.toString(16),
  createTime: new Date(Date.UTC(2026, 9, 14) - index),
  updateTime: new Date(0),
});
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [target(1), target(2), target(3)];
  denied = new Set([platformIpAddressArn(rows[1]!.ipAddress)]);
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
    page.map((row: PlatformIPBlacklistTarget) => ({ ...row, requestHeaders: { fixture: "allowed-only" } })),
  );
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource: string) => ({
      decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  permissions.checkUserPermissions.mockResolvedValue({
    hasPermission: true,
    checkedPermissions: [Permission.IP_BLACKLIST_READ],
  });
  reports.getBlacklist.mockResolvedValue({ blacklists: [], total: 99 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("IP blacklist lists authorize before pagination and hydration", () => {
  it("counts allowed records and hydrates only the requested authorized page", async () => {
    const result = await service.list(1, 1, request());
    expect(result.total).toBe(2);
    expect(result.blacklists.map((log) => log.id)).toEqual([rows[2]!.id]);
    expect(repository.hydrate).toHaveBeenCalledWith([rows[2]]);
    expect(reports.getBlacklist).not.toHaveBeenCalled();
    expect(
      iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:system:ip_blacklist:ListBlacklists"),
    ).toBe(true);
  });
  it("keeps candidate scans bounded across a denied first batch and a permitted later row", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, index) => target(index));
    denied = new Set(rows.slice(0, -1).map((row) => platformIpAddressArn(row.ipAddress)));
    const req = request(),
      result = await service.list(1, 0, req);
    expect(result.total).toBe(1);
    expect(result.blacklists.map((row) => row.id)).toEqual([rows[rows.length - 1]!.id]);
    expect(repository.hydrate.mock.calls[0]![0]).toHaveLength(1);
    expect(req.iamDecisions!.length).toBeLessThanOrEqual(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  it("reuses one predicate and a fixed boundary for both scans", async () => {
    await service.list(1, 0, request());
    expect(repository.where).toHaveBeenCalledTimes(1);
    expect(repository.where).toHaveBeenCalledWith({});
    expect(repository.scan.mock.calls[1]![2]).toEqual({ id: rows[0]!.id, createTime: rows[0]!.createTime });
  });
  it("does not read payloads for denied resources or leak the unfiltered total", async () => {
    denied = new Set(rows.map((row) => platformIpAddressArn(row.ipAddress)));
    expect(await service.list(10, 0, request())).toEqual({ blacklists: [], total: 0 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects a change to an off-page total contribution during hydration", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      rows[2] = { ...rows[2]!, updateTime: new Date(1) };
      return page;
    });
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not let a backdated insertion into the selected snapshot silently change totals", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      rows.push(target(4));
      return page;
    });
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains the fixed snapshot when a newer log is appended during hydration", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      rows.unshift(target(0));
      return page;
    });
    expect((await service.list(1, 0, request())).total).toBe(2);
  });
  it("rechecks eligibility after reading the allowed page", async () => {
    repository.hydrate.mockImplementation(async (page) => {
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return page;
    });
    await expect(service.list(1, 0, request())).rejects.toThrow("fixture revoked");
  });
  it("rejects malformed address metadata before payload reads", async () => {
    rows[0] = { ...rows[0]!, ipAddress: "192.0.2.*" };
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects equal-time rows with an invalid ID order", async () => {
    rows[1] = { ...rows[1]!, createTime: rows[0]!.createTime };
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses incomplete decisions and stale or mismatched hydration results", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
    );
    repository.hydrate.mockResolvedValue([{ ...rows[0], updateTime: new Date(1) }]);
    await expect(service.list(1, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    [0, 0],
    [101, 0],
    [1, -1],
    [1, 1.5],
  ])("rejects invalid limit %s and offset %s before any data reads", async (limit, offset) => {
    await expect(service.list(limit!, offset!, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.where).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps exactly one legacy list query in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    expect(await service.list(1, 0, request())).toEqual({ blacklists: [], total: 99 });
    expect(reports.getBlacklist).toHaveBeenCalledTimes(1);
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
});
