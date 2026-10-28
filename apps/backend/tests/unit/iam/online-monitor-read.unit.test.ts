import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user-online-monitor.repository", () => ({
  UserOnlineMonitorRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { UserOnlineMonitorIamService } from "@/services/users/user-online-monitor-iam.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const target = { id: "session", userId: "peer", status: 1, createTime: new Date(0), updateTime: new Date(0) };
const userTarget = { id: "peer", updateTime: new Date(0) };
const view = {
  id: "session",
  userId: "peer",
  authSessionId: "fixture-session",
  startedAt: new Date(Date.now() - 10000),
  lastHeartbeatAt: new Date(),
  endedAt: null,
  durationSeconds: null,
  lastIpAddress: "127.0.0.1",
  lastLocation: "fixture",
  userAgent: "fixture",
  user: { username: "peer", name: null },
};
let iam: any, repository: any, request: TypedRequest, service: UserOnlineMonitorIamService;
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    query: { accountOwnerId: "foreign" },
  } as unknown as TypedRequest;
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi
      .fn()
      .mockImplementation(async ({ resources }: { resources: string[] }) => resources.map(() => allow)),
  };
  repository = {
    userTarget: vi.fn().mockResolvedValue(userTarget),
    scan: vi.fn().mockResolvedValue([target]),
    hydrate: vi.fn().mockResolvedValue([view]),
    detail: vi.fn().mockResolvedValue({ userId: "peer", totalSessions: 1 }),
  };
  service = new (UserOnlineMonitorIamService as unknown as new (...args: any[]) => UserOnlineMonitorIamService)(
    iam,
    repository,
  );
});
describe("account-scoped online monitoring", () => {
  it("registers sensitive session and user resources without self grants", () => {
    expect(getIamActionDefinition("quyan:user:ListOnlineSessions")).toMatchObject({
      resourceTypes: ["quyan/online-session"],
      sensitive: true,
    });
    expect(getIamActionDefinition("quyan:user:GetOnlineUser")).toMatchObject({ resourceTypes: ["quyan/user"] });
    expect(getIamActionDefinition("quyan:user:GetOnlineUserTimeline")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.USER_ONLINE_MONITOR_READ)).toContain(
      "quyan:user:ListOnlineSessions",
    );
  });
  it("authorizes exact sessions before hydrating IP or browser information and before response", async () => {
    expect((await service.overview({ page: 1, pageSize: 10 }, 60, request)).items).toHaveLength(1);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:user:ListOnlineSessions",
        resources: ["acs:quyan:*:owner:online-session/peer/session"],
      }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(repository.hydrate).toHaveBeenCalledWith(expect.objectContaining({ accountOwnerId: "owner" }), [target]);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("%s hides rows, counts and aggregate statistics", async (decision) => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map(() => ({ ...allow, decision })),
    );
    repository.hydrate.mockResolvedValue([]);
    const result = await service.overview({ page: 1, pageSize: 10 }, 60, request);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.stats.onlineUsers).toBe(0);
    expect(repository.hydrate).toHaveBeenCalledWith(expect.anything(), []);
  });
  it("revoked permission filters previously hydrated sessions", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([{ ...allow, decision: "ExplicitDeny" }]);
    const result = await service.overview({ page: 1, pageSize: 10 }, 60, request);
    expect(result.items).toEqual([]);
    expect(result.stats.activeSessions).toBe(0);
  });
  it("expired sessions are treated as offline without any write", async () => {
    repository.hydrate.mockResolvedValue([{ ...view, lastHeartbeatAt: new Date(Date.now() - 120000) }]);
    const result = await service.overview({ page: 1, pageSize: 10 }, 60, request);
    expect(result.items[0].isOnline).toBe(false);
    expect(result.items[0].endedAt).toBeDefined();
    expect(result.stats).toMatchObject({ onlineUsers: 0, offlineUsers: 1, activeSessions: 0 });
  });
  it("stats count distinct visible users and multiple active sessions accurately", async () => {
    const second = { ...target, id: "second", createTime: new Date(-1) };
    repository.scan.mockResolvedValue([target, second]);
    repository.hydrate.mockResolvedValue([view, { ...view, id: "second" }]);
    expect((await service.overview({ page: 1, pageSize: 1 }, 60, request)).stats).toMatchObject({
      onlineUsers: 1,
      activeSessions: 2,
    });
  });
  it("pages and filters after authorization without hidden-resource totals", async () => {
    expect(await service.overview({ page: 2, pageSize: 1 }, 60, request)).toMatchObject({
      items: [],
      total: 1,
      page: 2,
    });
    expect((await service.overview({ page: 1, pageSize: 10, keyword: "missing" }, 60, request)).total).toBe(0);
  });
  it("timeline requires a current account user and checks each actual session", async () => {
    const result = await service.timeline({ userId: "peer", page: 1, pageSize: 10 }, 60, request);
    expect(result.groups.online).toHaveLength(1);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:user:GetOnlineUserTimeline",
        resources: ["acs:quyan:*:owner:online-session/peer/session"],
      }),
    );
    repository.userTarget.mockResolvedValue(null);
    await expect(service.timeline({ userId: "foreign", page: 1, pageSize: 10 }, 60, request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("details require user-level permission before reading aggregated session and identity data", async () => {
    await service.detail("peer", 60, request);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:GetOnlineUser", resources: ["acs:quyan:*:owner:user/peer"] }),
    );
    expect(repository.detail).toHaveBeenCalledWith(expect.anything(), userTarget, expect.any(Date));
    iam.authorizeMany.mockResolvedValue([{ ...allow, decision: "ExplicitDeny" }]);
    repository.detail.mockClear();
    await expect(service.detail("peer", 60, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.detail).not.toHaveBeenCalled();
  });
  it("blocks changed owner or user revisions before releasing details", async () => {
    repository.userTarget
      .mockResolvedValueOnce(userTarget)
      .mockResolvedValueOnce({ ...userTarget, updateTime: new Date(1) });
    await expect(service.detail("peer", 60, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { page: 0, pageSize: 10 },
    { page: 1, pageSize: 501 },
    { page: 1.5, pageSize: 10 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 500 },
  ])("rejects malformed pagination before reads", async (params) => {
    await expect(service.overview(params, 60, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("rejects invalid date/status filters before session reads", async () => {
    await expect(
      service.timeline({ userId: "peer", page: 1, pageSize: 10, startDate: "invalid" }, 60, request),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.timeline({ userId: "peer", page: 1, pageSize: 10, onlineOnly: true, offlineOnly: true }, 60, request),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each([
    { targets: [target, target] },
    { targets: [{ ...target, userId: "*" }] },
    { targets: [{ ...target, status: 0 }] },
    { targets: [{ ...target, id: "bad/id" }] },
  ])("rejects unsafe scans", async ({ targets }) => {
    repository.scan.mockResolvedValue(targets);
    await expect(service.overview({ page: 1, pageSize: 10 }, 60, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects mismatched hydrated rows and incomplete decision arrays", async () => {
    repository.hydrate.mockResolvedValue([{ ...view, userId: "foreign" }]);
    await expect(service.overview({ page: 1, pageSize: 10 }, 60, request)).rejects.toMatchObject({ statusCode: 403 });
    repository.hydrate.mockClear();
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.overview({ page: 1, pageSize: 10 }, 60, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("fails closed for missing identity and policy outages", async () => {
    await expect(service.overview({ page: 1, pageSize: 10 }, 60)).rejects.toMatchObject({ statusCode: 403 });
    iam.loadPolicies.mockRejectedValue(new Error("fixture outage"));
    await expect(service.detail("peer", 60, request)).rejects.toThrow("fixture outage");
    expect(repository.userTarget).not.toHaveBeenCalled();
  });
});
