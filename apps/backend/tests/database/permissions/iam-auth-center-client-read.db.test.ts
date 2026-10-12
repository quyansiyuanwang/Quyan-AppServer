import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import { AuthCenterClientRepository } from "@/store/users/auth-center-client.repository";
import { prisma } from "@/config/database";
import { AuthCenterClientIamService } from "@/services/users/auth-center-client-iam.service";
import { AuthCenterClientManagementRepository } from "@/store/users/auth-center-client-management.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
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
  }) as unknown as TypedRequest;
const arn = (id: string) => `acs:auth-center:*:${owner}:client/${actor}/${id}`;
const service = AuthCenterClientIamService.getInstance(),
  repository = AuthCenterClientManagementRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  visible = await client(actor);
  hidden = await client(actor);
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
const grant = () =>
  bind({
    Effect: "Allow",
    Action: ["quyan:auth_center:ListClients", "quyan:auth_center:GetClient"],
    Resource: arn(visible),
  });
describe("Auth center client resource authorization database", () => {
  it("filters lists to granted resources and never selects credential hashes", async () => {
    await grant();
    const query = vi.spyOn(prisma.authCenterClient, "findMany");
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
      { Effect: "Allow", Action: "quyan:auth_center:*", Resource: "*" },
      {
        Effect: "Deny",
        Action: ["quyan:auth_center:GetClient", "quyan:auth_center:ListClients"],
        Resource: arn(visible),
      },
    ]);
    expect((await service.list(actor, request())).map((r) => r.id)).toEqual([hidden]);
    await expect(service.get(actor, visible, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot expose peers, foreign users even with wildcards", async () => {
    await bind({ Effect: "Allow", Action: "quyan:auth_center:*", Resource: "*" });
    for (const id of [await client(peer), await client(foreign)])
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
        service: "auth-center",
        resourceType: "client",
        resourceId: actor + "/" + visible,
      },
    });
    await bind({ Effect: "Allow", Action: "quyan:auth_center:*", Resource: "*" }, { group: group.id });
    expect((await service.list(actor, request())).map((r) => r.id)).toEqual([visible]);
    await prisma.ramResourceGroupMember.update({ where: { id: member.id }, data: { status: -1 } });
    expect(await service.list(actor, request())).toEqual([]);
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(arn(visible), owner)).toBe(true);
    expect(
      await groups.resourceExistsInAccount(
        `acs:auth-center:*:${owner}:client/${foreign}/${await client(foreign)}`,
        owner,
      ),
    ).toBe(false);
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
      await prisma.authCenterClient.update({
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
    const login = (
      await prisma.oAuthClient.create({
        data: {
          userId: actor,
          name: "fixture login",
          clientId: "login-" + randomUUID(),
          grantTypes: ["authorization_code"],
          scopes: ["auth_center_client"],
          redirectUris: [],
          reviewStatus: "approved",
        },
      })
    ).id;
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: login,
        tokenHash: "fixture-" + randomUUID(),
        scopes: ["auth_center_client"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: login,
      userId: actor,
      scopes: ["auth_center_client"],
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
  it("projects JSON-only permissions to the existing DTO without reading credential hashes", async () => {
    await grant();
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "findByUserId");
    const query = vi.spyOn(prisma.authCenterClient, "findMany");
    const bridge = AuthCenterClientService.getInstance();
    expect(await bridge.listClients(actor, request())).toMatchObject([{ id: visible, hasClientSecret: true }]);
    const detail = await bridge.getClient(visible, actor, request());
    expect(detail).toMatchObject({ id: visible, hasClientSecret: true, clientSecretPreview: "fixture-mask" });
    expect(detail).not.toHaveProperty("clientSecretHash");
    expect(detail).not.toHaveProperty("clientSecret");
    expect(legacy).not.toHaveBeenCalled();
    for (const [args] of query.mock.calls) expect(args?.select).not.toHaveProperty("clientSecretHash");
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves legacy reads once in %s with metadata-only diagnostics",
    async (mode) => {
      await prisma.user.update({
        where: { id: actor },
        data: { permissionAdds: [Permission.AUTH_CENTER_CLIENT_READ] },
      });
      await bind({ Effect: "Deny", Action: "quyan:auth_center:*", Resource: "*" });
      env.security.iamAuthorizationMode = mode;
      const old = AuthCenterClientRepository.getInstance();
      const list = vi.spyOn(old, "findByUserId"),
        detail = vi.spyOn(old, "findById");
      const hydrate = vi.spyOn(repository, "hydrate");
      const bridge = AuthCenterClientService.getInstance();
      expect((await bridge.listClients(actor, request())).map((r) => r.id).sort()).toEqual([visible, hidden].sort());
      expect(await bridge.getClient(visible, actor, request())).toMatchObject({ id: visible });
      expect(list).toHaveBeenCalledTimes(1);
      expect(detail).toHaveBeenCalledTimes(1);
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)("preserves legacy permission rejection in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "findByUserId");
    await expect(AuthCenterClientService.getInstance().listClients(actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects removed legacy grants when computing native Action permissions", async () => {
    await prisma.user.update({
      where: { id: actor },
      data: {
        permissionAdds: [Permission.AUTH_CENTER_CLIENT_READ],
        permissionRemoves: [Permission.AUTH_CENTER_CLIENT_READ],
      },
    });
    await grant();
    expect(await service.list(actor, request())).toEqual([]);
    await expect(service.get(actor, visible, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts a current OAuth token carrying the canonical Auth Center read scope and still applies IAM per resource", async () => {
    await grant();
    const login = await prisma.oAuthClient.create({
      data: {
        userId: actor,
        name: "fixture login",
        clientId: "login-" + randomUUID(),
        reviewStatus: "approved",
        grantTypes: ["authorization_code"],
        scopes: [Permission.AUTH_CENTER_CLIENT_READ],
        redirectUris: [],
      },
    });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: login.id,
        tokenHash: "fixture-" + randomUUID(),
        scopes: [Permission.AUTH_CENTER_CLIENT_READ],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: login.id,
      userId: actor,
      scopes: [Permission.AUTH_CENTER_CLIENT_READ],
      expiresAt: token.expiresAt.toISOString(),
    } as any;
    expect((await service.list(actor, req)).map((r) => r.id)).toEqual([visible]);
    await expect(service.get(actor, hidden, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.oAuthClient.update({ where: { id: login.id }, data: { scopes: ["profile"] } });
    await expect(service.get(actor, visible, req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
