import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user-online-revocation.repository", () => ({
  UserOnlineRevocationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
vi.mock("@/util/auth-session", () => ({
  buildForceOfflineUserKey: (id: string) => "user:force_offline:" + id,
  buildForceOfflineAuthSessionKey: (id: string) => "auth:session:force_offline:" + id,
  getForceOfflineAuthSessionTtlSeconds: () => 60,
  extractAuthSessionId: () => "fixture-current",
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { UserOnlineRevocationIamService } from "@/services/users/user-online-revocation-iam.service";
import { getIamActionDefinition } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const target = { id: "session", userId: "peer", status: 1, endedAt: null, updateTime: new Date(0) };
let iam: any, repository: any, redis: any, request: TypedRequest, service: UserOnlineRevocationIamService;
beforeEach(() => {
  vi.clearAllMocks();
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { sessionId: "forged" },
  } as unknown as TypedRequest;
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  repository = {
    sessionTarget: vi.fn().mockResolvedValue(target),
    userTarget: vi.fn().mockResolvedValue({ id: "peer", updateTime: new Date(0) }),
    closeSession: vi
      .fn()
      .mockImplementation(async (_: unknown, _target: unknown, mark: (id: string, date: Date) => Promise<void>) => {
        await mark("fixture-current", new Date(0));
        return { closed: true, authSessionId: "fixture-current" };
      }),
    closeUser: vi
      .fn()
      .mockImplementation(async (_: unknown, _target: unknown, mark: (id: string, date: Date) => Promise<void>) => {
        await mark("peer", new Date(0));
        return 2;
      }),
  };
  redis = { setWithResult: vi.fn().mockResolvedValue(true) };
  service = new (UserOnlineRevocationIamService as unknown as new (...args: any[]) => UserOnlineRevocationIamService)(
    iam,
    repository,
    redis,
  );
});
describe("IAM online session and user revocation", () => {
  it("registers distinct sensitive session and user Actions", () => {
    expect(getIamActionDefinition("quyan:user:ForceOfflineSession")).toMatchObject({
      sensitive: true,
      resourceTypes: ["quyan/online-session"],
    });
    expect(getIamActionDefinition("quyan:user:ForceOfflineUser")?.defaultAuthorizationScope).toBeUndefined();
  });
  it("checks the actual session twice and confirms its persisted authentication session marker", async () => {
    expect(await service.session("session", request)).toEqual({
      closed: true,
      sessionId: "session",
      currentSessionAffected: true,
    });
    expect(iam.authorize).toHaveBeenCalledTimes(2);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:user:ForceOfflineSession",
        resource: "acs:quyan:*:owner:online-session/peer/session",
      }),
    );
    expect(redis.setWithResult).toHaveBeenCalledWith(
      "auth:session:force_offline:fixture-current",
      new Date(0).toISOString(),
      60,
    );
  });
  it("requires user-level permission to end all sessions", async () => {
    expect(await service.user("peer", request)).toEqual({ closedCount: 2, userId: "peer" });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:ForceOfflineUser", resource: "acs:quyan:*:owner:user/peer" }),
    );
    expect(redis.setWithResult).toHaveBeenCalledWith("user:force_offline:peer", new Date(0).toISOString(), 60);
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("%s prevents any closure or revocation marker", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.session("session", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.user("peer", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.closeSession).not.toHaveBeenCalled();
    expect(repository.closeUser).not.toHaveBeenCalled();
    expect(redis.setWithResult).not.toHaveBeenCalled();
  });
  it("rechecks revoked permissions before entering the commit transaction", async () => {
    iam.authorize.mockResolvedValueOnce(allow).mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.session("session", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.closeSession).not.toHaveBeenCalled();
  });
  it.each([null, false, undefined])("never reports success without confirmed revocation", async (result) => {
    redis.setWithResult.mockResolvedValue(result);
    await expect(service.session("session", request)).rejects.toMatchObject({ statusCode: 500 });
    await expect(service.user("peer", request)).rejects.toMatchObject({ statusCode: 500 });
  });
  it("does not write markers for an already closed session", async () => {
    repository.closeSession.mockResolvedValue({ closed: false });
    expect(await service.session("session", request)).toEqual({
      closed: false,
      sessionId: "session",
      currentSessionAffected: false,
    });
    expect(redis.setWithResult).not.toHaveBeenCalled();
  });
  it("preserves account owner recovery against delegated monitor permissions", async () => {
    repository.sessionTarget.mockResolvedValue({ ...target, userId: "owner" });
    await expect(service.session("session", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.user("owner", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorize).not.toHaveBeenCalled();
    expect(repository.closeSession).not.toHaveBeenCalled();
    expect(repository.closeUser).not.toHaveBeenCalled();
  });
  it("allows account owner self revocation only through the same evaluator", async () => {
    request.user!.userId = "owner";
    request.authContext!.principalUserId = "owner";
    repository.userTarget.mockResolvedValue({ id: "owner", updateTime: new Date(0) });
    await service.user("owner", request);
    expect(iam.authorize).toHaveBeenCalledTimes(2);
  });
  it("shadow-only authorization never closes sessions or writes revocation state", async () => {
    await service.authorizeSession("session", request);
    await service.authorizeUser("peer", request);
    expect(repository.closeSession).not.toHaveBeenCalled();
    expect(repository.closeUser).not.toHaveBeenCalled();
    expect(redis.setWithResult).not.toHaveBeenCalled();
  });
  it.each([null, { ...target, id: "other" }, { ...target, status: 0 }])(
    "rejects unavailable or misbound metadata",
    async (row) => {
      repository.sessionTarget.mockResolvedValue(row);
      await expect(service.session("session", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.closeSession).not.toHaveBeenCalled();
    },
  );
  it("rejects missing identity and policy outages before resource lookup", async () => {
    await expect(service.user("peer")).rejects.toMatchObject({ statusCode: 403 });
    iam.loadPolicies.mockRejectedValue(new Error("fixture outage"));
    await expect(service.session("session", request)).rejects.toThrow("fixture outage");
    expect(repository.sessionTarget).not.toHaveBeenCalled();
  });
});
