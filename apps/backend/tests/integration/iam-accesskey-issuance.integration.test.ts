import { createHash, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "@/app";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { RamService } from "@/services/users/ram.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { TwoFactorService } from "@/services/auth/two-factor.service";
import { EmailService } from "@/services/auth/email.service";
import { withReplayProtection } from "../util/replay-protection-test-helper";
import { CustomCode, Permission } from "@quyan/shared";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance(),
  path = "/v1/accesskeys",
  sendPath = path + "/send-accesskey-creation-verification-code";
let app: Express, owner: string, actor: string, peer: string;
const resource = (id = actor) => `acs:quyan:*:${owner}:user/${id}`;
const email = () => `issuance-${actor}@example.test`;
beforeAll(() => {
  app = createApp();
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "issuance-http-" + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  await prisma.user.update({ where: { id: actor }, data: { email: email() } });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  vi.spyOn(EmailService.getInstance(), "sendVerificationCode").mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
async function token() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
  return JWTAccessIns.generateToken(
    { userId: actor, updatedAt: user.updateTime.toISOString(), status: user.status },
    60,
  );
}
async function grant(Action = "quyan:ram:CreateAccessKey", Resource = resource(), Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "issuance-http-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const code = () =>
  prisma.emailVerification.create({
    data: { email: email(), code: "123456", expiresAt: new Date(Date.now() + 60000) },
  });
const create = (body = { name: "fixture-sensitive-name", verificationCode: "123456" }) =>
  withReplayProtection(request(app).post(path), body, path).send(body);
const send = () => withReplayProtection(request(app).post(sendPath), {}, sendPath).send({});
async function oauth() {
  const client = await prisma.oAuthClient.create({
    data: {
      userId: owner,
      name: "fixture-client",
      clientId: "fixture-client-" + randomUUID(),
      reviewStatus: "approved",
      grantTypes: ["authorization_code"],
      redirectUris: ["https://example.test/callback"],
      scopes: ["accesskey"],
    },
  });
  const secret = "oat_fixture-" + randomUUID();
  const stored = await prisma.oAuthAccessToken.create({
    data: {
      oauthClientId: client.id,
      userId: actor,
      tokenHash: createHash("sha256").update(secret).digest("hex"),
      scopes: ["accesskey"],
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  return { secret, stored, client };
}
describe("generated resource-scoped access-key issuance routes", () => {
  it("requires authentication and replay protection", async () => {
    await request(app).post(path).send({}).expect(401);
    await request(app).post(sendPath).send({}).expect(401);
    await grant();
    await request(app)
      .post(path)
      .set("Authorization", "Bearer " + (await token()))
      .send({ verificationCode: "123456" })
      .expect(400);
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("creates an exact granted key once and ignores forged account/action input", async () => {
    await grant();
    const verification = await code();
    const response = await create()
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", "*")
      .query({ accountOwnerId: peer })
      .expect(200);
    expect(response.body.data.userId).toBe(actor);
    expect(response.body.data.key).toMatch(/^sk-ak-/);
    expect((await prisma.emailVerification.findUniqueOrThrow({ where: { id: verification.id } })).used).toBe(true);
    const audit = JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls);
    expect(audit).not.toContain(response.body.data.key);
    expect(audit).not.toContain("fixture-sensitive-name");
    expect(audit).not.toContain("123456");
    await create()
      .set("Authorization", "Bearer " + (await token()))
      .expect(400);
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(1);
  });
  it("rejects absent Allow, another-user scope, and matching Deny without disclosing policy content", async () => {
    await code();
    await create()
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    await grant("quyan:ram:CreateAccessKey", resource(peer));
    await create()
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    await grant();
    await grant("quyan:ram:CreateAccessKey", resource(), "Deny");
    const response = await create()
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(JSON.stringify(response.body)).not.toContain("Statement");
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("keeps code-sending as an independently authorized operation", async () => {
    await grant();
    await send()
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
    await grant("quyan:ram:SendAccessKeyCreationVerificationCode");
    await send()
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(EmailService.getInstance().sendVerificationCode).toHaveBeenCalledWith(email());
  });
  it("retains the two-factor challenge before permitting either creation operation", async () => {
    await grant();
    await grant("quyan:ram:SendAccessKeyCreationVerificationCode");
    await prisma.user.update({ where: { id: actor }, data: { twoFactorEnabled: true } });
    const created = await create()
      .set("Authorization", "Bearer " + (await token()))
      .expect(401);
    expect(created.body.code).toBe(CustomCode.TWO_FACTOR_REQUIRED);
    await send()
      .set("Authorization", "Bearer " + (await token()))
      .expect(401);
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("uses verified two-factor retry without an additional email code", async () => {
    await grant();
    await grant("quyan:ram:SendAccessKeyCreationVerificationCode");
    await prisma.user.update({ where: { id: actor }, data: { twoFactorEnabled: true } });
    const trusted = await TwoFactorService.getInstance().createOneTimeTrustedToken(actor),
      auth = "Bearer " + (await token());
    await withReplayProtection(request(app).post(path), {}, path)
      .send({})
      .set("Authorization", auth)
      .set("X-OneTime-Token", trusted)
      .expect(200);
    await send().set("Authorization", auth).set("X-OneTime-Token", trusted).expect(200);
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(1);
  });
  it("rejects absent/invalid codes for accounts without 2FA", async () => {
    await grant();
    const auth = "Bearer " + (await token());
    await create({ name: "fixture", verificationCode: "654321" }).set("Authorization", auth).expect(400);
    await withReplayProtection(request(app).post(path), {}, path).send({}).set("Authorization", auth).expect(400);
    expect(await prisma.accessKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("preserves scoped OAuth creation and code sending, but cannot read or delete existing keys", async () => {
    await grant();
    await grant("quyan:ram:SendAccessKeyCreationVerificationCode");
    const delegated = await oauth();
    await code();
    const auth = "Bearer " + delegated.secret;
    await send().set("Authorization", auth).expect(200);
    const created = await create().set("Authorization", auth).expect(200);
    expect(created.body.data.userId).toBe(actor);
    await request(app).get(path).set("Authorization", auth).expect(401);
    await request(app)
      .get(path + "/page")
      .set("Authorization", auth)
      .expect(401);
    await request(app)
      .delete(path + "/" + created.body.data.id)
      .set("Authorization", auth)
      .expect(401);
  });
  it.each(["legacy", "shadow"] as const)("retains %s mode without changing policy storage", async (authMode) => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ACCESSKEY_CREATE] } });
    await code();
    env.security.iamAuthorizationMode = authMode;
    await create()
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(await prisma.ramPolicy.count({ where: { accountOwnerId: owner } })).toBe(0);
  });
});
