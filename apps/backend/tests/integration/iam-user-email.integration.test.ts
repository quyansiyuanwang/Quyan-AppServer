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
import { withReplayProtection } from "../util/replay-protection-test-helper";
import { Permission, CustomCode } from "@quyan/shared";
import { EmailService } from "@/services/auth/email.service";
import { CaptchaService } from "@/services/auth/captcha.service";
import { TwoFactorService } from "@/services/auth/two-factor.service";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance(),
  changePath = "/v1/users/me/email",
  sendPath = "/v1/users/me/send-email-change-code";
let app: Express, owner: string, actor: string, peer: string;
const arn = () => `acs:quyan:*:${owner}:user/${actor}`;
beforeAll(() => {
  app = createApp();
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "profile-http-" + randomUUID(),
          password: "fixture-password-never-return",
          email: "fixture-" + randomUUID() + "@example.test",
          name: "original",
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
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  vi.spyOn(EmailService.getInstance(), "sendVerificationCode").mockResolvedValue(undefined);
  vi.spyOn(EmailService.getInstance(), "verifyCode").mockResolvedValue(true);
  vi.spyOn(CaptchaService.getInstance(), "isEnabled").mockResolvedValue(false);
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
async function grant(Action = "quyan:user:ChangeEmail", Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "profile-http-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource: arn() } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const data = () => ({ newEmail: "http-new-" + randomUUID() + "@example.test", verificationCode: "123456" });
const update = (body = data()) => withReplayProtection(request(app).patch(changePath), body, changePath).send(body);
const send = (body = { newEmail: data().newEmail }) =>
  withReplayProtection(request(app).post(sendPath), body, sendPath).send(body);
async function oauth(scopes = ["email"]) {
  const client = await prisma.oAuthClient.create({
    data: {
      userId: owner,
      name: "fixture-client",
      clientId: "fixture-client-" + randomUUID(),
      reviewStatus: "approved",
      grantTypes: ["authorization_code"],
      redirectUris: ["https://example.test/callback"],
      scopes,
    },
  });
  const secret = "oat_fixture-" + randomUUID();
  const stored = await prisma.oAuthAccessToken.create({
    data: {
      oauthClientId: client.id,
      userId: actor,
      tokenHash: createHash("sha256").update(secret).digest("hex"),
      scopes,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  return { secret, stored, client };
}
describe("generated personal email IAM routes", () => {
  it("requires authentication on both endpoints", async () => {
    await request(app).post(sendPath).send({ newEmail: data().newEmail }).expect(401);
    await request(app).patch(changePath).send(data()).expect(401);
  });
  it("denies before sending mail or consuming a verification code", async () => {
    const auth = "Bearer " + (await token());
    await send().set("Authorization", auth).expect(403);
    await update().set("Authorization", auth).expect(403);
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
  });
  it("keeps fixed native Actions independent and ignores forged Action or owner headers", async () => {
    await grant("quyan:user:SendEmailChangeCode");
    const auth = "Bearer " + (await token()),
      input = data();
    await send({ newEmail: input.newEmail })
      .set("Authorization", auth)
      .set("X-Action", "quyan:user:ChangeEmail")
      .expect(200);
    await update(input).set("Authorization", auth).set("X-Action", "quyan:user:SendEmailChangeCode").expect(403);
    await grant();
    await update(input)
      .set("Authorization", auth)
      .query({ userId: peer, accountOwnerId: peer })
      .set("X-Action", "*")
      .expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: peer } })).email).not.toBe(input.newEmail);
    expect(EmailService.getInstance().sendVerificationCode).toHaveBeenCalledTimes(1);
  });
  it("Deny overrides Allow without exposing the policy document", async () => {
    await grant();
    await grant("quyan:user:ChangeEmail", "Deny");
    const result = await update()
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(JSON.stringify(result.body)).not.toContain("Statement");
    expect(JSON.stringify(result.body)).not.toContain("acs:quyan:");
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
  });
  it("retains replay protection and schema validation", async () => {
    await grant();
    const auth = "Bearer " + (await token());
    await request(app).patch(changePath).set("Authorization", auth).send(data()).expect(400);
    const invalid = { newEmail: "invalid", verificationCode: "123456" };
    await update(invalid).set("Authorization", auth).expect(422);
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
  });
  it("retains the CAPTCHA trust gate on code sending", async () => {
    await grant("quyan:user:SendEmailChangeCode");
    vi.mocked(CaptchaService.getInstance().isEnabled).mockResolvedValue(true);
    vi.spyOn(CaptchaService.getInstance(), "shouldBypassForTrustedRequest").mockResolvedValue(false);
    const result = await send()
      .set("Authorization", "Bearer " + (await token()))
      .expect(400);
    expect(result.body.code).toBe(CustomCode.CAPTCHA_TRUST_REQUIRED);
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
  });
  it("retains a two-factor challenge and accepts a verified retry", async () => {
    await grant();
    await prisma.user.update({ where: { id: actor }, data: { twoFactorEnabled: true } });
    const auth = "Bearer " + (await token());
    const challenge = await update().set("Authorization", auth).expect(401);
    expect(challenge.body.code).toBe(CustomCode.TWO_FACTOR_REQUIRED);
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
    const trusted = await TwoFactorService.getInstance().createOneTimeTrustedToken(actor),
      input = data();
    await update(input).set("Authorization", auth).set("X-OneTime-Token", trusted).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
  });
  it.each(["email", Permission.USER_UPDATE_SELF_EMAIL])(
    "keeps OAuth %s scope compatible with the resource grant",
    async (scope) => {
      await grant();
      const delegated = await oauth([scope]),
        input = data();
      await update(input)
        .set("Authorization", "Bearer " + delegated.secret)
        .expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
    },
  );
  it("does not accept a profile-only OAuth scope", async () => {
    await grant();
    const delegated = await oauth(["profile"]);
    await update()
      .set("Authorization", "Bearer " + delegated.secret)
      .expect(403);
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
  });
});
