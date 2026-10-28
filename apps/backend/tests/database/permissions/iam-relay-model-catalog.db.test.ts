import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayModelCatalogReadRepository } from "@/store/relay/relay-model-catalog-read.repository";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { relayModelCatalogArn } from "@/iam/resources/relay-model-catalog-resources";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ListAvailableModels";
let prefix: string,
  owner: string,
  actor: string,
  group: string,
  first: string,
  second: string,
  third: string,
  nameA: string,
  nameB: string,
  nameC: string;
const repo = () => RelayModelCatalogReadRepository.getInstance();
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "quyan:relay:RevealToken" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const read = (req = request()) => new RelayTokenService().getAvailableModels(actor, req);
async function grant(
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  target: { type: "user" | "role"; id: string } = { type: "user", id: actor },
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action: action, Resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: target.type,
      principalId: target.id,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function oauth(scopes = [Permission.RELAY_CHANNEL_READ] as string[]) {
  const client = await prisma.oAuthClient.create({
    data: {
      userId: actor,
      clientId: prefix + randomUUID(),
      name: prefix,
      clientSecretHash: "fixture-hash",
      grantTypes: ["authorization_code"],
      redirectUris: [],
      scopes,
      reviewStatus: "approved",
    },
  });
  const token = await prisma.oAuthAccessToken.create({
    data: {
      userId: actor,
      oauthClientId: client.id,
      tokenHash: randomUUID(),
      scopes,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  return {
    ...request(),
    oauthAccessToken: {
      id: token.id,
      oauthClientId: client.id,
      clientId: client.clientId,
      clientName: prefix,
      userId: actor,
      scopes,
      expiresAt: token.expiresAt.toISOString(),
    },
  } as TypedRequest;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "model-catalog-" + randomUUID();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
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
  group = (
    await prisma.group.create({
      data: { username: prefix, name: prefix, accountOwnerId: owner, permissions: [Permission.RELAY_TOKEN_READ] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId: group } });
  nameA = prefix + "-a";
  nameB = prefix + "-b";
  nameC = prefix + "-c";
  const model = async (model: string, provider: string | null, status = 1) =>
    (await prisma.modelPricing.create({ data: { model, provider, status, inputPrice: 12, outputPrice: 30 } })).id;
  first = await model(nameA, prefix + "-shared");
  second = await model(nameB, prefix + "-shared");
  third = await model(nameC, null);
  await model(prefix + "-inactive", null, 0);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor] } } });
  await prisma.group.deleteMany({ where: { id: group } });
});
describe("resource-filtered public model discovery", () => {
  it("lets account-owned groups discover public names without global pricing-management rights", async () => {
    const result = await read();
    expect(result.modelNames).toEqual([nameA, nameB, nameC]);
    expect(result.modelIdToModelNamesMap[prefix + "-shared"]).toEqual([nameA, nameB]);
    expect(result.modelIdToModelNameMap).not.toHaveProperty(prefix + "-shared");
    expect(result.modelIdToModelNameMap[nameC]).toBe(nameC);
    expect(result.modelResourceArns).toEqual({
      [nameA]: relayModelCatalogArn(owner, first),
      [nameB]: relayModelCatalogArn(owner, second),
      [nameC]: relayModelCatalogArn(owner, third),
    });
    expect(JSON.stringify(result)).not.toMatch(/inputPrice|outputPrice|cacheCreationMultiplier|pricingType/);
  });
  it("filters Deny before loading model labels or building ambiguous-alias maps", async () => {
    await grant(relayModelCatalogArn(owner, second));
    const hydrate = vi.spyOn(repo(), "hydrate");
    const result = await read();
    expect(result.modelNames).toEqual([nameA, nameC]);
    expect(result.modelIdToModelNameMap[prefix + "-shared"]).toBe(nameA);
    expect(result.modelIdToModelNamesMap[prefix + "-shared"]).toEqual([nameA]);
    expect(result.modelResourceArns).not.toHaveProperty(nameB);
    expect(hydrate.mock.calls.every(([rows]) => rows.every((row) => row.id !== second))).toBe(true);
  });
  it("returns empty public maps when every entry is denied, without reading labels", async () => {
    await grant("*");
    const hydrate = vi.spyOn(repo(), "hydrate");
    expect(await read()).toEqual({
      modelNames: [],
      modelIds: [],
      modelIdToModelNamesMap: {},
      modelIdToModelNameMap: {},
      modelResourceArns: {},
    });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("accepts a scoped JSON-only grant without projecting global legacy Token READ", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    await grant(relayModelCatalogArn(owner, first), "Allow");
    expect((await read()).modelNames).toEqual([nameA]);
  });
  it("fails closed for a persisted policy carrying a different account ARN", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    await grant(relayModelCatalogArn(actor, first), "Allow");
    const hydrate = vi.spyOn(repo(), "hydrate"),
      legacy = vi.spyOn(ModelPricingRepository.getInstance(), "listActiveOrderedByModel");
    await expect(read()).rejects.toThrow();
    expect(hydrate).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("ignores a client-supplied account owner when constructing discovery identities", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    await grant(relayModelCatalogArn(owner, first), "Allow");
    const req = { ...request(), body: { accountId: actor } } as unknown as TypedRequest;
    expect(await read(req)).toMatchObject({
      modelNames: [nameA],
      modelResourceArns: { [nameA]: relayModelCatalogArn(owner, first) },
    });
  });
  it("queries only public projection fields, never complete pricing records", async () => {
    const rich = vi.spyOn(ModelPricingRepository.getInstance(), "listActiveOrderedByModel"),
      select = vi.spyOn(prisma.modelPricing, "findMany");
    await read();
    expect(rich).not.toHaveBeenCalled();
    for (const [input] of select.mock.calls) {
      expect(input!.select).toBeDefined();
      expect(input!.select).not.toHaveProperty("inputPrice");
      expect(input!.select).not.toHaveProperty("outputPrice");
    }
  });
  it("chunks metadata, authorization and safe hydration across 500 records", async () => {
    await prisma.modelPricing.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({ model: prefix + "-extra-" + i, inputPrice: 1, outputPrice: 1 })),
    });
    await grant(relayModelCatalogArn(owner, second));
    const authorize = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    expect((await read()).modelNames).toHaveLength(503);
    expect(Math.max(...authorize.mock.calls.map(([input]) => input.resources.length))).toBeLessThanOrEqual(500);
  });
  it("rejects a removed publication or changed alias before release", async () => {
    const original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.modelPricing.update({ where: { id: first }, data: { provider: "changed" } });
      }
      return rows;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards output when an IAM decision is revoked after hydration", async () => {
    const original = repo().hydrate.bind(repo());
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
        input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
      );
      return rows;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["actor", "owner", "group"])("rechecks current %s state", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: group }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    const scan = vi.spyOn(repo(), "scan");
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("does not disclose data after request rebinding during hydration", async () => {
    const req = request(),
      original = repo().hydrate.bind(repo());
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      req.authContext!.accountOwnerId = actor;
      return rows;
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses persisted channel READ OAuth scope, not unrelated token READ", async () => {
    expect((await read(await oauth())).modelNames).toEqual([nameA, nameB, nameC]);
    await expect(read(await oauth([Permission.RELAY_TOKEN_READ]))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks the current OAuth application before releasing the map", async () => {
    const req = await oauth(),
      original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.oAuthClient.update({ where: { id: req.oauthAccessToken!.oauthClientId }, data: { status: 0 } });
      }
      return rows;
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks AccessKey revocation during asynchronous catalog work", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } }),
      req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    const original = repo().hydrate.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "hydrate").mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
      }
      return rows;
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role-session grants and rejects a revoked session", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect((await read(req)).modelNames).toEqual([]);
    await grant(relayModelCatalogArn(owner, first), "Allow", { type: "role", id: role.id });
    expect((await read(req)).modelNames).toEqual([nameA]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow performs metadata-only native evaluation, then calls the old projection once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const hydrate = vi.spyOn(repo(), "hydrate"),
      legacy = vi.spyOn(ModelPricingRepository.getInstance(), "listActiveOrderedByModel");
    expect((await read()).modelNames).toEqual([nameA, nameB, nameC]);
    expect(hydrate).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("requires a trusted identity in enforce, without a legacy fallback", async () => {
    const legacy = vi.spyOn(ModelPricingRepository.getInstance(), "listActiveOrderedByModel");
    await expect(new RelayTokenService().getAvailableModels()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
});
