import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { OAuthClientIamService } from "@/services/users/oauth-client-iam.service";
import { OAuthClientManagementRepository } from "@/store/users/oauth-client-management.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
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
const service = OAuthClientIamService.getInstance(),
  repository = OAuthClientManagementRepository.getInstance();
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
const grant = () =>
  bind({ Effect: "Allow", Action: ["quyan:oauth:ListClients", "quyan:oauth:GetClient"], Resource: arn(visible) });
describe("OAuth client resource authorization database", () => {
  it("filters lists to granted resources and never selects credential hashes", async () => {
    await grant();
    const query = vi.spyOn(prisma.oAuthClient, "findMany");
    const rows = await service.list(actor, request());
    expect(rows.map((r) => r.id)).toEqual([visible]);
    expect(rows[0].hasClientSecret).toBe(true);
    expect(rows[0]).not.toHaveProperty("clientSecretHash");
    for (const [args] of query.mock.calls) expect(args?.select).not.toHaveProperty("clientSecretHash");
    expect(await service.get(actor, visible, request())).toMatchObject({ id: visible, hasClientSecret: true });
    await expect(service.get(actor, hidden, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("explicit Deny overrides wildcard Allow and absent Allow denies details", async () => {
    await expect(service.get(actor, visible, request())).rejects.toMatchObject({ statusCode: 403 });
    await bind([
      { Effect: "Allow", Action: "quyan:oauth:*", Resource: "*" },
      { Effect: "Deny", Action: ["quyan:oauth:GetClient", "quyan:oauth:ListClients"], Resource: arn(visible) },
    ]);
    expect((await service.list(actor, request())).map((r) => r.id)).toEqual([hidden]);
    await expect(service.get(actor, visible, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot expose peers, foreign users or platform applications even with wildcards", async () => {
    await bind({ Effect: "Allow", Action: "quyan:oauth:*", Resource: "*" });
    for (const id of [await client(peer), await client(foreign), await client(actor, true)])
      await expect(service.get(actor, id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.list(actor, request())).map((r) => r.id).sort()).toEqual([visible, hidden].sort());
  });
  it("resource-group membership removal takes effect on the next evaluation", async () => {
    const group = await prisma.ramResourceGroup.create({
      data: { accountOwnerId: owner, name: "oauth-" + randomUUID() },
    });
    const member = await prisma.ramResourceGroupMember.create({
      data: {
        accountOwnerId: owner,
        resourceGroupId: group.id,
        resourceArn: arn(visible),
        service: "oauth",
        resourceType: "client",
        resourceId: actor + "/" + visible,
      },
    });
    await bind({ Effect: "Allow", Action: "quyan:oauth:*", Resource: "*" }, { group: group.id });
    expect((await service.list(actor, request())).map((r) => r.id)).toEqual([visible]);
    await prisma.ramResourceGroupMember.update({ where: { id: member.id }, data: { status: -1 } });
    expect(await service.list(actor, request())).toEqual([]);
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(arn(visible), owner)).toBe(true);
    expect(
      await groups.resourceExistsInAccount(`acs:oauth:*:${owner}:client/${foreign}/${await client(foreign)}`, owner),
    ).toBe(false);
    expect(await groups.resourceExistsInAccount(arn(await client(actor, true)), owner)).toBe(false);
  });
  it("discards hydrated data after policy revocation or resource edits", async () => {
    const binding = await grant(),
      hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
      return rows;
    });
    expect(await service.list(actor, request())).toEqual([]);
    vi.restoreAllMocks();
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.oAuthClient.update({
        where: { id: visible },
        data: { name: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return rows;
    });
    await expect(service.get(actor, visible, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return a role-authorized application after session revocation", async () => {
    const binding = await grant(),
      role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "oauth-role-" + randomUUID() } });
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
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return rows;
    });
    await expect(service.get(actor, visible, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects disabled accounts and revoked OAuth tokens at the final read boundary", async () => {
    await grant();
    const login = await client(actor);
    await prisma.oAuthClient.update({ where: { id: login }, data: { reviewStatus: "approved" } });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: login,
        tokenHash: "fixture-" + randomUUID(),
        scopes: ["oauth_client"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: login,
      userId: actor,
      scopes: ["oauth_client"],
      expiresAt: token.expiresAt.toISOString(),
    } as any;
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
      return rows;
    });
    await expect(service.get(actor, visible, req)).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.list(actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
