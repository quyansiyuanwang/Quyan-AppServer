import { OAuthClientMutationIamService } from "@/services/users/oauth-client-mutation-iam.service";
import type { OAuthClientCreateInput } from "@/store/users/oauth-client.store";
import { OAuthClientMutationRepository } from "@/store/users/oauth-client-mutation.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, peer: string, foreign: string, visible: string, hidden: string;
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
const arn = (id: string) => `acs:oauth:*:${owner}:client/${actor}/${id}`;
beforeEach(async () => {
  vi.restoreAllMocks();
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  visible = await client(actor);
  hidden = await client(actor);
});
async function bind(statements: unknown, scope?: { group: string }) {
  const parsed = parseIamPolicy({ Version: "1", Statement: statements });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "oauth-read-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: scope ? "resource-group" : "account",
      scopeResourceId: scope?.group,
      scopeKey: scope ? "resource-group:" + scope.group : "account",
      createdBy: owner,
    },
  });
}
const service = OAuthClientMutationIamService.getInstance(),
  mutations = OAuthClientMutationRepository.getInstance();

const createGrant = () =>
  bind({ Effect: "Allow", Action: "quyan:oauth:CreateClient", Resource: `acs:quyan:*:${owner}:user/${actor}` });
const data = (): OAuthClientCreateInput => ({
  userId: actor,
  name: "new fixture",
  clientId: "new-" + randomUUID(),
  clientSecretHash: "fixture-new-hash",
  clientSecretPreview: "fixture-mask",
  clientType: "confidential",
  reviewStatus: "draft",
  grantTypes: ["authorization_code", "refresh_token"],
  redirectUris: ["https://example.com/callback"],
  scopes: ["profile"],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 2592000,
});
const prepare = async () => ({ ...(await service.prepareCreate(actor, request())), scopeCheck: async () => {} });
describe("OAuth application creation database", () => {
  it("creates an ordinary draft app only on the trusted user resource", async () => {
    await createGrant();
    const guard = await prepare(),
      input = data(),
      result = await service.create(input, guard);
    expect(result).toMatchObject({
      userId: actor,
      name: "new fixture",
      status: 1,
      isSystemClient: false,
      reviewStatus: "draft",
      hasClientSecret: true,
    });
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(await prisma.oAuthClient.findUnique({ where: { id: result.id } })).toMatchObject({
      clientSecretHash: input.clientSecretHash,
    });
  });
  it("absent Allow and explicit Deny block preparation, read/write child grants do not authorize creation", async () => {
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await bind({
      Effect: "Allow",
      Action: ["quyan:oauth:GetClient", "quyan:oauth:UpdateClient"],
      Resource: arn(visible),
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await createGrant();
    await bind({ Effect: "Deny", Action: "quyan:oauth:CreateClient", Resource: "*" });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("prevents changed user, system and preapproved applications from using a creation guard", async () => {
    await createGrant();
    const guard = await prepare();
    for (const input of [
      { ...data(), userId: peer },
      { ...data(), userId: foreign },
      { ...data(), isSystemClient: true },
      { ...data(), reviewStatus: "approved" },
    ])
      await expect(service.create(input, guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(2);
  });
  it("rolls back creation after policy withdrawal and account version changes", async () => {
    const binding = await createGrant(),
      guard = await prepare();
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(service.create(data(), guard)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    const stale = await prepare();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.create(data(), stale)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(2);
  });
  it("rolls back the newly inserted app when final scope or authorization checks fail", async () => {
    await createGrant();
    const guard = await prepare(),
      check = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await check();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(mutations.create(data(), guard)).rejects.toThrow("fixture final deny");
    const scopes = await prepare();
    let scopeCalls = 0;
    scopes.scopeCheck = async () => {
      if (++scopeCalls === 2) throw new Error("fixture scope revoke");
    };
    await expect(mutations.create(data(), scopes)).rejects.toThrow("fixture scope revoke");
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(2);
  });
  it("rejects creation after an assumed role session is revoked", async () => {
    const binding = await createGrant(),
      role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "create-role-" + randomUUID() } });
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
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
    await expect(service.create(data(), guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oAuthClient.count({ where: { userId: actor } })).toBe(2);
  });
});
