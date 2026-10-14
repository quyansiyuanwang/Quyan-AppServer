import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { ImpersonationService } from "@/services/users/impersonation.service";
import { ImpersonationIamService } from "@/services/users/impersonation-iam.service";
import { ImpersonationIamRepository } from "@/store/users/impersonation-iam.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { impersonationResourceResolver } from "@/iam/request/impersonation-resource-resolver";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { JWTAccessIns } from "@/util/auth";
import { expressAuthentication } from "@/middleware/auth/auth_guard";
import { PermissionService } from "@/services/users/permission.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { buildForceOfflineUserKey } from "@/util/auth-session";
import { IMPERSONATION_HANDOFF_COOKIE_NAME } from "@/util/impersonation-cookie";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, target: string, other: string, globalGroup: string, targetGroup: string;
const initialMode = env.security.iamAuthorizationMode,
  service = ImpersonationService.getInstance(),
  native = ImpersonationIamService.getInstance(),
  repository = ImpersonationIamRepository.getInstance(),
  act = "quyan:user:StartActImpersonation",
  view = "quyan:user:StartViewImpersonation";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "impersonation-fixture-" + randomUUID(),
        password: "fixture-only-credential",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "forged" },
    body: { targetUserId: target, accountOwnerId: "forged" },
    query: {},
    method: "GET",
    path: "/v1/users/profile",
    secure: true,
    ip: "192.0.2.20",
    res: { locals: {}, cookie: vi.fn(), clearCookie: vi.fn() },
  }) as unknown as TypedRequest;
async function bind(
  effect: "Allow" | "Deny",
  action: string | string[],
  resourceId = target,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: action,
      Resource: platformUserArn(resourceId),
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "impersonation-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
  return policy;
}
const start = (req = request(), id = target) => service.startImpersonation(actor, id, req);
async function claims(token: string) {
  return (await JWTAccessIns.verifyToken(token))!;
}
async function authenticate(token: string, method = "GET") {
  const req = request();
  req.headers.authorization = "Bearer " + token;
  req.method = method;
  delete req.user;
  delete req.authContext;
  return expressAuthentication(req, "jwt");
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  target = await user();
  other = await user();
  globalGroup = (
    await prisma.group.create({
      data: {
        username: "impersonation-global-" + randomUUID(),
        name: "Operators",
        level: 1,
        permissions: [Permission.USER_IMPERSONATE_VIEW, Permission.USER_IMPERSONATE_ACT],
        accountOwnerId: null,
      },
    })
  ).id;
  targetGroup = (
    await prisma.group.create({
      data: {
        username: "impersonation-target-" + randomUUID(),
        name: "Targets",
        level: 2,
        permissions: [],
        accountOwnerId: null,
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId: globalGroup } });
  await prisma.user.updateMany({ where: { id: { in: [target, other] } }, data: { groupId: targetGroup } });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = initialMode;
});
describe("persisted impersonation resource and session authority", () => {
  it("issues an act token with a credential-free original issuer and authenticates it", async () => {
    const result = await start(),
      payload = await claims(result.access_token);
    expect(result.mode).toBe("act");
    expect(payload).toMatchObject({
      userId: target,
      impersonatorId: actor,
      impersonationIssuer: { principal: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" } },
    });
    expect(JSON.stringify(payload)).not.toContain("fixture-only-credential");
    expect(await authenticate(result.access_token)).toMatchObject({ userId: target, impersonationMode: "act" });
  });
  it("allows a different explicitly authorized platform target and ignores a forged account header", async () => {
    expect((await start(request(), other)).targetUser.id).toBe(other);
    expect(await impersonationResourceResolver({ request: request(), principal: getIamPrincipal(request())! })).toBe(
      platformUserArn(target),
    );
  });
  it("falls back to view after target-specific act Deny and keeps that session read-only", async () => {
    await bind("Deny", act);
    const result = await start();
    expect(result.mode).toBe("view");
    expect((await start(request(), other)).mode).toBe("act");
    expect(await authenticate(result.access_token)).toMatchObject({ impersonationMode: "view" });
    await expect(authenticate(result.access_token, "POST")).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "errors.impersonationReadonlyViolation",
    });
  });
  it("does not issue a token when both modes are explicitly denied", async () => {
    await bind("Deny", [act, view]);
    const sign = vi.spyOn(JWTAccessIns, "generateToken");
    await expect(start()).rejects.toMatchObject({ statusCode: 403 });
    expect(sign).not.toHaveBeenCalled();
  });
  it("stops a previously issued act token after a policy Deny without falling back to view", async () => {
    const result = await start();
    await bind("Deny", act);
    await expect(authenticate(result.access_token)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not resurrect a denied token through a cross-site handoff", async () => {
    const req = request(),
      result = await start(req);
    await service.issueCrossSiteHandoff(req, result.access_token);
    const id = vi.mocked(req.res.cookie).mock.calls[0]![1];
    req.headers.cookie = IMPERSONATION_HANDOFF_COOKIE_NAME + "=" + id;
    expect((await service.restoreImpersonation(req))!.mode).toBe("act");
    await bind("Deny", act);
    expect(await service.restoreImpersonation(req)).toBeNull();
    expect(req.res.clearCookie).toHaveBeenCalled();
  });
  it.each(["personal", "private", "disabled", "wrong"])("requires persisted global qualification: %s", async (kind) => {
    if (kind === "personal")
      await prisma.user.update({
        where: { id: actor },
        data: { groupId: null, permissionAdds: [Permission.USER_IMPERSONATE_ACT] },
      });
    if (kind === "private") await prisma.group.update({ where: { id: globalGroup }, data: { accountOwnerId: owner } });
    if (kind === "disabled") await prisma.group.update({ where: { id: globalGroup }, data: { status: 0 } });
    if (kind === "wrong")
      await prisma.group.update({ where: { id: globalGroup }, data: { permissions: [Permission.USER_READ] } });
    await bind("Allow", [act, view]);
    await expect(start()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not grant act mode to a view-qualified group from a policy", async () => {
    await prisma.group.update({
      where: { id: globalGroup },
      data: { permissions: [Permission.USER_IMPERSONATE_VIEW] },
    });
    await bind("Allow", act);
    expect((await start()).mode).toBe("view");
  });
  it.each(["actor", "owner", "target"])("blocks issuance and session use after %s disablement", async (which) => {
    const result = await start(),
      id = which === "actor" ? actor : which === "owner" ? owner : target;
    await prisma.user.update({ where: { id }, data: { status: 0 } });
    await expect(start()).rejects.toMatchObject({ statusCode: 403 });
    await expect(authenticate(result.access_token)).rejects.toBeDefined();
  });
  it.each(["actor", "target"])(
    "rechecks privilege levels even when %s group timestamps are preserved",
    async (which) => {
      const result = await start(),
        groupId = which === "actor" ? globalGroup : targetGroup;
      const before = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
      await prisma.group.update({
        where: { id: groupId },
        data: { level: which === "actor" ? 2 : 1, updateTime: before.updateTime },
      });
      await expect(authenticate(result.access_token)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("requires role grants and stops a role-issued token after revocation", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Impersonation role" } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Impersonation",
        tokenJtiHash: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.roleSessionId = session.id;
    req.authContext!.assumedRoleId = role.id;
    await expect(start(req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", act, target, "role", role.id);
    const result = await start(req);
    expect((await claims(result.access_token)).impersonationIssuer!.principal.roleSessionId).toBe(session.id);
    await expect(start(req, other)).rejects.toMatchObject({ statusCode: 403 });
    expect(await authenticate(result.access_token)).toMatchObject({ userId: target });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
    await expect(authenticate(result.access_token)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks active AccessKey provenance and never copies credential bytes to the token", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } }),
      req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = key;
    const result = await start(req),
      payload = await claims(result.access_token);
    expect(payload.impersonationIssuer!.accessKeyId).toBe(key.id);
    expect(JSON.stringify(payload)).not.toContain(key.key);
    expect(await authenticate(result.access_token)).toMatchObject({ userId: target });
    await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
    await expect(authenticate(result.access_token)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not issue from a missing or expired AccessKey", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await expect(start(req)).rejects.toMatchObject({ statusCode: 403 });
    const key = await prisma.accessKey.create({
      data: { userId: actor, key: "fixture-" + randomUUID(), expiresAt: new Date(0) },
    });
    req.accessKey = key;
    await expect(start(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects actor/group changes between preparation and the signing transaction", async () => {
    const guarded = repository.guarded.bind(repository),
      before = await prisma.group.findUniqueOrThrow({ where: { id: globalGroup } });
    vi.spyOn(repository, "guarded").mockImplementation(async (...args) => {
      await prisma.group.update({
        where: { id: globalGroup },
        data: { permissions: [Permission.USER_IMPERSONATE_VIEW], updateTime: before.updateTime },
      });
      return guarded(...args);
    });
    const sign = vi.spyOn(JWTAccessIns, "generateToken");
    await expect(start()).rejects.toMatchObject({ statusCode: 403 });
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects target data changes with preserved timestamps at the signing boundary", async () => {
    const guarded = repository.guarded.bind(repository),
      before = await prisma.user.findUniqueOrThrow({ where: { id: target } });
    vi.spyOn(repository, "guarded").mockImplementation(async (...args) => {
      await prisma.user.update({
        where: { id: target },
        data: { name: "Changed target", updateTime: before.updateTime },
      });
      return guarded(...args);
    });
    await expect(start()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks source-IP conditions on every issued-session use", async () => {
    await bind("Deny", act, target, "user", actor, { IpAddress: { "acs:SourceIp": "192.0.3.0/24" } });
    const result = await start(),
      req = request();
    Object.defineProperty(req, "ip", { value: "192.0.3.20" });
    await expect(native.validateSession(await claims(result.access_token), req)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not accept pre-migration impersonation tokens in enforce mode", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target } }),
      token = JWTAccessIns.generateToken(
        {
          userId: target,
          updatedAt: row.updateTime.toISOString(),
          status: 1,
          impersonatorId: actor,
          impersonationMode: "act",
        },
        600,
      );
    await expect(authenticate(token)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects malformed targets, self impersonation and nested issuance before signing", async () => {
    for (const id of [actor, "invalid/*"]) await expect(start(request(), id)).rejects.toBeDefined();
    const req = request();
    req.user!.impersonatorId = other;
    await expect(start(req)).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "impersonation.nestedSessionNotAllowed",
    });
  });
  it("invalidates issuer force-offline sessions without modifying the target account", async () => {
    const result = await start(),
      redis = RedisService.getInstance(),
      key = buildForceOfflineUserKey(actor);
    await redis.set(key, "fixture", 60);
    try {
      await expect(authenticate(result.access_token)).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await redis.delete(key);
    }
  });
  it.each(["legacy", "shadow"] as const)("preserves old enforcement in %s and issues only one token", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await bind("Deny", [act, view]);
    const sign = vi.spyOn(JWTAccessIns, "generateToken"),
      result = await start();
    expect(result.mode).toBe("act");
    expect(sign).toHaveBeenCalledTimes(1);
    expect((await claims(result.access_token)).impersonationIssuer).toBeUndefined();
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [],
      missingPermissions: [],
    });
    await expect(start()).rejects.toMatchObject({ statusCode: 403 });
  });
});
