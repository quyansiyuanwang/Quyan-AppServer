import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/security/platform-ip-monitoring-dashboard.repository", () => ({
  PlatformIpMonitoringDashboardRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/system/ipblacklist.service", () => ({ IPBlackListService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { PlatformIpMonitoringDashboardIamService } from "@/services/system/platform-ip-monitoring-dashboard-iam.service";
import type { IpDashboardTarget } from "@/store/security/platform-ip-monitoring-dashboard.store";
import { platformIpAddressArn } from "@/iam/resources/platform-ip-address-resources";
import type { TypedRequest } from "@/types/express";
const action = "quyan:system:ip_blacklist:GetMonitoringDashboard",
  ip = "192.0.2.1";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrateBans: vi.fn() },
  reports = { getMonitoringDashboard: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformIpMonitoringDashboardIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:system:ip_blacklist:ListBlacklists" },
    secure: true,
  }) as unknown as TypedRequest;
let rows: IpDashboardTarget[];
const row = (source: "ban" | "event", id: string, address = ip): IpDashboardTarget => ({
  id: source + "_" + id,
  recordId: id,
  source,
  ipAddress: address,
  status: 1,
  createTime: new Date(Date.now() - 60000),
  updateTime: new Date(Date.now() - 60000),
  ...(source === "ban" ? { banLevel: 2, banType: "auto", expireTime: new Date(Date.now() + 3600000) } : {}),
});
const hydrated = (targets: readonly IpDashboardTarget[]) =>
  targets.map((target) => ({
    id: target.recordId,
    ipAddress: target.ipAddress,
    status: 1,
    createTime: target.createTime,
    updateTime: target.updateTime,
    banLevel: target.banLevel!,
    banType: target.banType!,
    ExpireTime: target.expireTime!,
    reason: "allowed reason",
    bannedBy: "fixture",
    triedAccounts: 0,
  }));
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [row("event", "event-one"), row("ban", "ban-one")];
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async (input) =>
    input.resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({});
  snapshots.recheck.mockResolvedValue(undefined);
  repository.where.mockImplementation(async (input) => input);
  repository.scan.mockImplementation(async (_where, after, boundary) =>
    rows
      .filter(
        (value) =>
          (!after ||
            value.createTime < after.createTime ||
            (value.createTime.getTime() === after.createTime.getTime() && value.id < after.id)) &&
          (!boundary ||
            value.createTime < boundary.createTime ||
            (value.createTime.getTime() === boundary.createTime.getTime() && value.id <= boundary.id)),
      )
      .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, 500)
      .map((value) => ({ ...value })),
  );
  repository.hydrateBans.mockImplementation(async (targets) => hydrated(targets));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  reports.getMonitoringDashboard.mockResolvedValue({ legacy: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("IP monitoring contribution authorization", () => {
  it("registers a separate sensitive read action with real platform qualification", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "Read",
      resourceTypes: ["platform/ip-address"],
      legacyPermission: Permission.IP_BLACKLIST_READ,
      sensitive: true,
    });
  });
  it("authorizes both sources by actual IP before computing the response", async () => {
    const result = await service.read(request());
    expect(result.activeBans).toMatchObject({
      total: 1,
      byLevel: { level1: 0, level2: 1, level3: 0 },
      byType: { auto: 1, manual: 0 },
    });
    expect(result.recentActivity).toMatchObject({ last24Hours: 1, last7Days: 1 });
    expect(result.topBannedIPs).toMatchObject([{ ipAddress: ip, banCount: 1, currentStatus: "banned" }]);
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) =>
          input.action === action && input.resources.every((resource: string) => resource === platformIpAddressArn(ip)),
      ),
    ).toBe(true);
  });
  it.each(["ImplicitDeny", "ExplicitDeny"])(
    "excludes %s contributions and never reads their details",
    async (decision) => {
      iam.authorizeMany.mockImplementation(async (input) =>
        input.resources.map(() => ({ decision, reason: "fixture", matchedStatements: [] })),
      );
      const result = await service.read(request());
      expect(result.activeBans.total).toBe(0);
      expect(result.activeBans.recentBans).toEqual([]);
      expect(result.recentActivity.last7Days).toBe(0);
      expect(result.topBannedIPs).toEqual([]);
      expect(repository.hydrateBans).not.toHaveBeenCalled();
    },
  );
  it("filters hidden IPs before totals and rankings", async () => {
    rows.push(row("ban", "ban-hidden", "192.0.2.2"), row("event", "event-hidden", "192.0.2.2"));
    iam.authorizeMany.mockImplementation(async (input) =>
      input.resources.map((resource: string) => ({
        decision: resource === platformIpAddressArn(ip) ? "Allow" : "ExplicitDeny",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    const result = await service.read(request());
    expect(result.activeBans.total).toBe(1);
    expect(result.recentActivity.last7Days).toBe(1);
    expect(JSON.stringify(result)).not.toContain("192.0.2.2");
    expect(repository.hydrateBans.mock.calls[0]![0]).toHaveLength(1);
  });
  it("samples authorized events after scanning all contribution batches", async () => {
    rows = Array.from({ length: 1005 }, (_, index) => row("event", "event-" + String(index).padStart(4, "0")));
    const result = await service.read(request());
    expect(result.recentActivity.last7Days).toBe(1005);
    expect(result.recentActivity.timeline.reduce((sum, item) => sum + item.count, 0)).toBe(1000);
    expect(result.topBannedIPs[0]!.banCount).toBe(1000);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.resources.length <= 500)).toBe(true);
  });
  it("detects changed classification even when the row timestamp is unchanged", async () => {
    repository.hydrateBans.mockImplementation(async (targets) => {
      const result = hydrated(targets);
      rows.find((value) => value.source === "ban")!.banLevel = 3;
      return result;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards both-source results when an event disappears during detail hydration", async () => {
    repository.hydrateBans.mockImplementation(async (targets) => {
      rows = rows.filter((value) => value.source !== "event");
      return hydrated(targets);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses unsafe event addresses without a wildcard fallback", async () => {
    rows[0]!.ipAddress = "invalid";
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrateBans).not.toHaveBeenCalled();
  });
  it("requires qualification before scanning", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture revoked"));
    await expect(service.read(request())).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("rejects incomplete decision batches", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "oauth", "impersonation"])("refuses %s context", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = "owner";
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "retains the original response without native hydration in %s",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      expect(await service.read(request())).toEqual({ legacy: true });
      expect(reports.getMonitoringDashboard).toHaveBeenCalledTimes(1);
      expect(repository.hydrateBans).not.toHaveBeenCalled();
    },
  );
});
