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
import { withReplayProtection } from "../util/replay-protection-test-helper";
import { CustomCode } from "@quyan/shared";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance();
const action = "quyan:ram:DeleteAccessKey";
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
const path = (id: string) => "/v1/accesskeys/" + id;
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
    name: "access-key-http-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action: action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const remove = (id: string) => withReplayProtection(request(app).delete(path(id)), {}, path(id)).send({});
describe("generated concrete AccessKey revocation route", () => {
  it("requires authentication", async () => {
    await request(app).delete(path("key")).expect(401);
  });
  it("revokes a concrete granted key while ignoring forged Action and account parameters", async () => {
    const own = await key();
    await grant(accessKeyArn(owner, actor, own.id));
    const response = await remove(own.id)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", "*")
      .query({ accountOwnerId: peer })
      .expect(200);
    expect(response.body.data).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(own.key);
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(-1);
  });
  it("rejects ungranted keys and explicit Deny without credential disclosure", async () => {
    const own = await key(),
      other = await key();
    await grant(accessKeyArn(owner, actor, own.id));
    const denied = await remove(other.id)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(JSON.stringify(denied.body)).not.toContain(other.key);
    await grant(accessKeyArn(owner, actor, own.id), "Deny");
    await remove(own.id)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it("retains own-user isolation even with wildcard resource grants", async () => {
    const target = await key(peer);
    await grant("*");
    await remove(target.id)
      .set("Authorization", "Bearer " + (await token()))
      .expect(404);
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(1);
  });
  it("still requires replay headers before a granted deletion", async () => {
    const own = await key();
    await grant(accessKeyArn(owner, actor, own.id));
    await request(app)
      .delete(path(own.id))
      .set("Authorization", "Bearer " + (await token()))
      .expect(400);
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it("retains the mandatory two-factor challenge on high-risk revocation", async () => {
    const own = await key();
    await grant(accessKeyArn(owner, actor, own.id));
    await prisma.user.update({ where: { id: actor }, data: { twoFactorEnabled: true } });
    const challenged = await remove(own.id)
      .set("Authorization", "Bearer " + (await token()))
      .expect(401);
    expect(challenged.body.code).toBe(CustomCode.TWO_FACTOR_REQUIRED);
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
});
