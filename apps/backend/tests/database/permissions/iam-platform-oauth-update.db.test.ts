import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { PlatformOAuthClientMutationIamService } from "@/services/users/platform-oauth-client-mutation-iam.service";
import { PlatformOAuthClientMutationRepository } from "@/store/users/platform-oauth-client-mutation.repository";
import { platformOAuthClientArn } from "@/iam/resources/platform-oauth-resources";
import { Permission } from "@quyan/shared";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, foreign: string, visible: string, hidden: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "oauth-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const client = async (userId: string, isSystemClient = false) =>
  (
    await prisma.oAuthClient.create({
      data: {
        userId,
        name: "fixture",
        clientId: "fixture-" + randomUUID(),
        clientSecretHash: "fixture-hash-never-selected",
        clientSecretPreview: "fixture-mask",
        grantTypes: ["authorization_code"],
        scopes: ["oauth_client"],
        redirectUris: [],
        isSystemClient,
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const service = PlatformOAuthClientMutationIamService.getInstance(),
  mutations = PlatformOAuthClientMutationRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  // This file uses global system resources; remove only fixtures from earlier tests in its isolated worker database.
  await prisma.oAuthClient.updateMany({
    where: { isSystemClient: true, clientId: { startsWith: "fixture-" } },
    data: { status: -1 },
  });
  owner = await user();
  actor = await user(owner);
  foreign = await user();
  visible = await client(foreign, true);
  hidden = await client(foreign, true);
});
async function globalGroup(permissions = [Permission.OAUTH_CLIENT_SYSTEM_MANAGE]) {
  const group = await prisma.group.create({
    data: { username: "platform-" + randomUUID(), name: "fixture global", level: 0, permissions, accountOwnerId: null },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
  return group;
}
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "platform-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}

const prepare = () => service.prepareUpdate(actor, visible, request());
describe("platform OAuth application mutation database", () => {
  it("updates a real system app created by another account through its platform ARN", async () => {
    await globalGroup();
    const prepared = await prepare();
    expect(prepared!.guard.target.userId).toBe(foreign);
    const updated = await service.update({ name: "updated system", accessTokenLifetime: 600 }, prepared!.guard);
    expect(updated).toMatchObject({
      id: visible,
      userId: foreign,
      isSystemClient: true,
      name: "updated system",
      accessTokenLifetime: 600,
    });
    expect(updated).not.toHaveProperty("clientSecretHash");
    expect((await prisma.oAuthClient.findUnique({ where: { id: hidden } }))!.name).toBe("fixture");
  });
  it("denies account-created groups, missing platform ceilings and explicit Deny", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup();
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: owner } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: null } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:oauth:UpdateSystemClient",
        Resource: platformOAuthClientArn(visible),
      },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale group, app and user versions without changing the target", async () => {
    const group = await globalGroup(),
      prepared = await prepare();
    await prisma.group.update({ where: { id: group.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update({ name: "stale-group" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    const app = await prepare();
    await prisma.oAuthClient.update({ where: { id: visible }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update({ name: "stale-app" }, app!.guard)).rejects.toMatchObject({ statusCode: 403 });
    const account = await prepare();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update({ name: "stale-user" }, account!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.name).toBe("fixture");
  });
  it("rejects ordinary apps and unknown or protected update fields", async () => {
    await globalGroup();
    const ordinary = await client(actor);
    await expect(service.prepareUpdate(actor, ordinary, request())).rejects.toMatchObject({ statusCode: 403 });
    const prepared = await prepare();
    for (const data of [{ isSystemClient: false }, { userId: actor }, { clientSecretHash: "fixture-denied" }])
      await expect(mutations.update(data as any, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back final scope and policy failures even after the record was changed", async () => {
    await globalGroup();
    const prepared = await prepare(),
      check = prepared!.guard.users.recheck;
    let calls = 0;
    prepared!.guard.users.recheck = async () => {
      await check();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(service.update({ name: "rollback" }, prepared!.guard)).rejects.toThrow("fixture final deny");
    const scopes = await prepare();
    let checks = 0;
    scopes!.guard.scopeCheck = async () => {
      if (++checks === 2) throw new Error("fixture scope revoke");
    };
    await expect(service.update({ scopes: ["profile"] }, scopes!.guard)).rejects.toThrow("fixture scope revoke");
    expect(await prisma.oAuthClient.findUnique({ where: { id: visible } })).toMatchObject({
      name: "fixture",
      scopes: ["oauth_client"],
    });
  });
  it("removing global-group management permissions after preparation blocks the commit", async () => {
    const group = await globalGroup(),
      prepared = await prepare();
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.update({ name: "revoked" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.name).toBe("fixture");
  });
});
