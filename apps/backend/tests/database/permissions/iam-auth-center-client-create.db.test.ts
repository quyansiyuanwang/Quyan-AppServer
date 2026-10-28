import { AuthCenterClientMutationIamService } from "@/services/users/auth-center-client-mutation-iam.service";
import type { AuthCenterClientCreateInput } from "@/store/users/auth-center-client.store";
import { AuthCenterClientMutationRepository } from "@/store/users/auth-center-client-mutation.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import { AuthCenterClientRepository } from "@/store/users/auth-center-client.repository";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string, visible: string;
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
const client = async (userId: string) =>
  (
    await prisma.authCenterClient.create({
      data: {
        userId,
        name: "fixture",
        clientId: "fixture-" + randomUUID(),
        clientSecretHash: "fixture-hash-never-selected",
        clientSecretPreview: "fixture-mask",
        grantTypes: ["authorization_code"],
        scopes: ["auth_center_client"],
        redirectUris: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const arn = (id: string) => `acs:auth-center:*:${owner}:client/${actor}/${id}`;
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  visible = await client(actor);
  await client(actor);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
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
const service = AuthCenterClientMutationIamService.getInstance(),
  mutations = AuthCenterClientMutationRepository.getInstance();

const createGrant = () =>
  bind({ Effect: "Allow", Action: "quyan:auth_center:CreateClient", Resource: `acs:quyan:*:${owner}:user/${actor}` });
const data = (): AuthCenterClientCreateInput => ({
  userId: actor,
  name: "new fixture",
  clientId: "new-" + randomUUID(),
  clientSecretHash: "fixture-new-hash",
  clientSecretPreview: "fixture-mask",
  clientType: "confidential",
  reviewStatus: "draft",
  grantTypes: ["authorization_code", "refresh_token"],
  redirectUris: ["https://fixture.example.test/callback"],
  scopes: ["profile"],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 2592000,
});
const prepare = async () => ({ ...(await service.prepareCreate(actor, request())), scopeCheck: async () => {} });
describe("Auth center application creation database", () => {
  it("creates an ordinary draft app only on the trusted user resource", async () => {
    await createGrant();
    const guard = await prepare(),
      input = data(),
      result = await service.create(input, guard);
    expect(result).toMatchObject({
      userId: actor,
      name: "new fixture",
      status: 1,
      reviewStatus: "draft",
      hasClientSecret: true,
    });
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(await prisma.authCenterClient.findUnique({ where: { id: result.id } })).toMatchObject({
      clientSecretHash: input.clientSecretHash,
    });
  });
  it("absent Allow and explicit Deny block preparation, read/write child grants do not authorize creation", async () => {
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await bind({
      Effect: "Allow",
      Action: ["quyan:auth_center:GetClient", "quyan:auth_center:UpdateClient"],
      Resource: arn(visible),
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await createGrant();
    await bind({ Effect: "Deny", Action: "quyan:auth_center:CreateClient", Resource: "*" });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("prevents changed user, system and preapproved applications from using a creation guard", async () => {
    await createGrant();
    const guard = await prepare();
    for (const input of [
      { ...data(), userId: peer },
      { ...data(), userId: foreign },
      { ...data(), status: 1 } as any,
      { ...data(), reviewStatus: "approved" },
    ])
      await expect(service.create(input, guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.count({ where: { userId: actor } })).toBe(2);
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
    expect(await prisma.authCenterClient.count({ where: { userId: actor } })).toBe(2);
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
    expect(await prisma.authCenterClient.count({ where: { userId: actor } })).toBe(2);
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
    expect(await prisma.authCenterClient.count({ where: { userId: actor } })).toBe(2);
  });
  it("creates through the public service with server-generated identifiers and one-time credentials", async () => {
    await createGrant();
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "create");
    const result = await AuthCenterClientService.getInstance().createClient(
      actor,
      { name: "  new application  ", redirectUris: ["https://fixture.example.test/callback"], scopes: ["profile"] },
      request(),
    );
    expect(result).toMatchObject({
      userId: actor,
      name: "new application",
      reviewStatus: "draft",
      hasClientSecret: true,
    });
    expect(result.clientId).toMatch(/^atc_/);
    expect(result.clientSecret).toMatch(/^atcs_/);
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(legacy).not.toHaveBeenCalled();
    const row = await prisma.authCenterClient.findUnique({ where: { id: result.id } });
    expect(row!.clientSecretHash).not.toEqual(result.clientSecret);
    expect(row!.clientSecretPreview).not.toEqual(result.clientSecret);
  });
  it("creates public applications without credentials and requires PKCE", async () => {
    await createGrant();
    expect(
      await AuthCenterClientService.getInstance().createClient(
        actor,
        {
          name: "public",
          clientType: "public",
          redirectUris: ["https://fixture.example.test/callback"],
          scopes: ["profile"],
          isPkceRequired: false,
        },
        request(),
      ),
    ).toMatchObject({ clientType: "public", hasClientSecret: false, clientSecret: "", isPkceRequired: true });
  });
  it.each([
    { userId: "foreign" },
    { clientId: "injected" },
    { reviewStatus: "approved" },
    { clientSecretHash: "injected" },
  ])("rejects injected creation fields %j", async (input) => {
    await createGrant();
    await expect(
      AuthCenterClientService.getInstance().createClient(
        actor,
        { name: "fixture", redirectUris: ["https://fixture.example.test/callback"], ...input } as any,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.authCenterClient.count({ where: { userId: actor } })).toBe(2);
  });
  it("rejects a different creation subject and ungrantable scopes without inserting an application", async () => {
    await createGrant();
    const input = { name: "fixture", redirectUris: ["https://fixture.example.test/callback"], scopes: ["email"] };
    await expect(AuthCenterClientService.getInstance().createClient(actor, input, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      AuthCenterClientService.getInstance().createClient(peer, { ...input, scopes: ["profile"] }, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.count({ where: { userId: actor } })).toBe(2);
  });
  it("maps a duplicate public identifier to a conflict without inserting a second record", async () => {
    await createGrant();
    const input = data();
    await service.create(input, await prepare());
    await expect(service.create(input, await prepare())).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.authCenterClient.count({ where: { clientId: input.clientId } })).toBe(1);
  });
  it.each(["legacy", "shadow"] as const)("preserves existing creation once in %s", async (mode) => {
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.AUTH_CENTER_CLIENT_CREATE] },
    });
    await bind({ Effect: "Deny", Action: "quyan:auth_center:CreateClient", Resource: "*" });
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "create");
    expect(
      await AuthCenterClientService.getInstance().createClient(
        actor,
        { name: "fixture", redirectUris: ["https://fixture.example.test/callback"], scopes: ["profile"] },
        request(),
      ),
    ).toMatchObject({ reviewStatus: "draft", userId: actor });
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
