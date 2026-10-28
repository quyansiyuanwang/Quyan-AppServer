import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { PlatformOAuthClientMutationIamService } from "@/services/users/platform-oauth-client-mutation-iam.service";
import { PlatformOAuthClientMutationRepository } from "@/store/users/platform-oauth-client-mutation.repository";
import { platformOAuthControlArn } from "@/iam/resources/platform-oauth-resources";
import { Permission } from "@quyan/shared";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, foreign: string;
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

const prepare = () => service.prepareCreate(actor, request());
const input = () => ({
  userId: actor,
  name: "fixture issued",
  clientId: "fixture-" + randomUUID(),
  clientType: "public",
  reviewStatus: "approved",
  reviewedByUserId: actor,
  reviewedAt: new Date(),
  grantTypes: ["authorization_code"],
  redirectUris: ["https://example.com/callback"],
  scopes: ["profile"],
  isPkceRequired: true,
  accessTokenLifetime: 600,
  refreshTokenLifetime: 3600,
  isSystemClient: true,
});
const guarded = async () => ({ ...(await prepare()), scopeCheck: async () => {} });
describe("platform OAuth application creation database", () => {
  it("creates an approved app using the fixed platform parent and returns no secret hash", async () => {
    await globalGroup();
    const data = input(),
      row = await service.create(data, await guarded());
    expect(row).toMatchObject({
      clientId: data.clientId,
      userId: actor,
      reviewedByUserId: actor,
      isSystemClient: true,
      reviewStatus: "approved",
      hasClientSecret: false,
    });
    expect(row).not.toHaveProperty("clientSecretHash");
  });
  it("requires a real global ceiling even for broad identity policies and honors Deny", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup();
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: owner } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: null } });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oauth:CreateSystemClient", Resource: platformOAuthControlArn() },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed groups and identities and removed management rights before creation", async () => {
    const group = await globalGroup(),
      guard = await guarded();
    await prisma.group.update({ where: { id: group.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.create(input(), guard)).rejects.toMatchObject({ statusCode: 403 });
    const userGuard = await guarded();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.create(input(), userGuard)).rejects.toMatchObject({ statusCode: 403 });
    const revoked = await guarded();
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.create(input(), revoked)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(0);
  });
  it("rolls back new records when the final policy or scope check fails", async () => {
    await globalGroup();
    const guard = await guarded(),
      original = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await original();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(service.create(input(), guard)).rejects.toThrow("fixture final deny");
    const scopeGuard = await guarded();
    let scopeCalls = 0;
    scopeGuard.scopeCheck = async () => {
      if (++scopeCalls === 2) throw new Error("fixture scope revoke");
    };
    await expect(service.create(input(), scopeGuard)).rejects.toThrow("fixture scope revoke");
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(0);
  });
  it("rejects forged creator or preapproval fields and translates duplicate IDs safely", async () => {
    await globalGroup();
    const guard = await guarded(),
      data = input();
    for (const patch of [
      { userId: foreign },
      { isSystemClient: false },
      { reviewStatus: "draft" },
      { reviewedByUserId: owner },
    ])
      await expect(mutations.create({ ...data, ...patch }, guard)).rejects.toMatchObject({ statusCode: 403 });
    await service.create(data, guard);
    await expect(service.create(data, await guarded())).rejects.toMatchObject({
      statusCode: 400,
      messageKey: "oauth.clientIdExists",
    });
    expect(await prisma.oAuthClient.count({ where: { clientId: data.clientId } })).toBe(1);
  });
  it("rejects creation after the active role session is revoked", async () => {
    await globalGroup();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "system-create-role-" + randomUUID() },
    });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:oauth:CreateSystemClient", Resource: platformOAuthControlArn() },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "system-create-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "role",
        principalId: role.id,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    Object.assign(req.authContext!, { roleSessionId: session.id, assumedRoleId: role.id });
    const guard = { ...(await service.prepareCreate(actor, req)), scopeCheck: async () => {} };
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.create(input(), guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(0);
  });
});
