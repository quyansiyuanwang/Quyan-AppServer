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

const path = "/v1/notification/preferences";
const getAction = "quyan:notification:GetPreferences";
const updateAction = "quyan:notification:UpdatePreferences";
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let app: Express;
let owner: string, actor: string, peer: string;
const arn = (id = actor) => "acs:quyan:*:" + owner + ":user/" + id;
const preference = () => prisma.notificationPreference.findUnique({ where: { userId: actor } });
async function token() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
  return JWTAccessIns.generateToken(
    { userId: actor, updatedAt: user.updateTime.toISOString(), status: user.status },
    60,
  );
}
async function grant(Action: string | string[], Resource = arn(), Effect: "Allow" | "Deny" = "Allow") {
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

describe("generated notification preference routes with JWT and IAM", () => {
  it("rejects an unauthenticated read with 401 before initialization", async () => {
    await request(app).get(path).expect(401);
    expect(await preference()).toBeNull();
  });
  it("rejects authenticated reads without Allow and does not expose policy or identity data", async () => {
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(actor);
    expect(JSON.stringify(response.body)).not.toContain("Statement");
    expect(await preference()).toBeNull();
  });
  it("uses the server Action and authenticated user despite forged action and resource inputs", async () => {
    await grant(getAction);
    const response = await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", updateAction)
      .set("X-Account-Id", peer)
      .query({ userId: peer, resource: arn(peer) })
      .expect(200);
    expect(response.body.data.id).toBe((await preference())?.id);
    expect(response.body.data).not.toHaveProperty("userId");
    expect(await prisma.notificationPreference.findUnique({ where: { userId: peer } })).toBeNull();
  });
  it("does not let a grant on another user's ARN initialize the executing user's preference", async () => {
    await grant(getAction, arn(peer));
    await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(await preference()).toBeNull();
  });
  it("saves with update permission and valid replay headers without requiring read permission", async () => {
    await grant(updateAction);
    const body = { cooldownMinutes: 12, subscribedEvents: [] };
    const response = await withReplayProtection(request(app).put(path), body, path)
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(200);
    expect(response.body.data).toMatchObject({ cooldownMinutes: 12, subscribedEvents: [] });
    expect(await preference()).toMatchObject({ userId: actor, cooldownMinutes: 12 });
    await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
  });
  it("keeps replay protection ahead of preference persistence", async () => {
    await grant(updateAction);
    const response = await request(app)
      .put(path)
      .set("Authorization", "Bearer " + (await token()))
      .send({ cooldownMinutes: 12 });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await preference()).toBeNull();
  });
  it("lets explicit resource Deny override wildcard Allow through generated routes", async () => {
    await grant([getAction, updateAction], "*");
    await grant([getAction, updateAction], arn(), "Deny");
    await request(app)
      .get(path)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    const body = { cooldownMinutes: 12 };
    await withReplayProtection(request(app).put(path), body, path)
      .set("Authorization", "Bearer " + (await token()))
      .send(body)
      .expect(403);
    expect(await preference()).toBeNull();
  });
});
