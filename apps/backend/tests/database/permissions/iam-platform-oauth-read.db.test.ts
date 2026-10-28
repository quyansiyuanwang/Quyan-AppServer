import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { PlatformOAuthClientIamService } from "@/services/users/platform-oauth-client-iam.service";
import { platformOAuthClientArn } from "@/iam/resources/platform-oauth-resources";
import { Permission } from "@quyan/shared";
import { PlatformOAuthClientRepository } from "@/store/users/platform-oauth-client.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
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
const service = PlatformOAuthClientIamService.getInstance(),
  repository = PlatformOAuthClientRepository.getInstance();
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
describe("platform OAuth read authorization database", () => {
  it("requires a persisted global group and filters individual system applications with Deny", async () => {
    await globalGroup();
    expect((await service.list(request())).map((r) => r.id).sort()).toEqual([visible, hidden].sort());
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oauth:ListSystemClients", Resource: platformOAuthClientArn(hidden) },
    });
    expect((await service.list(request())).map((r) => r.id)).toEqual([visible]);
  });
  it("ordinary account owners cannot create platform authority through arbitrary policies", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    const group = await prisma.group.create({
      data: {
        username: "account-" + randomUUID(),
        name: "admin",
        level: 0,
        accountOwnerId: owner,
        permissions: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE],
      },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never fetches secret hashes and never includes ordinary applications", async () => {
    await globalGroup();
    await client(actor);
    const query = vi.spyOn(prisma.oAuthClient, "findMany");
    const rows = await service.list(request());
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.isSystemClient).toBe(true);
      expect(row).not.toHaveProperty("clientSecretHash");
    }
    for (const [args] of query.mock.calls) expect(args?.select).not.toHaveProperty("clientSecretHash");
  });
  it("rechecks the global group after reading display fields", async () => {
    const group = await globalGroup(),
      hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return apps moved from system to ordinary or edited while being read", async () => {
    await globalGroup();
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.oAuthClient.update({
        where: { id: hidden },
        data: { isSystemClient: false, updateTime: new Date(Date.now() + 1000) },
      });
      return rows;
    });
    expect((await service.list(request())).map((r) => r.id)).toEqual([visible]);
  });
  it("platform resources cannot be smuggled into ordinary account resource groups", async () => {
    await globalGroup();
    expect(
      await RamResourceGroupRepository.getInstance().resourceExistsInAccount(platformOAuthClientArn(visible), owner),
    ).toBe(false);
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
