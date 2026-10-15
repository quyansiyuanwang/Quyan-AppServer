import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenCapabilityRepository } from "@/store/relay/relay-token-capability.repository";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
const oldMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:GetTokenAvailableModels",
  managedAction = "quyan:relay:GetManagedTokenAvailableModels";
let owner: string,
  actor: string,
  peer: string,
  group: string,
  parent: string,
  child: string,
  other: string,
  peerToken: string,
  prefix: string,
  channel: string,
  model: string;
const repo = () => RelayTokenCapabilityRepository.getInstance();
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const read = (id = parent, targetUserId?: string, req = request()) =>
  new RelayTokenService().getTokenAvailableModels(id, actor, targetUserId, req);
async function grant(Action: string, Resource: string, Effect: "Allow" | "Deny" = "Deny") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Action, Resource, Effect } }),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: prefix + randomUUID(),
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
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "candidate-iam-" + randomUUID();
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
  peer = await user(owner);
  group = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: null, permissions: [Permission.RELAY_TOKEN_READ] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId: group } });
  const token = async (userId: string, name: string, routingMode = "ordered") =>
    (
      await prisma.relayToken.create({
        data: {
          userId,
          name,
          routingMode,
          token: "sk-rlt-fixture-" + randomUUID(),
          upstreamApiKey: "fixture-composition-secret",
          createTime: new Date("2026-10-16T00:00:00Z"),
        },
      })
    ).id;
  model = prefix + "-model";
  await prisma.modelPricing.create({
    data: { model, provider: "model-a", supportedFormats: "openai", inputPrice: 0, outputPrice: 0 },
  });
  channel = (
    await prisma.relayChannel.create({
      data: {
        name: prefix,
        allowedModels: JSON.stringify([model]),
        allowedFormats: "openai",
        openaiUpstreamApiKey: "fixture-channel-secret",
      },
    })
  ).id;
  parent = await token(actor, "parent", "composite");
  child = await token(actor, "child");
  other = await token(actor, "other");
  peerToken = await token(peer, "peer");
  await prisma.relayToken.updateMany({
    where: { id: { in: [child, other, peerToken] } },
    data: { channelId: channel },
  });
  await prisma.relayTokenMemberConfig.create({
    data: { parentTokenId: parent, tokenId: child, priority: 0, enabled: true },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = oldMode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayTokenMemberConfig.deleteMany({ where: { parentToken: { userId: { in: [actor, peer] } } } });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer] } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannel: { name: { startsWith: prefix } } } });
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, peer, owner] } } });
  await prisma.group.deleteMany({ where: { id: group } });
});

async function oauthRequest(scopes: string[] = [Permission.RELAY_CHANNEL_READ]) {
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
      clientName: client.name,
      userId: actor,
      scopes,
      expiresAt: token.expiresAt.toISOString(),
    },
  } as TypedRequest;
}
const empty = { openai: [], responses: [], anthropic: [], gemini: [] };
describe("resource-authorized token model capabilities", () => {
  it("uses credential-free snapshots for every contributing node and route", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    const tokenQueries = vi.spyOn(prisma.relayToken, "findMany"),
      channelQueries = vi.spyOn(prisma.relayChannel, "findMany"),
      pricingQueries = vi.spyOn(prisma.modelPricing, "findMany");
    expect(await read()).toEqual({ ...empty, openai: ["model-a"] });
    expect(rich).not.toHaveBeenCalled();
    for (const [query] of tokenQueries.mock.calls) {
      expect(query?.select).toBeDefined();
      for (const field of ["token", "legacyToken", "upstreamApiKey", "upstreamUrl", "channel", "user"])
        expect(query?.select).not.toHaveProperty(field);
    }
    for (const [query] of channelQueries.mock.calls) {
      expect(query?.select).toBeDefined();
      for (const field of ["name", "openaiUpstreamApiKey", "openaiUpstreamUrl", "visibilityConfig"])
        expect(query?.select).not.toHaveProperty(field);
    }
    for (const [query] of pricingQueries.mock.calls)
      for (const field of ["inputPrice", "outputPrice", "fixedPrice"]) expect(query?.select).not.toHaveProperty(field);
  });
  it("does not hydrate a denied root or query its channels", async () => {
    await grant(action, relayTokenArn(owner, actor, parent));
    const tokens = vi.spyOn(repo(), "tokens"),
      channels = vi.spyOn(repo(), "channels");
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(tokens).not.toHaveBeenCalled();
    expect(channels).not.toHaveBeenCalled();
  });
  it.each([true, false])("does not let an allowed parent expose a denied member, enabled=%s", async (enabled) => {
    await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: parent }, data: { enabled } });
    await grant(action, relayTokenArn(owner, actor, child));
    const tokens = vi.spyOn(repo(), "tokens");
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(tokens.mock.calls.every(([, targets]) => targets.every((row) => row.id !== child))).toBe(true);
  });
  it("does not require metadata/reveal/global-model-discovery actions", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    for (const id of [parent, child]) await grant(action, relayTokenArn(owner, actor, id), "Allow");
    for (const otherAction of ["quyan:relay:GetToken", "quyan:relay:RevealToken", "quyan:relay:ListAvailableModels"])
      await grant(otherAction, "*");
    expect(await read()).toEqual({ ...empty, openai: ["model-a"] });
    await expect(read(other)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([0, -1])("does not advertise models from member status %s", async (status) => {
    await prisma.relayToken.update({ where: { id: child }, data: { status } });
    if (status === -1) await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    else expect(await read()).toEqual(empty);
  });
  it("does not advertise an expired or disabled edge", async () => {
    await prisma.relayToken.update({ where: { id: child }, data: { expiresAt: new Date(0) } });
    expect(await read()).toEqual(empty);
    await prisma.relayToken.update({ where: { id: child }, data: { expiresAt: null } });
    await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: parent }, data: { enabled: false } });
    expect(await read()).toEqual(empty);
  });
  it("denies a foreign member even when the parent grant is broad", async () => {
    await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: parent }, data: { tokenId: peerToken } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on a cycle and never invokes the credential-bearing legacy reader", async () => {
    await prisma.relayToken.update({ where: { id: child }, data: { routingMode: "composite" } });
    await prisma.relayTokenMemberConfig.create({ data: { parentTokenId: child, tokenId: parent, priority: 0 } });
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    await expect(read()).rejects.toMatchObject({ statusCode: 400 });
    expect(rich).not.toHaveBeenCalled();
  });
  it("keeps unrestricted routes from dumping the public model catalog", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { allowedModels: null } });
    expect(await read(child)).toEqual(empty);
    await prisma.relayToken.update({ where: { id: parent }, data: { modelMapping: { requested: "model-a" } } });
    expect(await read()).toEqual({ ...empty, openai: ["model-a", "requested"] });
  });
  it("keeps each alias paired with the constraints of the same channel path", async () => {
    const pool = await prisma.relayChannel.create({
      data: { name: prefix + "pool", channelType: "pooled", allowedModels: JSON.stringify(["not-allowed"]) },
    });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool.id, priority: 0, memberChannelId: channel },
    });
    await prisma.relayToken.update({
      where: { id: child },
      data: { channelId: pool.id, modelMapping: { alias: "model-a" } },
    });
    expect(await read()).toEqual(empty);
  });
  it("honors strict children over legacy pool membership and token path exclusions", async () => {
    const pool = await prisma.relayChannel.create({ data: { name: prefix + "pool", channelType: "pooled" } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool.id, priority: 0, memberChannelId: channel, enabled: true },
    });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { pooledParentId: pool.id, pooledMemberEnabled: false },
    });
    await prisma.relayToken.update({ where: { id: child }, data: { channelId: pool.id } });
    expect(await read()).toEqual(empty);
    await prisma.relayChannel.update({ where: { id: channel }, data: { pooledMemberEnabled: true } });
    expect(await read()).toEqual({ ...empty, openai: ["model-a"] });
    await prisma.relayToken.update({ where: { id: child }, data: { blockedAutomaticProxyPoolChannelIds: [pool.id] } });
    expect(await read()).toEqual(empty);
  });
  it("retains an ancestor multiplier ceiling without mixing paths", async () => {
    await prisma.relayTokenFailoverConfig.create({ data: { relayTokenId: parent, maxAcceptedChannelMultiplier: 0.5 } });
    expect(await read()).toEqual(empty);
  });
  it("rejects peer reads without persisted platform management eligibility", async () => {
    await grant(managedAction, "*", "Allow");
    await expect(read(peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires managed admission even for a same-account peer and honors per-token Deny", async () => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    await grant(managedAction, platformUserArn(peer), "Allow");
    await grant(managedAction, platformRelayTokenArn(peer, peerToken), "Allow");
    expect(await read(peerToken, peer)).toEqual({ ...empty, openai: ["model-a"] });
    await grant(managedAction, platformRelayTokenArn(peer, peerToken));
    await expect(read(peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["personal", "user"])("does not bypass denied %s admission for managed capabilities", async (kind) => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    await grant(kind === "personal" ? action : managedAction, kind === "personal" ? "*" : platformUserArn(peer));
    await expect(read(peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps the endpoint's original channel-read OAuth scope", async () => {
    expect(await read(parent, undefined, await oauthRequest())).toEqual({ ...empty, openai: ["model-a"] });
    const req = await oauthRequest([Permission.RELAY_TOKEN_READ]);
    req.oauthAccessToken!.scopes = [Permission.RELAY_CHANNEL_READ];
    await expect(read(parent, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "group", "request", "key", "oauth"])(
    "rejects %s revocation during capability projection",
    async (kind) => {
      const req = kind === "oauth" ? await oauthRequest() : request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const original = repo().catalog.bind(repo());
      let calls = 0;
      vi.spyOn(repo(), "catalog").mockImplementation(async () => {
        const result = await original();
        if (!calls++) {
          if (kind === "policy") await grant(action, relayTokenArn(owner, actor, child));
          else if (kind === "group") await prisma.group.update({ where: { id: group }, data: { status: 0 } });
          else if (kind === "request") req.authContext!.accountOwnerId = peer;
          else if (kind === "key")
            await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          else
            await prisma.oAuthClient.update({
              where: { id: req.oauthAccessToken!.oauthClientId },
              data: { status: 0 },
            });
        }
        return result;
      });
      await expect(read(parent, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["token", "channel", "catalog", "edge"])("rejects a changed %s capability source", async (kind) => {
    const original = repo().catalog.bind(repo());
    let calls = 0;
    vi.spyOn(repo(), "catalog").mockImplementation(async () => {
      const result = await original();
      if (!calls++) {
        if (kind === "token")
          await prisma.relayToken.update({ where: { id: child }, data: { modelMapping: { injected: "model-a" } } });
        else if (kind === "channel")
          await prisma.relayChannel.update({ where: { id: channel }, data: { allowedFormats: "anthropic" } });
        else if (kind === "catalog") await prisma.modelPricing.update({ where: { model }, data: { status: 0 } });
        else
          await prisma.relayTokenMemberConfig.updateMany({
            where: { parentTokenId: parent },
            data: { enabled: false },
          });
      }
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"])("%s calls legacy exactly once without native capability hydration", async (mode) => {
    env.security.iamAuthorizationMode = mode as typeof env.security.iamAuthorizationMode;
    const rich = vi.spyOn(RelayProxyService.getInstance(), "getAvailableModelMapForToken").mockResolvedValue(empty);
    const safe = vi.spyOn(repo(), "tokens");
    expect(await read()).toEqual(empty);
    expect(rich).toHaveBeenCalledOnce();
    expect(safe).not.toHaveBeenCalled();
  });
});
