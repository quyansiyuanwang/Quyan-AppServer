import type { RelayCompositionPreviewRequest } from "@/api/dto/relay/relay.dto";
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
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  target: { type: "user" | "role"; id: string } = { type: "user", id: actor },
) {
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
      principalType: target.type,
      principalId: target.id,
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
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
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

const previewAction = "quyan:relay:PreviewTokenComposition",
  managedPreviewAction = "quyan:relay:PreviewManagedTokenComposition";
const preview = (input: Partial<RelayCompositionPreviewRequest> = {}, req = request()) =>
  new RelayTokenService().previewComposition(
    actor,
    {
      routingMode: "composite",
      memberTokenConfigs: [{ tokenId: child, priority: 0, enabled: true }],
      ...input,
    },
    req,
  );
const actorArn = () => "acs:quyan:*:" + owner + ":user/" + actor;
describe("resource-authorized composition preview", () => {
  it("returns only admitted real paths under a nonpersistent public placeholder", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "loadCompositionSnapshot");
    const result = await preview();
    expect(result).toEqual({
      models: { ...empty, openai: ["model-a"] },
      routes: [{ protocol: "openai", model: "model-a", tokenPathIds: ["__composition_preview__", child] }],
    });
    expect(rich).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-channel-secret|fixture-composition-secret|upstream|channelId|preview_edge/,
    );
    expect(await prisma.relayToken.count({ where: { userId: actor } })).toBe(3);
  });
  it("requires explicit personal preview admission even when every selected token is allowed", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    await grant(previewAction, relayTokenArn(owner, actor, child), "Allow");
    const channels = vi.spyOn(repo(), "channels");
    await expect(preview()).rejects.toMatchObject({ statusCode: 403 });
    expect(channels).not.toHaveBeenCalled();
    await grant(previewAction, actorArn(), "Allow");
    expect((await preview()).models.openai).toEqual(["model-a"]);
  });
  it.each([true, false])("does not hydrate a denied selected reference enabled=%s", async (enabled) => {
    await grant(previewAction, relayTokenArn(owner, actor, child));
    const tokens = vi.spyOn(repo(), "tokens");
    await expect(preview({ memberTokenConfigs: [{ tokenId: child, priority: 0, enabled }] })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(tokens).not.toHaveBeenCalled();
  });
  it("does not let an allowed selected composition disclose a denied descendant", async () => {
    await grant(previewAction, relayTokenArn(owner, actor, child));
    const tokens = vi.spyOn(repo(), "tokens");
    await expect(
      preview({ memberTokenConfigs: [{ tokenId: parent, priority: 0, enabled: true }] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(tokens.mock.calls.every(([, targets]) => targets.every((row) => row.id !== child))).toBe(true);
  });
  it("requires the editing target separately and never grants it through member access", async () => {
    await grant(previewAction, relayTokenArn(owner, actor, parent));
    await expect(preview({ editingTokenId: parent })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("previews the proposed graph rather than requiring access to references removed by the draft", async () => {
    await grant(previewAction, relayTokenArn(owner, actor, child));
    expect(
      await preview({ editingTokenId: parent, memberTokenConfigs: [{ tokenId: other, priority: 0, enabled: true }] }),
    ).toMatchObject({
      routes: [{ tokenPathIds: [parent, other] }],
    });
  });
  it("does not require GetToken, Reveal or model discovery to preview", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    for (const resource of [actorArn(), relayTokenArn(owner, actor, child)])
      await grant(previewAction, resource, "Allow");
    for (const action of ["quyan:relay:GetToken", "quyan:relay:RevealToken", "quyan:relay:GetTokenAvailableModels"])
      await grant(action, "*");
    expect((await preview()).models.openai).toEqual(["model-a"]);
  });
  it.each(["self", "ancestor"])("rejects a proposed %s cycle including disabled references", async (kind) => {
    const editingTokenId = kind === "self" ? parent : child;
    await expect(
      preview({ editingTokenId, memberTokenConfigs: [{ tokenId: parent, priority: 0, enabled: false }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("does not accept another user's editing target or references", async () => {
    await expect(preview({ editingTokenId: peerToken })).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      preview({ memberTokenConfigs: [{ tokenId: peerToken, priority: 0, enabled: true }] }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps configured aliases and protocol conversion tied to the authorized subtree", async () => {
    const result = await preview({
      modelMapping: { alias: "model-a" },
      requestFormatTransforms: [{ sourceFormat: "anthropic", targetFormat: "openai-chat-completions" }],
    });
    expect(result.models.openai).toEqual(["alias", "model-a"]);
    expect(result.models.anthropic).toEqual(["alias", "model-a"]);
    expect(result.routes.every((route) => route.tokenPathIds[1] === child)).toBe(true);
  });
  it("applies draft restrictions, expiration and ancestor multiplier limits", async () => {
    expect((await preview({ allowedModels: "not-allowed" })).routes).toEqual([]);
    expect((await preview({ expiresAt: new Date(0).toISOString() })).routes).toEqual([]);
    expect(
      (
        await preview({
          failoverConfig: {
            enabled: true,
            maxRetries: 1,
            retryStatusCodes: [],
            failoverThreshold: 0,
            failbackCooldownMinutes: 0,
            maxAcceptedChannelMultiplier: 0.5,
          },
        })
      ).routes,
    ).toEqual([]);
  });
  it("retains the original token-read OAuth scope for preview, separate from model reads", async () => {
    expect((await preview({}, await oauthRequest([Permission.RELAY_TOKEN_READ]))).models.openai).toEqual(["model-a"]);
    await expect(preview({}, await oauthRequest([Permission.RELAY_CHANNEL_READ]))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not manufacture peer management eligibility with preview wildcards", async () => {
    await grant(managedPreviewAction, "*", "Allow");
    await expect(
      preview({ targetUserId: peer, memberTokenConfigs: [{ tokenId: peerToken, priority: 0, enabled: true }] }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps managed preview bound to personal, target-user and per-token grants", async () => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    const input = { targetUserId: peer, memberTokenConfigs: [{ tokenId: peerToken, priority: 0, enabled: true }] };
    expect((await preview(input)).routes).toMatchObject([{ tokenPathIds: ["__composition_preview__", peerToken] }]);
    await grant(managedPreviewAction, platformRelayTokenArn(peer, peerToken));
    await expect(preview(input)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "request", "source"])("rechecks %s before releasing real token path IDs", async (kind) => {
    const req = request(),
      original = repo().catalog.bind(repo());
    let calls = 0;
    vi.spyOn(repo(), "catalog").mockImplementation(async () => {
      const result = await original();
      if (!calls++) {
        if (kind === "policy") await grant(previewAction, relayTokenArn(owner, actor, child));
        else if (kind === "request") req.authContext!.accountOwnerId = peer;
        else await prisma.relayToken.update({ where: { id: child }, data: { status: 0 } });
      }
      return result;
    });
    await expect(preview({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { editingTokenId: "__composition_preview__" },
    { editingTokenId: "*" },
    { routingMode: "ordered", channelId: "fake" },
    { memberTokenConfigs: [] },
    { memberTokenConfigs: [{ tokenId: "*", priority: 0, enabled: true }] },
  ])("rejects malformed or fabricated preview identities %j", async (input) => {
    await expect(preview(input as Partial<RelayCompositionPreviewRequest>)).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["before", "during"])("checks an assumed role session %s preview", async (phase) => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
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
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await expect(preview({}, req)).rejects.toMatchObject({ statusCode: 403 });
    for (const resource of [actorArn(), relayTokenArn(owner, actor, child)])
      await grant(previewAction, resource, "Allow", { type: "role", id: role.id });
    expect((await preview({}, req)).models.openai).toEqual(["model-a"]);
    if (phase === "before")
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    else {
      const original = repo().catalog.bind(repo());
      let calls = 0;
      vi.spyOn(repo(), "catalog").mockImplementation(async () => {
        const result = await original();
        if (!calls++)
          await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return result;
      });
    }
    await expect(preview({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"])("%s projects legacy once without native snapshots", async (mode) => {
    env.security.iamAuthorizationMode = mode as typeof env.security.iamAuthorizationMode;
    const native = vi.spyOn(repo(), "tokens"),
      legacy = vi
        .spyOn(RelayProxyService.getInstance(), "getCompositeCatalog")
        .mockResolvedValue([{ model: "model-a", tokenPathIds: ["__composition_preview__", child] }]);
    expect((await preview()).models.openai).toEqual(["model-a"]);
    expect(legacy).toHaveBeenCalledTimes(4);
    expect(native).not.toHaveBeenCalled();
  });
});
