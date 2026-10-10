import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "@/app";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { RamService } from "@/services/users/ram.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { accessKeyArn } from "@/iam/resources/accesskey-resources";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance();
const action = "quyan:ram:ListAccessKeys";
let app: Express, owner: string, actor: string, peer: string;
beforeAll(() => {
  app = createApp();
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "access-key-http-" + randomUUID(),
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
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
const key = (userId = actor) => prisma.accessKey.create({ data: { userId, key: "fixture-only-" + randomUUID() } });
async function token() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
  return JWTAccessIns.generateToken(
    { userId: actor, updatedAt: user.updateTime.toISOString(), status: user.status },
    60,
  );
}
async function grant(Resource: string, Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "access-key-list-http-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action: action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const list = () => request(app).get("/v1/accesskeys/page");
describe("generated resource-filtered AccessKey list routes", () => {
  it("requires authentication on both list routes", async () => {
    await list().expect(401);
    await request(app).get("/v1/accesskeys").expect(401);
  });
  it("evaluates fixed list Actions, filters concrete resources, and never returns credentials or an unfiltered total", async () => {
    const own = await key(),
      hidden = await key(),
      peerKey = await key(peer);
    await grant(accessKeyArn(owner, actor, own.id));
    const response = await list()
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", "quyan:ram:DeleteAccessKey")
      .set("X-Account-Id", peer)
      .query({ page: 1, pageSize: 10, accountOwnerId: peer, userId: peer })
      .expect(200);
    expect(response.body.data.items.map((row: { id: string }) => row.id)).toEqual([own.id]);
    expect(response.body.data).toMatchObject({ page: 1, pageSize: 10, hasNext: false });
    expect(response.body.data).not.toHaveProperty("total");
    for (const secret of [own.key, hidden.key, peerKey.key, hidden.id, peerKey.id])
      expect(JSON.stringify(response.body)).not.toContain(secret);
  });
  it("returns an empty authorized list under implicit or explicit Deny, not a blanket collection error", async () => {
    const own = await key();
    const denied = await list()
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(denied.body.data.items).toEqual([]);
    await grant("*");
    await grant(accessKeyArn(owner, actor, own.id), "Deny");
    const explicit = await list()
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(explicit.body.data.items).toEqual([]);
    expect(JSON.stringify(explicit.body)).not.toContain(own.key);
  });
  it("retains complete authorized array responses and allows a later page after an empty filtered page", async () => {
    const own = await key(),
      hidden = await key();
    await prisma.accessKey.update({ where: { id: own.id }, data: { createTime: new Date(0) } });
    await prisma.accessKey.update({ where: { id: hidden.id }, data: { createTime: new Date(1000) } });
    await grant(accessKeyArn(owner, actor, own.id));
    const first = await list()
      .set("Authorization", "Bearer " + (await token()))
      .query({ page: 1, pageSize: 1 })
      .expect(200);
    expect(first.body.data).toMatchObject({ items: [], hasNext: true });
    const next = await list()
      .set("Authorization", "Bearer " + (await token()))
      .query({ page: 2, pageSize: 1 })
      .expect(200);
    expect(next.body.data.items.map((row: { id: string }) => row.id)).toEqual([own.id]);
    expect(next.body.data.hasNext).toBe(false);
    const all = await request(app)
      .get("/v1/accesskeys")
      .set("Authorization", "Bearer " + (await token()))
      .expect(200);
    expect(all.body.data.map((row: { id: string }) => row.id)).toEqual([own.id]);
    expect(JSON.stringify(all.body)).not.toContain(own.key);
  });
  it.each([{ page: 0 }, { page: 10001 }, { pageSize: 101 }, { pageSize: 0 }, { page: "not-a-number" }])(
    "rejects invalid page queries %j",
    async (query) => {
      await list()
        .set("Authorization", "Bearer " + (await token()))
        .query(query)
        .expect(422);
    },
  );
});
