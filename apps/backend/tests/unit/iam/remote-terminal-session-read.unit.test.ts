import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/remote-terminal-product/remote-terminal-usage.repository", () => ({
  RemoteTerminalUsageRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/modules/remote-terminal/gateway/gateway.service", () => ({
  RemoteTerminalGatewayService: { getInstance: vi.fn() },
}));
import { env } from "@/config/env";
import { RemoteTerminalSessionReadIamService } from "@/services/remote-terminal/remote-terminal-session-read-iam.service";
import { remoteTerminalSessionArn } from "@/iam/resources/remote-terminal-resources";
import {
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
  Permission,
} from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
const sessions = { listSessionMetadata: vi.fn(), hydrateSessionSummaries: vi.fn() },
  usage = { totals: vi.fn() },
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new RemoteTerminalSessionReadIamService(sessions, usage, iam, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.10",
  }) as unknown as TypedRequest;
const metadata = (sessionId = "session-1", status: "pending" | "connected" | "closed" = "pending") => ({
  sessionId,
  ownerUserId: "actor",
  entitlementId: "entitlement",
  deviceId: "device",
  status,
  revision: "redis:" + "a".repeat(40),
});
const summary = (sessionId = "session-1") => ({
  sessionId,
  deviceId: "device",
  status: "pending" as const,
  mode: "shell" as const,
  shellType: "bash" as const,
  createdAt: "2026-10-14T00:00:00.000Z",
});
const decision = (value = "Allow") => ({
  decision: value,
  reason: value === "Allow" ? "matched-allow" : "no-matching-allow",
  matchedStatements: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => decision()));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  sessions.listSessionMetadata.mockResolvedValue([metadata()]);
  sessions.hydrateSessionSummaries.mockImplementation(async (_owner, targets) =>
    targets.map((row: ReturnType<typeof metadata>) => summary(row.sessionId)),
  );
  usage.totals.mockResolvedValue({ totalTerminalLimit: 5, totalDeviceLimit: 4, activeDeviceCount: 3 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("native terminal session reads", () => {
  it("registers real Actions and owner-parented session resource types", () => {
    const arn = remoteTerminalSessionArn("owner", "actor", "session-1");
    expect(isIamActionResourceCompatible("quyan:remote_terminal:ListSessions", arn)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:remote_terminal:GetUsageSummary", arn)).toBe(false);
    expect(getIamActionDefinition("quyan:remote_terminal:GetUsageSummary")?.resourceTypes).toEqual(["quyan/user"]);
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_SESSION_READ)).toContain(
      "quyan:remote_terminal:ListSessions",
    );
  });
  it("filters denied session metadata before public hydration", async () => {
    sessions.listSessionMetadata.mockResolvedValue([metadata(), metadata("session-2")]);
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => decision(resource.endsWith("session-2") ? "ExplicitDeny" : "Allow")),
    );
    const legacy = vi.fn();
    expect(await service.list("actor", request(), legacy)).toEqual([summary()]);
    expect(sessions.hydrateSessionSummaries).toHaveBeenCalledTimes(2);
    sessions.hydrateSessionSummaries.mock.calls.forEach((call) => expect(call[1]).toEqual([metadata()]));
    expect(legacy).not.toHaveBeenCalled();
  });
  it("returns an empty collection without hydrating when nothing is granted", async () => {
    iam.authorizeMany.mockResolvedValue([decision("ImplicitDeny")]);
    expect(await service.list("actor", request(), vi.fn())).toEqual([]);
    expect(sessions.hydrateSessionSummaries).not.toHaveBeenCalled();
  });
  it("checks conditions again before and after hydration", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([decision()])
      .mockResolvedValueOnce([decision()])
      .mockResolvedValueOnce([decision("ExplicitDeny")]);
    await expect(service.list("actor", request(), vi.fn())).rejects.toThrow();
    expect(sessions.hydrateSessionSummaries).toHaveBeenCalledTimes(1);
  });
  it("rejects conditions expiring during the final source recheck", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([decision()])
      .mockResolvedValueOnce([decision()])
      .mockResolvedValueOnce([decision()])
      .mockResolvedValueOnce([decision("ExplicitDeny")]);
    await expect(service.list("actor", request(), vi.fn())).rejects.toThrow();
    expect(sessions.hydrateSessionSummaries).toHaveBeenCalledTimes(2);
  });
  it("rejects policy revisions during hydration", async () => {
    sessions.hydrateSessionSummaries.mockImplementation(async () => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "changed",
          document: { Version: "1", Statement: [{ Effect: "Deny", Action: "*", Resource: "*" }] },
        },
      ]);
      return [summary()];
    });
    await expect(service.list("actor", request(), vi.fn())).rejects.toThrow();
  });
  it("rejects principal mutation during hydration", async () => {
    const req = request();
    sessions.hydrateSessionSummaries.mockImplementation(async () => {
      req.authContext!.accountOwnerId = "other";
      return [summary()];
    });
    await expect(service.list("actor", req, vi.fn())).rejects.toThrow();
  });
  it("propagates a source recheck failure", async () => {
    sessions.hydrateSessionSummaries
      .mockResolvedValueOnce([summary()])
      .mockRejectedValueOnce(new Error("source changed"));
    await expect(service.list("actor", request(), vi.fn())).rejects.toThrow();
  });
  it.each([
    undefined,
    { user: { userId: "other" } },
    { ...request(), oauthAccessToken: {} },
    { ...request(), authContext: { principalUserId: "other", accountOwnerId: "owner" } },
  ])("rejects missing or untrusted identity (%j)", async (input) => {
    await expect(service.list("actor", input as TypedRequest, vi.fn())).rejects.toThrow();
    expect(sessions.listSessionMetadata).not.toHaveBeenCalled();
  });
  it("rejects foreign ownership metadata before evaluation", async () => {
    sessions.listSessionMetadata.mockResolvedValue([{ ...metadata(), ownerUserId: "other" }]);
    await expect(service.list("actor", request(), vi.fn())).rejects.toThrow();
    expect(iam.authorizeMany).not.toHaveBeenCalled();
  });
  it.each([{ rows: [] }, { rows: [summary("foreign")] }])(
    "rejects an incomplete or mismatched hydration (%j)",
    async ({ rows }) => {
      sessions.hydrateSessionSummaries.mockResolvedValue(rows);
      await expect(service.list("actor", request(), vi.fn())).rejects.toThrow();
    },
  );
  it("copies only public fields from the admitted summary", async () => {
    sessions.hydrateSessionSummaries.mockResolvedValue([
      { ...summary(), browserToken: "fixture-private", workingDirectory: "fixture-private" },
    ]);
    expect(await service.list("actor", request(), vi.fn())).toEqual([summary()]);
  });
  it("batches all 701 sessions without truncating the collection", async () => {
    sessions.listSessionMetadata.mockResolvedValue(
      Array.from({ length: 701 }, (_, index) => metadata("session-" + index)),
    );
    expect(await service.list("actor", request(), vi.fn())).toHaveLength(701);
    expect(iam.authorizeMany.mock.calls.every((call) => call[0].resources.length <= 500)).toBe(true);
  });
  it("retains full owned usage accounting independently of session visibility", async () => {
    sessions.listSessionMetadata.mockResolvedValue([
      metadata(),
      metadata("session-2", "connected"),
      metadata("session-3", "closed"),
    ]);
    const result = await service.getUsage("actor", request(), vi.fn());
    expect(result).toMatchObject({
      activeSessionCount: 2,
      activeDeviceCount: 3,
      totalTerminalLimit: 5,
      totalDeviceLimit: 4,
      remainingTerminalCount: 3,
      remainingDeviceCount: 1,
    });
    expect(sessions.hydrateSessionSummaries).not.toHaveBeenCalled();
    expect(
      iam.authorizeMany.mock.calls.every((call) => call[0].action === "quyan:remote_terminal:GetUsageSummary"),
    ).toBe(true);
  });
  it("rejects usage before scanning sources if the user resource is not granted", async () => {
    iam.authorizeMany.mockResolvedValue([decision("ExplicitDeny")]);
    await expect(service.getUsage("actor", request(), vi.fn())).rejects.toThrow();
    expect(usage.totals).not.toHaveBeenCalled();
    expect(sessions.listSessionMetadata).not.toHaveBeenCalled();
  });
  it("rechecks usage conditions before releasing totals", async () => {
    iam.authorizeMany.mockResolvedValueOnce([decision()]).mockResolvedValueOnce([decision("ImplicitDeny")]);
    await expect(service.getUsage("actor", request(), vi.fn())).rejects.toThrow();
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps %s results and executes legacy callbacks once",
    async (selectedMode) => {
      env.security.iamAuthorizationMode = selectedMode;
      iam.authorizeMany.mockRejectedValue(new Error("IAM unavailable"));
      const legacy = vi.fn().mockResolvedValue([summary("legacy")]);
      expect(await service.list("actor", request(), legacy)).toEqual([summary("legacy")]);
      expect(legacy).toHaveBeenCalledTimes(1);
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
        "actor",
        [Permission.REMOTE_TERMINAL_SESSION_READ],
        { assumedRoleSessionId: undefined },
      );
    },
  );
  it("rejects legacy denial before running a business callback", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    const legacy = vi.fn();
    await expect(service.list("actor", request(), legacy)).rejects.toThrow();
    expect(legacy).not.toHaveBeenCalled();
  });
});
