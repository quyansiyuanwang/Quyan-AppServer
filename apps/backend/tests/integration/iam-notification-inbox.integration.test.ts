import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "@/app";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { RamService } from "@/services/users/ram.service";
import { withReplayProtection } from "../util/replay-protection-test-helper";

const path = "/v1/notification/inbox";
const getAction = "quyan:notification:ListInbox";
const updateAction = "quyan:notification:MarkInboxRead";
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let app: Express;
let owner: string, actor: string, peer: string;
const arn = (itemId: string, userId = actor) => "acs:notification:*:" + owner + ":inbox-item/" + userId + "/" + itemId;

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

async function message(userId = actor, data = {}) {
  return prisma.notificationInboxItem.create({
    data: { userId, eventType: "balance_low", title: "Inbox HTTP fixture", content: "Fixture content", ...data },
  });
}
const read = (id: string) => prisma.notificationInboxItem.findUniqueOrThrow({ where: { id } });
describe("generated inbox routes with authenticated self IAM", () => {
  it("returns 401 before accessing an unauthenticated inbox", async () => {
    await request(app).get(path).expect(401);
  });
  it("retains self access with no legacy permission and ignores forged action/identity inputs", async () => {
    const own = await message();
    await message(peer);
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", updateAction)
      .query({ userId: peer, accountOwnerId: peer })
      .expect(200);
    expect(response.body.data).toMatchObject({ total: 1, unreadCount: 1, items: [{ id: own.id }] });
    expect(response.body.data.items[0]).not.toHaveProperty("userId");
  });
  it("honors explicit false and true unread query values", async () => {
    await message();
    await message(actor, { isRead: true });
    const all = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .query({ unreadOnly: "false" })
      .expect(200);
    expect(all.body.data.total).toBe(2);
    const unread = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .query({ unreadOnly: "true" })
      .expect(200);
    expect(unread.body.data.total).toBe(1);
    expect(unread.body.data.items[0].isRead).toBe(false);
  });
  it("filters resource Deny and uses authorized totals through generated routes", async () => {
    const own = await message(),
      denied = await message(actor, { pixelOpened: true });
    await grant(getAction, arn(denied.id), "Deny");
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .query({ pageSize: 1 })
      .expect(200);
    expect(response.body.data).toMatchObject({
      total: 1,
      unreadCount: 1,
      pixelOpenedUnreadCount: 0,
      items: [{ id: own.id }],
    });
  });
  it("checks every requested resource before updating and does not leak policy details in 403", async () => {
    const own = await message(),
      denied = await message();
    await grant(updateAction, arn(denied.id), "Deny");
    const body = { ids: [own.id, denied.id] };
    const response = await withReplayProtection(request(app).post(path + "/read"), body, path + "/read")
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(403);
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("Statement");
    expect((await read(own.id)).isRead).toBe(false);
    expect((await read(denied.id)).isRead).toBe(false);
  });
  it("marks selected own messages read with valid replay headers", async () => {
    const own = await message();
    const body = { ids: [own.id] };
    const response = await withReplayProtection(request(app).post(path + "/read"), body, path + "/read")
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(200);
    expect(response.body.data).toEqual({ success: true, count: 1 });
    expect(await read(own.id)).toMatchObject({ isRead: true, readSource: "manual" });
  });
  it("requires replay protection on both mutation routes", async () => {
    const own = await message(actor, { pixelOpened: true });
    for (const route of [path + "/read", path + "/confirm-pixel-read"]) {
      const response = await request(app)
        .post(route)
        .set("Authorization", "Bearer " + (await token()))
        .send({ ids: [own.id] });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect((await read(own.id)).isRead).toBe(false);
  });
  it("confirms email pixel reads through its own Action and only authorized opened messages", async () => {
    const own = await message(actor, { pixelOpened: true }),
      denied = await message(actor, { pixelOpened: true });
    await grant("quyan:notification:ConfirmPixelOpenedInboxRead", arn(denied.id), "Deny");
    const route = path + "/confirm-pixel-read",
      body = {};
    const response = await withReplayProtection(request(app).post(route), body, route)
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(200);
    expect(response.body.data).toEqual({ success: true, count: 1 });
    expect(await read(own.id)).toMatchObject({ isRead: true, readSource: "pixel" });
    expect((await read(denied.id)).isRead).toBe(false);
  });
});
