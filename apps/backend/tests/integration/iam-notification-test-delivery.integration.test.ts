import axios from "axios";
import nodemailer from "nodemailer";
import { ConfigService } from "@/services/system/config.service";
import { vi } from "vitest";
import { withReplayProtection } from "../util/replay-protection-test-helper";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "@/app";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { RamService } from "@/services/users/ram.service";

const path = "/v1/notification/webhooks";
const getAction = "quyan:notification:TestWebhook";
const createAction = "quyan:notification:TestEmail",
  updateAction = "quyan:notification:UpdateWebhook";
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let app: Express;
let owner: string, actor: string, peer: string;
let sendMail: ReturnType<typeof vi.fn>;
const arn = (itemId: string, userId = actor) => "acs:notification:*:" + owner + ":webhook/" + userId + "/" + itemId;

async function token() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
  return JWTAccessIns.generateToken(
    { userId: actor, updatedAt: user.updateTime.toISOString(), status: user.status },
    60,
  );
}
async function grant(Action: string | string[], Resource = "*", Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "notification-http-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeAll(() => {
  app = createApp();
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const create = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "notification-http-" + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await create();
  actor = await create(owner);
  peer = await create(owner);
  vi.spyOn(axios, "post").mockResolvedValue({ status: 200 });
  vi.spyOn(ConfigService.getInstance(), "getSmtpConfig").mockResolvedValue({
    host: "smtp.example.invalid",
    port: 465,
    secure: true,
    user: "fixture-only",
    password: "fixture-only",
    senderName: "Fixture",
    senderEmail: "sender@example.invalid",
  });
  vi.spyOn(ConfigService.getInstance(), "getSiteConfig").mockResolvedValue({
    backendPublicUrl: "https://example.invalid",
  } as never);
  sendMail = vi.fn().mockResolvedValue({});
  vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as never);
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});

const input = { name: "Webhook HTTP fixture", url: "https://example.invalid/webhook", format: "generic" };
async function webhook(userId = actor) {
  const preference = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, subscribedEvents: [], thresholds: {} },
    update: {},
  });
  return prisma.notificationWebhook.create({
    data: { ...input, userId, preferenceId: preference.id, secret: "fixture-only" },
  });
}

const webhookTest = (id: string) => path + "/" + id + "/test";
const emailTest = "/v1/notification/email/test";
describe("generated test-delivery IAM routes", () => {
  it("requires authentication before any test delivery", async () => {
    await request(app).post(webhookTest("hook")).send({}).expect(401);
    await request(app).post(emailTest).send({}).expect(401);
    expect(axios.post).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("does not accept CRUD grant or forged Action as TestWebhook authorization", async () => {
    const own = await webhook();
    await grant(updateAction, arn(own.id));
    const route = webhookTest(own.id);
    await withReplayProtection(request(app).post(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", updateAction)
      .send({})
      .expect(403);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("sends a granted concrete own Webhook with replay protection", async () => {
    const own = await webhook();
    await grant(getAction, arn(own.id));
    const route = webhookTest(own.id);
    const response = await withReplayProtection(request(app).post(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .query({ userId: peer, accountOwnerId: peer })
      .send({})
      .expect(200);
    expect(response.body.data).toEqual({ success: true });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(own.url, expect.any(Object), expect.any(Object));
  });
  it("honors explicit TestWebhook Deny without revealing policy or signing credentials", async () => {
    const own = await webhook();
    await grant(getAction);
    await grant(getAction, arn(own.id), "Deny");
    const route = webhookTest(own.id);
    const response = await withReplayProtection(request(app).post(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .send({})
      .expect(403);
    expect(JSON.stringify(response.body)).not.toContain("Statement");
    expect(JSON.stringify(response.body)).not.toContain("fixture-only");
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("cannot send a peer Webhook despite a wildcard grant", async () => {
    const other = await webhook(peer);
    await grant(getAction);
    const route = webhookTest(other.id);
    await withReplayProtection(request(app).post(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .send({})
      .expect(404);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("requires TestEmail before preference initialization", async () => {
    await grant("quyan:notification:UpdatePreferences");
    await withReplayProtection(request(app).post(emailTest), {}, emailTest)
      .set("Authorization", "Bearer " + (await token()))
      .send({})
      .expect(403);
    expect(await prisma.notificationPreference.findUnique({ where: { userId: actor } })).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("sends email only to own configured address under a narrow user grant", async () => {
    const own = await webhook();
    await prisma.notificationPreference.update({
      where: { id: own.preferenceId },
      data: { notificationEmail: "own@example.invalid" },
    });
    await grant(createAction, "acs:quyan:*:" + owner + ":user/" + actor);
    const response = await withReplayProtection(request(app).post(emailTest), {}, emailTest)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", "quyan:notification:Manage")
      .query({ userId: peer, email: "other@example.invalid" })
      .send({})
      .expect(200);
    expect(response.body.data).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "own@example.invalid" }));
    expect(await prisma.notificationInboxItem.count({ where: { userId: actor } })).toBe(1);
  });
  it("sanitizes and localizes transport errors in the wire response", async () => {
    const own = await webhook();
    await grant(getAction);
    const route = webhookTest(own.id);
    vi.mocked(axios.post).mockRejectedValue(new Error("fixture-only credential=https://internal.invalid"));
    const response = await withReplayProtection(request(app).post(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Locale", "zh-CN")
      .send({})
      .expect(200);
    expect(response.body.data).toEqual({ success: false, error: "测试投递失败，请检查目标地址和投递配置。" });
    expect(JSON.stringify(response.body)).not.toContain("fixture-only");
    expect(JSON.stringify(response.body)).not.toContain("internal.invalid");
  });
  it("requires replay protection on both test-delivery endpoints", async () => {
    const own = await webhook();
    await grant([getAction, createAction]);
    for (const route of [webhookTest(own.id), emailTest]) {
      const response = await request(app)
        .post(route)
        .set("Authorization", "Bearer " + (await token()))
        .send({});
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(axios.post).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
