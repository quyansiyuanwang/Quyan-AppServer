import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "@/app";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { RamService } from "@/services/users/ram.service";

const path = "/v1/notification/logs";
const eventsPath = "/v1/notification/events";
const getAction = "quyan:notification:ListDeliveryLogs";
const eventAction = "quyan:notification:ListEvents";
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let app: Express;
let owner: string, actor: string, peer: string;
const arn = (itemId: string, userId = actor) =>
  "acs:notification:*:" + owner + ":delivery-log/" + userId + "/" + itemId;

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

async function delivery(userId = actor, data = {}) {
  return prisma.notificationLog.create({
    data: {
      userId,
      eventType: "balance_low",
      title: "History HTTP fixture",
      content: "Fixture content",
      channel: "email",
      deliveryStatus: "sent",
      ...data,
    },
  });
}
describe("generated delivery history and event routes", () => {
  it("rejects unauthenticated requests to both endpoints before accessing content", async () => {
    await request(app).get(path).expect(401);
    await request(app).get(eventsPath).expect(401);
  });
  it("returns an empty authorized log list without a grant and preserves authenticated event access", async () => {
    await delivery();
    const logs = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(logs.body.data).toMatchObject({ logs: [], total: 0 });
    const events = await request(app)
      .get(eventsPath)
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(events.body.data.length).toBeGreaterThan(0);
  });
  it("uses fixed server Action and actual executing-user resources despite forged inputs", async () => {
    const own = await delivery();
    await delivery(peer);
    await grant(getAction, arn(own.id));
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", eventAction)
      .set("X-Account-Id", peer)
      .query({ userId: peer, resource: arn(own.id, peer) })
      .expect(200);
    expect(response.body.data).toMatchObject({ total: 1, logs: [{ id: own.id }] });
    expect(response.body.data.logs[0]).not.toHaveProperty("userId");
    expect(response.body.data.logs[0]).not.toHaveProperty("metadata");
  });
  it("applies per-log Deny before totals and pagination through generated routes", async () => {
    const hidden = await delivery(actor, { createTime: new Date(2026, 0, 3) }),
      own = await delivery(actor, { createTime: new Date(2026, 0, 1) });
    await grant(getAction, "*");
    await grant(getAction, arn(hidden.id), "Deny");
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .query({ pageSize: 1 })
      .expect(200);
    expect(response.body.data).toMatchObject({ total: 1, logs: [{ id: own.id }] });
  });
  it("cannot rescue a peer log grant by changing target query or headers", async () => {
    const other = await delivery(peer);
    await grant(getAction, arn(other.id, peer));
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .query({ userId: peer })
      .expect(200);
    expect(response.body.data).toMatchObject({ total: 0, logs: [] });
  });
  it("honors self event Deny with a safe 403 response", async () => {
    await grant(eventAction, "acs:quyan:*:" + owner + ":user/" + actor, "Deny");
    const response = await request(app)
      .get(eventsPath)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("Statement");
    expect(JSON.stringify(response.body)).not.toContain(actor);
  });
  it("keeps invalid pagination in the validation path", async () => {
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .query({ page: 0, pageSize: 101 });
    expect([400, 422]).toContain(response.status);
  });
});
