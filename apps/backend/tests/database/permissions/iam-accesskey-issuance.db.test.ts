import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, actionForPermission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { AccessKeyService } from "@/services/users/accesskey.service";
import { AccessKeyManagementRepository } from "@/store/users/accesskey-management.repository";
import {
  accessKeyIssuanceSnapshotMiddleware,
  accessKeyIssuanceReadyMiddleware,
} from "@/iam/request/accesskey-issuance-context";
import BusinessLogService from "@/services/system/businesslog.service";
import { EmailService } from "@/services/auth/email.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance(),
  service = new AccessKeyService(),
  repo = AccessKeyManagementRepository.getInstance();
const action = "quyan:ram:CreateAccessKey",
  sendAction = "quyan:ram:SendAccessKeyCreationVerificationCode";
let owner: string, actor: string, peer: string;
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const resource = (id = actor) => `acs:quyan:*:${owner}:user/${id}`;
const email = () => `issuance-${actor}@example.test`;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    params: {},
    query: { accountOwnerId: "foreign", userId: peer },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
async function ready(req = request()) {
  const run = (
    middleware: ReturnType<typeof accessKeyIssuanceSnapshotMiddleware> | typeof accessKeyIssuanceReadyMiddleware,
  ) =>
    new Promise<void>((resolve, reject) => {
      void middleware(req, {} as never, (err) => (err ? reject(err) : resolve()));
    });
  await run(accessKeyIssuanceSnapshotMiddleware());
  await run(accessKeyIssuanceReadyMiddleware);
  return req;
}
async function grant(Action: string = action, Resource = resource(), Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "issuance-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const code = (value = "123456") =>
  prisma.emailVerification.create({ data: { email: email(), code: value, expiresAt: new Date(Date.now() + 60000) } });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "issuance-" + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [Permission.ACCESSKEY_CREATE],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  await prisma.user.update({ where: { id: actor }, data: { email: email(), permissionAdds: [] } });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  vi.spyOn(EmailService.getInstance(), "sendVerificationCode").mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("resource-scoped access-key issuance and security-state transactions", () => {
  it("issues a one-time secret under an exact executing-user Allow and consumes the code atomically", async () => {
    await grant();
    const verification = await code();
    const req = await ready();
    const created = await service.generateKeyForUser(
      actor,
      { name: "fixture-sensitive-name", verificationCode: "123456" },
      req,
    );
    expect(created.key).toMatch(/^sk-ak-/);
    expect(created.key).not.toContain("*");
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: verification.id } })).used).toBe(true);
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: created.id } })).userId).toBe(actor);
    const audit = JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls);
    expect(audit).not.toContain(created.key);
    expect(audit).not.toContain("fixture-sensitive-name");
    expect(audit).not.toContain("123456");
    expect(audit).not.toContain(email());
  });
  it("fails closed for absent context, peer service arguments, missing Allow and explicit Deny", async () => {
    await code();
    await expect(service.generateKeyForUser(actor, { verificationCode: "123456" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.generateKeyForUser(actor, { verificationCode: "123456" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = await ready();
    await expect(service.generateKeyForUser(peer, { verificationCode: "123456" }, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.generateKeyForUser(actor, { verificationCode: "123456" }, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant();
    await grant(action, resource(), "Deny");
    await expect(service.generateKeyForUser(actor, { verificationCode: "123456" }, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("does not treat canonical legacy JSON Actions or a peer resource as native issuance Allow", async () => {
    await code();
    await grant(actionForPermission(Permission.ACCESSKEY_CREATE), "*");
    await grant(action, resource(peer));
    await expect(
      service.generateKeyForUser(actor, { verificationCode: "123456" }, await ready()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { email: "changed@example.test" },
    { twoFactorEnabled: true },
    { twoFactorPasskeyRequired: true },
    { accountOwnerId: null },
    { status: 0 },
    { permissionAdds: [Permission.ACCESSKEY_CREATE] },
  ])("rejects security-state drift before issuing %j", async (data) => {
    await grant();
    const verification = await code();
    const state = await repo.captureIssuance(principal());
    await prisma.user.update({
      where: { id: actor },
      data: { ...data, updateTime: new Date(Date.parse(state.snapshot.revision) + 1000) },
    });
    await expect(repo.issue(state, { userId: actor, key: "fixture-only" }, "123456")).rejects.toMatchObject({
      statusCode: expect.any(Number),
    });
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: verification.id } })).used).toBe(false);
  });
  it("allows only one concurrent use of an email code and rolls consumption back if insertion fails", async () => {
    const state = await repo.captureIssuance(principal());
    const verification = await code();
    const outcomes = await Promise.allSettled([
      repo.issue(state, { userId: actor, key: "fixture-one" }, "123456"),
      repo.issue(state, { userId: actor, key: "fixture-two" }, "123456"),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(1);
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: verification.id } })).used).toBe(true);
    const second = await code("654321");
    const existing = await prisma.accessKey.findFirstOrThrow({ where: { userId: actor } });
    await expect(repo.issue(state, { userId: actor, key: existing.key }, "654321")).rejects.toThrow();
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: second.id } })).used).toBe(false);
  });
  it("requires live owner and role-session state before final insertion", async () => {
    const state = await repo.captureIssuance(principal());
    await code();
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repo.issue(state, { userId: actor, key: "fixture-only" }, "123456")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("checks assumed-role isolation and rejects a revoked session before final insertion", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "issuance-role" } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        subjectUserId: actor,
        roleId: role.id,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const state = await repo.captureIssuance({
      ...principal(),
      subjectType: "assumed_role",
      assumedRoleId: role.id,
      roleSessionId: session.id,
    });
    await code();
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(repo.issue(state, { userId: actor, key: "fixture-role" }, "123456")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it.each(["revoke-token", "disable-client", "remove-scope"])(
    "rechecks OAuth state before insertion: %s",
    async (change) => {
      const client = await prisma.oAuthClient.create({
        data: {
          userId: owner,
          name: "fixture-client",
          clientId: "fixture-" + randomUUID(),
          reviewStatus: "approved",
          grantTypes: ["authorization_code"],
          redirectUris: ["https://example.test/callback"],
          scopes: ["accesskey"],
        },
      });
      const token = await prisma.oAuthAccessToken.create({
        data: {
          userId: actor,
          oauthClientId: client.id,
          tokenHash: "fixture-" + randomUUID(),
          scopes: ["accesskey"],
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const state = await repo.captureIssuance(principal(), { id: token.id, clientId: client.id });
      await code();
      if (change === "disable-client")
        await prisma.oAuthClient.update({ where: { id: client.id }, data: { status: 0 } });
      else
        await prisma.oAuthAccessToken.update({
          where: { id: token.id },
          data: change === "revoke-token" ? { revokedAt: new Date() } : { scopes: [] },
        });
      await expect(repo.issue(state, { userId: actor, key: "fixture-oauth" }, "123456")).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
    },
  );
  it("authorizes code sending independently and catches state drift before dispatch", async () => {
    await grant();
    const req = await ready();
    await expect(service.sendAccessKeyCreationVerificationCodeForUser(actor, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
    await grant(sendAction);
    await service.sendAccessKeyCreationVerificationCodeForUser(actor, req);
    expect(EmailService.getInstance().sendVerificationCode).toHaveBeenCalledWith(email());
    vi.mocked(EmailService.getInstance().sendVerificationCode).mockClear();
    await prisma.user.update({ where: { id: actor }, data: { email: "different@example.test" } });
    await expect(service.sendAccessKeyCreationVerificationCodeForUser(actor, req)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
  });
  it("preserves native Allow plus legacy/shadow rollback and never ignores legacy removal", async () => {
    await grant();
    const policyCount = await prisma.ramPolicy.count({ where: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ACCESSKEY_CREATE] } });
    for (const authMode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = authMode;
      await code();
      await service.generateKeyForUser(actor, { verificationCode: "123456" }, await ready());
    }
    expect(await prisma.ramPolicy.count({ where: { accountOwnerId: owner } })).toBe(policyCount);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.ACCESSKEY_CREATE] } });
    await expect(
      service.generateKeyForUser(actor, { verificationCode: "123456" }, await ready()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
