import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/store/remote-terminal-product/remote-terminal-session-authority.repository", () => ({
  RemoteTerminalSessionAuthorityRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { RemoteTerminalSessionAuthorityService } from "@/services/remote-terminal/remote-terminal-session-authority.service";
import type { TypedRequest } from "@/types/express";
import {
  getIamActionDefinition,
  isIamActionResourceCompatible,
  Permission,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
const mode = env.security.iamAuthorizationMode;
const store = { capture: vi.fn(), assertCurrent: vi.fn() },
  sessions = { projectTerminalSessions: vi.fn() },
  iam = { authorizeMany: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new RemoteTerminalSessionAuthorityService(store, sessions, iam, permissions);
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const req = () =>
  ({
    user: { userId: "actor", updatedAt: "2026-10-14T00:00:00.000Z" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { authorization: "PRIVATE-JWT" },
    accessKey: { id: "credential", key: "PRIVATE-KEY" },
  }) as unknown as TypedRequest;
const metadata = () => ({
  sessionId: "session-1",
  ownerUserId: "actor",
  entitlementId: "entitlement-1",
  deviceId: "device-1",
  status: "pending" as const,
  revision: "redis:" + "a".repeat(40),
});
const authority = () => ({
  principal: { ...principal },
  userRevision: "a".repeat(64),
  authenticationUpdatedAt: "2026-10-14T00:00:00.000Z",
  accessKeyId: "credential",
  keyRevision: "b".repeat(64),
  device: {
    id: "binding",
    deviceId: "device-1",
    userId: "actor",
    controlRevision: "c".repeat(64),
    summaryRevision: "d".repeat(64),
  },
});
const guard = async () => {
  const binding = await service.prepare("actor", "device-1", req());
  return binding.bindSession("session-1");
};
beforeEach(() => {
  vi.clearAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  store.capture.mockResolvedValue(authority());
  store.assertCurrent.mockResolvedValue(undefined);
  sessions.projectTerminalSessions.mockImplementation(async () => [{ state: "present", metadata: metadata() }]);
  iam.authorizeMany.mockResolvedValue([{ decision: "Allow", reason: "fixture", matchedStatements: [] }]);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("terminal connection authority", () => {
  it("registers a distinct session resource Action and migration write alias", () => {
    expect(getIamActionDefinition("quyan:remote_terminal:ConnectSession")).toMatchObject({
      sensitive: true,
      resourceTypes: ["remote-terminal/session"],
    });
    expect(
      isIamActionResourceCompatible(
        "quyan:remote_terminal:ConnectSession",
        "acs:remote-terminal:*:owner:device/actor/device-1",
      ),
    ).toBe(false);
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_SESSION_CREATE)).toContain(
      "quyan:remote_terminal:ConnectSession",
    );
  });
  it("captures metadata only and does not retain authentication request data", async () => {
    const request = req(),
      prepared = await service.prepare("actor", "device-1", request);
    expect(store.capture).toHaveBeenCalledWith(principal, "device-1", "credential");
    for (const key of ["user", "authContext", "headers", "accessKey"])
      Object.defineProperty(request, key, {
        get: () => {
          throw new Error("Request retained");
        },
      });
    const check = await prepared.bindSession("session-1");
    await check({ "acs:SourceIp": "192.0.2.10", "acs:SecureTransport": true });
    const call = iam.authorizeMany.mock.calls[0][0];
    expect(call).toMatchObject({
      action: "quyan:remote_terminal:ConnectSession",
      resources: ["acs:remote-terminal:*:owner:session/actor/session-1"],
      context: {
        "quyan:PrincipalId": "actor",
        "quyan:PrincipalAccount": "owner",
        "acs:SourceIp": "192.0.2.10",
        "acs:SecureTransport": true,
      },
    });
    expect(JSON.stringify(call)).not.toContain("PRIVATE");
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("rejects %s on connection use", async (decision) => {
    const check = await guard();
    iam.authorizeMany.mockResolvedValue([{ decision, reason: "fixture", matchedStatements: [] }]);
    await expect(check({})).rejects.toThrow();
  });
  it("requires the same source ownership and device after policy evaluation", async () => {
    const check = await guard();
    iam.authorizeMany.mockImplementation(async () => {
      sessions.projectTerminalSessions.mockResolvedValue([
        { state: "present", metadata: { ...metadata(), deviceId: "other" } },
      ]);
      return [{ decision: "Allow", reason: "fixture", matchedStatements: [] }];
    });
    await expect(check({})).rejects.toThrow();
  });
  it("rechecks credential and entitlement state after evaluation", async () => {
    const check = await guard();
    store.assertCurrent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("credential rotated"));
    await expect(check({})).rejects.toThrow("credential rotated");
  });
  it.each([
    { rows: null },
    { rows: [{ state: "foreign" }] },
    { rows: [{ state: "missing" }] },
    { rows: [{ state: "present", metadata: { ...metadata(), status: "closed" } }] },
  ])("rejects unavailable or revoked session source (%j)", async ({ rows }) => {
    const check = await guard();
    sessions.projectTerminalSessions.mockResolvedValue(rows);
    await expect(check({})).rejects.toThrow();
  });
  it.each([
    { "quyan:PrincipalId": "other" },
    { "quyan:ResourceGroupId": "chosen" },
    { "acs:SourceIp": "not-ip" },
    { "acs:SecureTransport": "true" },
    { "acs:UserAgent": "bad\nagent" },
  ])("rejects untrusted connection conditions %j", async (input) => {
    const check = await guard();
    await expect(check(input as never)).rejects.toThrow();
    expect(iam.authorizeMany).not.toHaveBeenCalled();
  });
  it("binds only a session issued on the captured device", async () => {
    sessions.projectTerminalSessions.mockResolvedValue([
      { state: "present", metadata: { ...metadata(), deviceId: "other" } },
    ]);
    await expect(guard()).rejects.toThrow();
  });
  it("rejects a request revoked between HTTP authentication and authority capture", async () => {
    const request = req();
    request.user!.updatedAt = "2026-10-13T00:00:00.000Z";
    await expect(service.prepare("actor", "device-1", request)).rejects.toThrow();
  });
  it("rejects an authority adapter that substitutes another account", async () => {
    store.capture.mockResolvedValue({ ...authority(), principal: { ...principal, accountOwnerId: "foreign" } });
    await expect(service.prepare("actor", "device-1", req())).rejects.toThrow();
  });
  it("rejects source mutations occurring during policy evaluation", async () => {
    const check = await guard();
    iam.authorizeMany.mockImplementation(async () => {
      sessions.projectTerminalSessions.mockResolvedValue([
        { state: "present", metadata: { ...metadata(), revision: "redis:" + "b".repeat(40) } },
      ]);
      return [{ decision: "Allow", reason: "fixture", matchedStatements: [] }];
    });
    await expect(check({})).rejects.toThrow();
  });
  it("defaults unknown transport to insecure and uses fresh current time", async () => {
    const check = await guard();
    await check({});
    const call = iam.authorizeMany.mock.calls[0][0];
    expect(call.context["acs:SecureTransport"]).toBe(false);
    expect(Number.isFinite(Date.parse(call.context["acs:CurrentTime"]))).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)(
    "supports %s mode rollback without changing source ownership checks",
    async (selected) => {
      const check = await guard();
      env.security.iamAuthorizationMode = selected;
      iam.authorizeMany.mockRejectedValue(new Error("IAM unavailable"));
      await expect(check({})).resolves.toBeUndefined();
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
        "actor",
        [Permission.REMOTE_TERMINAL_SESSION_CREATE],
        { assumedRoleSessionId: undefined },
      );
    },
  );
  it("rejects revoked legacy permission while rolling back", async () => {
    const check = await guard();
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(check({})).rejects.toThrow();
  });
});
