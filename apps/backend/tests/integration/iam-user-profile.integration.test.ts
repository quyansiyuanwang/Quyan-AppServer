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
import { Permission } from "@quyan/shared";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance(),
  profilePath = "/v1/users/me/profile",
  readPath = "/v1/users/me";
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
async function grant(Action = "quyan:user:UpdateProfile", Effect: "Allow" | "Deny" = "Allow") {
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
const update = (body: { name?: string } = { name: "fixture-sensitive-display-name" }) =>
  withReplayProtection(request(app).patch(profilePath), body, profilePath).send(body);
async function oauth(scopes = ["profile"]) {
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
describe("generated personal profile IAM routes", () => {
  it("requires authentication for reads and updates", async () => {
    await request(app).get(readPath).expect(401);
    await request(app).patch(profilePath).send({}).expect(401);
  });
  it("reads the executing user's safe profile with default self grant despite forged inputs", async () => {
    const result = await request(app)
      .get(readPath)
      .set("Authorization", "Bearer " + (await token()))
      .set("X-Action", "*")
      .query({ userId: peer, accountOwnerId: peer })
      .expect(200);
    expect(result.body.data).toMatchObject({ id: actor, accountOwnerId: owner });
    expect(result.body.data).not.toHaveProperty("password");
    expect(result.body.data).not.toHaveProperty("permissionAdds");
    expect(result.body.data).not.toHaveProperty("twoFactorCredential");
  });
  it("honors explicit Deny over default own-read permission without policy disclosure", async () => {
    await grant("quyan:user:GetCurrentUser", "Deny");
    const result = await request(app)
      .get(readPath)
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect(JSON.stringify(result.body)).not.toContain("Statement");
    expect(JSON.stringify(result.body)).not.toContain("fixture-password");
  });
  it("requires native write Allow, preserves own-user scope, and uses identifier-only mutation audit", async () => {
    await update()
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    await grant();
    const result = await update()
      .set("Authorization", "Bearer " + (await token()))
      .query({ userId: peer, accountOwnerId: peer })
      .expect(200);
    expect(result.body.data).toMatchObject({ id: actor, name: "fixture-sensitive-display-name" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: peer } })).name).toBe("original");
    expect(JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls)).not.toContain(
      "fixture-sensitive-display-name",
    );
    await grant("quyan:user:UpdateProfile", "Deny");
    await update({ name: "blocked" })
      .set("Authorization", "Bearer " + (await token()))
      .expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("fixture-sensitive-display-name");
  });
  it("preserves view-only impersonation despite an update Allow", async () => {
    await grant();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
    const auth = JWTAccessIns.generateToken(
      {
        userId: actor,
        updatedAt: user.updateTime.toISOString(),
        status: user.status,
        impersonatorId: owner,
        impersonationMode: "view",
      },
      60,
    );
    await request(app)
      .get(readPath)
      .set("Authorization", "Bearer " + auth)
      .expect(200);
    await update()
      .set("Authorization", "Bearer " + auth)
      .expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("original");
  });
  it("preserves replay and profile input validation", async () => {
    await grant();
    const auth = "Bearer " + (await token());
    await request(app).patch(profilePath).set("Authorization", auth).send({ name: "blocked" }).expect(400);
    const invalid = { name: "x".repeat(51) };
    await withReplayProtection(request(app).patch(profilePath), invalid, profilePath)
      .send(invalid)
      .set("Authorization", auth)
      .expect(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("original");
  });
  it.each(["profile", Permission.USER_UPDATE_SELF_PROFILE])(
    "keeps OAuth %s scope compatible while applying IAM read/write rules",
    async (scope) => {
      const delegated = await oauth([scope]),
        auth = "Bearer " + delegated.secret;
      await request(app).get(readPath).set("Authorization", auth).expect(200);
      await update().set("Authorization", auth).expect(403);
      await grant();
      await update().set("Authorization", auth).expect(200);
      await prisma.oAuthAccessToken.update({ where: { id: delegated.stored.id }, data: { revokedAt: new Date() } });
      await request(app).get(readPath).set("Authorization", auth).expect(401);
    },
  );
  it("rejects OAuth without profile scope", async () => {
    const delegated = await oauth(["email"]);
    await request(app)
      .get(readPath)
      .set("Authorization", "Bearer " + delegated.secret)
      .expect(403);
    await update()
      .set("Authorization", "Bearer " + delegated.secret)
      .expect(403);
  });
  it.each(["legacy", "shadow"] as const)(
    "retains %s read compatibility while enforcing legacy profile update permission",
    async (mode) => {
      await grant("quyan:user:GetCurrentUser", "Deny");
      env.security.iamAuthorizationMode = mode;
      await request(app)
        .get(readPath)
        .set("Authorization", "Bearer " + (await token()))
        .expect(200);
      await update()
        .set("Authorization", "Bearer " + (await token()))
        .expect(403);
      await prisma.user.update({
        where: { id: actor },
        data: { permissionAdds: [Permission.USER_UPDATE_SELF_PROFILE] },
      });
      await update()
        .set("Authorization", "Bearer " + (await token()))
        .expect(200);
    },
  );
});
