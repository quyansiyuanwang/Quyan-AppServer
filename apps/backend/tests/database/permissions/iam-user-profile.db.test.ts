import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, actionForPermission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { UserService } from "@/services/users/user.service";
import { UserProfileIamService } from "@/services/users/user-profile-iam.service";
import { UserProfileManagementRepository } from "@/store/users/user-profile-management.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance(),
  service = new UserService(),
  iam = UserProfileIamService.getInstance(),
  repo = UserProfileManagementRepository.getInstance();
let owner: string, actor: string, peer: string, foreign: string;
const action = "quyan:user:UpdateProfile",
  readAction = "quyan:user:GetCurrentUser";
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const identity = () => ({ principal: principal() });
const request = (auth = {}) =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    params: { userId: peer },
    query: { userId: peer, accountOwnerId: foreign },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const arn = (id = actor) => `acs:quyan:*:${owner}:user/${id}`;
async function grant(Action = action, Resource = arn(), Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "profile-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "profile-" + randomUUID(),
          password: "fixture-password-never-return",
          email: "fixture-" + randomUUID() + "@example.test",
          name: "original",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [Permission.USER_UPDATE_SELF_PROFILE],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("personal profile authorization and guarded projection", () => {
  it("reads own safe profile by default without manufacturing global read permission", async () => {
    await prisma.balanceAccount.create({ data: { userId: actor, balance: 12.25 } });
    const result = await service.getCurrentUser(actor, request());
    expect(result).toMatchObject({ id: actor, accountOwnerId: owner, balance: 12.25 });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("permissionAdds");
    expect(JSON.stringify(result)).not.toContain("fixture-password");
    await expect(iam.get(peer, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getCurrentUser(actor)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains root and shared-group personal profile visibility without foreign group data", async () => {
    const req = request();
    req.user = { ...req.user!, userId: owner };
    req.authContext = { principalUserId: owner, accountOwnerId: owner, subjectType: "root" };
    expect((await service.getCurrentUser(owner, req)).accountOwnerId).toBe(owner);
    const group = await prisma.group.create({
      data: { username: "global-profile-" + randomUUID(), name: "Shared member group", permissions: [], level: 10 },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    expect((await service.getCurrentUser(actor, request())).groupName).toBe("Shared member group");
    const auth = identity(),
      target = await repo.target(auth);
    await prisma.group.update({ where: { id: group.id }, data: { status: 0 } });
    await expect(repo.hydrate(auth, target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("explicit read Deny overrides the catalog default", async () => {
    await grant(readAction, arn(), "Deny");
    await expect(service.getCurrentUser(actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires explicit update permission and honors Deny without mutation", async () => {
    await expect(service.updateProfile(actor, { name: "blocked" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant();
    await service.updateProfile(actor, { name: "allowed" }, request());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("allowed");
    const audit = JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls);
    expect(audit).not.toContain("allowed");
    await grant(action, arn(), "Deny");
    await expect(service.updateProfile(actor, { name: "blocked" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("allowed");
  });
  it("never updates peers even with wildcard, or expands canonical legacy JSON Action", async () => {
    await grant(actionForPermission(Permission.USER_UPDATE_SELF_PROFILE), "*");
    await expect(service.updateProfile(actor, { name: "blocked" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant(action, "*");
    await expect(service.updateProfile(peer, { name: "blocked" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: peer } })).name).toBe("original");
  });
  it("projects explicit legacy permission adds/removes to native update", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.USER_UPDATE_SELF_PROFILE] } });
    await service.updateProfile(actor, { name: "allowed" }, request());
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.USER_UPDATE_SELF_PROFILE] },
    });
    await expect(service.updateProfile(actor, { name: "blocked" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each([
    { name: "concurrent" },
    { accountOwnerId: null },
    { status: 0 },
    { permissionRemoves: [Permission.USER_UPDATE_SELF_PROFILE] },
  ])("refuses stale reads and updates after user drift %j", async (data) => {
    const auth = identity(),
      target = await repo.target(auth);
    await prisma.user.update({
      where: { id: actor },
      data: { ...data, updateTime: new Date(target.updateTime.getTime() + 1000) },
    });
    await expect(repo.hydrate(auth, target)).rejects.toMatchObject({ statusCode: expect.any(Number) });
    await expect(repo.update(auth, target, { name: "overwritten" })).rejects.toMatchObject({
      statusCode: expect.any(Number),
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).not.toBe("overwritten");
  });
  it("rejects disabled owners and foreign groups before profile details", async () => {
    const group = await prisma.group.create({
      data: {
        accountOwnerId: foreign,
        username: "profile-group-" + randomUUID(),
        name: "foreign-group-sensitive",
        permissions: [],
        level: 10,
      },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    await expect(service.getCurrentUser(actor, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    const auth = identity(),
      target = await repo.target(auth);
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repo.hydrate(auth, target)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repo.update(auth, target, {})).rejects.toMatchObject({ statusCode: 403 });
  });
  it("allows only one writer for a shared profile revision", async () => {
    const auth = identity(),
      target = await repo.target(auth);
    const results = await Promise.allSettled([
      repo.update(auth, target, { name: "first" }),
      repo.update(auth, target, { name: "second" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
  it("validates role session state and isolates user-granted update from the assumed role", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "profile-role" } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = {
      principal: {
        ...principal(),
        subjectType: "assumed_role" as const,
        assumedRoleId: role.id,
        roleSessionId: session.id,
      },
    };
    const req = request({ assumedRoleId: role.id, roleSessionId: session.id });
    expect((await service.getCurrentUser(actor, req)).id).toBe(actor);
    await grant();
    await expect(service.updateProfile(actor, { name: "blocked" }, req)).rejects.toMatchObject({ statusCode: 403 });
    const target = await repo.target(auth);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(repo.hydrate(auth, target)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repo.update(auth, target, {})).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["revoke-token", "disable-client", "remove-scope"])(
    "refuses stale OAuth authority at hydration and update: %s",
    async (change) => {
      const client = await prisma.oAuthClient.create({
        data: {
          userId: owner,
          name: "fixture-client",
          clientId: "fixture-" + randomUUID(),
          reviewStatus: "approved",
          grantTypes: ["authorization_code"],
          redirectUris: ["https://example.test/callback"],
          scopes: ["profile"],
        },
      });
      const token = await prisma.oAuthAccessToken.create({
        data: {
          userId: actor,
          oauthClientId: client.id,
          tokenHash: "fixture-" + randomUUID(),
          scopes: ["profile"],
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const auth = { principal: principal(), oauth: { id: token.id, clientId: client.id } },
        target = await repo.target(auth);
      if (change === "disable-client")
        await prisma.oAuthClient.update({ where: { id: client.id }, data: { status: 0 } });
      else
        await prisma.oAuthAccessToken.update({
          where: { id: token.id },
          data: change === "revoke-token" ? { revokedAt: new Date() } : { scopes: [] },
        });
      await expect(repo.hydrate(auth, target)).rejects.toMatchObject({ statusCode: 403 });
      await expect(repo.update(auth, target, { name: "blocked" })).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).name).toBe("original");
    },
  );
  it.each(["legacy", "shadow"] as const)(
    "keeps %s behavior and requires the legacy update permission",
    async (mode) => {
      await grant(readAction, arn(), "Deny");
      env.security.iamAuthorizationMode = mode;
      expect((await service.getCurrentUser(actor, request())).id).toBe(actor);
      await expect(service.updateProfile(actor, { name: "blocked" }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      await prisma.user.update({
        where: { id: actor },
        data: { permissionAdds: [Permission.USER_UPDATE_SELF_PROFILE] },
      });
      await service.updateProfile(actor, { name: "legacy-allowed" }, request());
    },
  );
});
