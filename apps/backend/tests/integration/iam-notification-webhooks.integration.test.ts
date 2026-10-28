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
const getAction = "quyan:notification:ListWebhooks";
const createAction = "quyan:notification:CreateWebhook",
  updateAction = "quyan:notification:UpdateWebhook",
  deleteAction = "quyan:notification:DeleteWebhook";
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let app: Express;
let owner: string, actor: string, peer: string;
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
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
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
describe("generated Webhook CRUD routes", () => {
  it("requires authentication on all four routes", async () => {
    await request(app).get(path).expect(401);
    await request(app).post(path).send(input).expect(401);
    await request(app)
      .put(path + "/hook")
      .send({ name: "Changed" })
      .expect(401);
    await request(app)
      .delete(path + "/hook")
      .expect(401);
  });
  it("returns no implicit Webhook content without a grant", async () => {
    await webhook();
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(response.body.data).toEqual([]);
  });
  it("uses fixed Action and own target resources despite forged identity and headers", async () => {
    const own = await webhook();
    await webhook(peer);
    await grant(getAction, arn(own.id));
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", createAction)
      .set("X-Account-Id", peer)
      .query({ userId: peer, resource: arn(own.id, peer) })
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: own.id, hasSecret: true });
    expect(response.body.data[0]).not.toHaveProperty("secret");
    expect(response.body.data[0]).not.toHaveProperty("userId");
  });
  it("creates an own Webhook with a narrow user grant and protected replay headers", async () => {
    await grant(createAction, "acs:quyan:*:" + owner + ":user/" + actor);
    const response = await withReplayProtection(request(app).post(path), input, path)
      .set("Authorization", "Bearer " + (await token()))
      .send(input)
      .expect(200);
    expect(response.body.data).toMatchObject({ name: input.name, hasSecret: false });
    expect(response.body.data).not.toHaveProperty("secret");
    const row = await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(row.userId).toBe(actor);
  });
  it("updates a specific Webhook but cannot mutate another or expose Deny details", async () => {
    const own = await webhook(),
      other = await webhook();
    await grant(updateAction, arn(own.id));
    const body = { secret: null, enabled: false };
    const route = path + "/" + own.id;
    const response = await withReplayProtection(request(app).put(route), body, route)
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(200);
    expect(response.body.data).toMatchObject({ hasSecret: false, enabled: false });
    const otherRoute = path + "/" + other.id;
    const denied = await withReplayProtection(request(app).put(otherRoute), body, otherRoute)
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(403);
    expect(JSON.stringify(denied.body)).not.toContain("Statement");
    expect(JSON.stringify(denied.body)).not.toContain("fixture-only");
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: other.id } })).enabled).toBe(true);
  });
  it("honors explicit deletion Deny before any write", async () => {
    const own = await webhook();
    await grant(deleteAction);
    await grant(deleteAction, arn(own.id), "Deny");
    const route = path + "/" + own.id;
    await withReplayProtection(request(app).delete(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .send({})
      .expect(403);
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it("soft deletes an allowed target without disclosing secrets", async () => {
    const own = await webhook();
    await grant(deleteAction, arn(own.id));
    const route = path + "/" + own.id;
    const response = await withReplayProtection(request(app).delete(route), {}, route)
      .set("Authorization", "Bearer " + (await token()))
      .send({})
      .expect(200);
    expect(response.body.data).toEqual({ success: true });
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(0);
  });
  it("requires replay protection for create, update and delete", async () => {
    const own = await webhook();
    await grant([createAction, updateAction, deleteAction]);
    for (const operation of [
      request(app).post(path).send(input),
      request(app)
        .put(path + "/" + own.id)
        .send({ name: "Changed" }),
      request(app)
        .delete(path + "/" + own.id)
        .send({}),
    ]) {
      const response = await operation.set("Authorization", "Bearer " + (await token()));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).name).toBe(input.name);
    expect(await prisma.notificationWebhook.count({ where: { userId: actor } })).toBe(1);
  });
});
