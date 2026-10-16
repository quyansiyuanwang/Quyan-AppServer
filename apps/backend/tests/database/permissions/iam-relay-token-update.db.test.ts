import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, getCredentialPrefix } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenMutationRepository } from "@/store/relay/relay-token-mutation.repository";
import { RelayTokenMutationResponseRepository } from "@/store/relay/relay-token-mutation-response.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { RelayTokenUpdateAdmissionRepository } from "@/store/relay/relay-token-update-admission.repository";
import { RelayTokenUpdateRepository } from "@/store/relay/relay-token-update.repository";
import { ConfigService } from "@/services/system/config.service";
import { DistributedLockService } from "@/services/infrastructure/distributed-lock.service";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";
import type { UpdateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import type { TypedRequest } from "@/types/express";
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  first: string,
  peerToken: string,
  foreignToken: string,
  prefix: string;
const mode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const service = () => new RelayTokenService();
let channels: string[];
const update = (data: UpdateRelayTokenDto = { name: "updated" }, id = first, targetUserId?: string, req = request()) =>
  service().updateToken(id, actor, data, req, targetUserId);
const fullState = (id = first) =>
  prisma.relayToken.findUniqueOrThrow({
    where: { id },
    include: {
      channelConfigs: { orderBy: { priority: "asc" } },
      quotaWindows: true,
      failoverConfig: true,
      memberTokenConfigs: true,
    },
  });
const own = () => relayTokenArn(owner, actor, first);
const customConfig = () =>
  vi.spyOn(ConfigService.getInstance(), "getRelayCustomKeyConfig").mockResolvedValue({
    enabled: true,
    maxTokensPerUser: 2,
    createLimitWindowMinutes: 1,
    createLimitMaxCount: 10,
  });
const customPermission = async (free = false) =>
  prisma.group.update({
    where: { id: groupId },
    data: {
      permissions: [
        Permission.RELAY_TOKEN_UPDATE,
        Permission.RELAY_TOKEN_READ,
        ...(free ? [Permission.RELAY_TOKEN_CUSTOM_KEY_FREE] : [Permission.RELAY_TOKEN_CUSTOM_KEY]),
      ],
    },
  });
const member = async (members?: string[]) =>
  (
    await prisma.relayToken.create({
      data: {
        userId: actor,
        name: prefix,
        token: "fixture-member-" + randomUUID(),
        channelId: members ? null : channels[0],
        routingMode: members ? "composite" : "ordered",
        memberTokenConfigs: members
          ? {
              create: members.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
            }
          : undefined,
      },
    })
  ).id;
const autoPool = async () => {
  const row = await prisma.relayChannel.create({
    data: {
      name: prefix,
      channelType: "automatic-proxy-pool",
      openaiUpstreamApiKey: "fixture-auto-secret",
      poolMembers: {
        create: channels.slice(0, 2).map((memberChannelId, priority) => ({ memberChannelId, priority })),
      },
    },
  });
  channels.push(row.id);
  return row.id;
};
const routing = () =>
  prisma.relayToken.findUniqueOrThrow({
    where: { id: first },
    select: {
      channelId: true,
      routingMode: true,
      channelConfigs: { select: { channelId: true, priority: true }, orderBy: { priority: "asc" } },
    },
  });
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  target: { type: "user" | "role"; id: string } = { type: "user", id: actor },
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource } });
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
const manager = (custom = false) =>
  prisma.group.update({
    where: { id: groupId },
    data: {
      permissions: [
        Permission.RELAY_TOKEN_UPDATE,
        Permission.RELAY_TOKEN_READ,
        Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
        Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
        ...(custom ? [Permission.RELAY_TOKEN_CUSTOM_KEY] : []),
      ],
    },
  });
async function oauthRequest(scopes: string[] = [Permission.RELAY_TOKEN_UPDATE, Permission.RELAY_TOKEN_READ]) {
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
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "token-update-" + randomUUID();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Update fixture",
        permissions: [Permission.RELAY_TOKEN_UPDATE, Permission.RELAY_TOKEN_READ],
        accountOwnerId: null,
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  const token = async (userId: string) =>
    (
      await prisma.relayToken.create({
        data: {
          userId,
          name: prefix,
          token: "sk-rlt-fixture-" + randomUUID(),
          legacyToken: "fixture-legacy-" + randomUUID(),
          upstreamApiKey: "fixture-private-secret",
        },
      })
    ).id;
  first = await token(actor);
  peerToken = await token(peer);
  foreignToken = await token(foreign);
  channels = [];
  for (let index = 0; index < 3; index++)
    channels.push(
      (
        await prisma.relayChannel.create({
          data: {
            name: prefix + index,
            openaiUpstreamApiKey: "fixture-upstream-private",
            openaiUpstreamUrl: "https://fixture.invalid",
          },
        })
      ).id,
    );
  await prisma.relayToken.updateMany({
    where: { id: { in: [first, peerToken, foreignToken] } },
    data: { channelId: channels[0] },
  });
  await prisma.relayTokenChannelConfig.createMany({
    data: [first, peerToken, foreignToken].map((relayTokenId) => ({
      relayTokenId,
      channelId: channels[0]!,
      priority: 0,
    })),
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayTokenMemberConfig.deleteMany({
    where: { parentToken: { userId: { in: [actor, peer, foreign] } } },
  });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer, foreign] } } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channels } } });
  await prisma.accessKey.deleteMany({ where: { userId: { in: [actor, peer] } } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("atomic resource-authorized complete token updates", () => {
  it("writes ordered routing, nullable fields, quota windows and failover without rich or public postcommit reads", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    const publicGet = vi.spyOn(RelayTokenService.prototype, "getToken");
    const before = await fullState();
    const result = await update({
      name: "  renamed  ",
      routingMode: "ordered",
      expiresAt: "2030-01-01T00:00:00Z",
      channelConfigs: [
        { channelId: channels[1]!, priority: 9 },
        { channelId: channels[0]!, priority: 2 },
      ],
      quotaLimit: 12,
      quotaWindows: [{ quotaLimit: 3, quotaUnit: "request", quotaWindowHours: 1 }],
      allowedModels: "model-a",
      ipWhitelist: "127.0.0.1",
      modelMapping: { a: "b" },
      requestFormatTransforms: null,
      normalizerConfig: null,
      contentSafetyConfig: null,
      streamConfig: null,
      failoverConfig: {
        enabled: true,
        maxRetries: 2,
        retryStatusCodes: ["503"],
        failoverThreshold: 0,
        failbackCooldownMinutes: 0,
      },
    });
    expect(result).toMatchObject({
      id: first,
      name: "renamed",
      token: before.token,
      allowedModels: "model-a",
      channelId: channels[0],
    });
    expect(await routing()).toMatchObject({
      channelConfigs: [
        { channelId: channels[0], priority: 0 },
        { channelId: channels[1], priority: 1 },
      ],
    });
    const after = await fullState();
    expect(Number(after.quotaLimit)).toBe(12);
    expect(Number(after.quotaWindows[0]!.quotaLimit)).toBe(3);
    expect(after.modelMapping).toEqual({ a: "b" });
    expect(after.failoverConfig).toMatchObject({ enabled: true, maxRetries: 2 });
    expect(rich).not.toHaveBeenCalled();
    expect(publicGet).not.toHaveBeenCalled();
  });
  it("retains omitted relations and accepts zero, null and empty quota clearing", async () => {
    await update({
      quotaWindows: [{ quotaLimit: 1, quotaUnit: "request", quotaWindowHours: 1 }],
      quotaLimit: 2,
      modelMapping: { a: "b" },
    });
    const before = await fullState();
    await update({ name: "name only" });
    const retained = await fullState();
    expect(retained.channelConfigs).toEqual(before.channelConfigs);
    expect(retained.quotaWindows).toEqual(before.quotaWindows);
    await update({ quotaLimit: 0, expiresAt: null, allowedModels: null, modelMapping: null, quotaWindows: [] });
    const cleared = await fullState();
    expect(Number(cleared.quotaLimit)).toBe(0);
    expect(cleared.quotaWindows).toEqual([]);
    expect(cleared.modelMapping).toBeNull();
    expect(cleared.expiresAt).toBeNull();
  });
  it.each(["quyan:relay:UpdateToken", "quyan:relay:GetToken", "quyan:relay:SelectTokenChannel"])(
    "does not write when independent %s is denied",
    async (action) => {
      const before = await fullState();
      await grant(
        action,
        action.endsWith("SelectTokenChannel") ? relayChannelSelectionArn(owner, channels[0]!) : own(),
      );
      await expect(update()).rejects.toMatchObject({ statusCode: 403 });
      expect(await fullState()).toEqual(before);
    },
  );
  it("checks all retained fallback selections, not just a changed primary", async () => {
    await update({
      channelConfigs: [
        { channelId: channels[0]!, priority: 0 },
        { channelId: channels[1]!, priority: 1 },
      ],
    });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[1]!));
    const before = await fullState();
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
  });
  it("never selects stored credentials when disclosure is denied", async () => {
    await grant("quyan:relay:RevealToken", own());
    const transaction = prisma.$transaction.bind(prisma),
      selects: unknown[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      transaction(async (tx) => {
        const read = tx.relayToken.findFirst.bind(tx.relayToken);
        vi.spyOn(tx.relayToken, "findFirst").mockImplementation((args) => {
          selects.push(args?.select);
          return read(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const result = await update();
    expect(result).not.toHaveProperty("token");
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects)
      for (const field of ["token", "legacyToken", "upstreamApiKey", "upstreamUrl"])
        expect(select).not.toHaveProperty(field);
  });
  it("rejects a stale source before writing instead of overwriting a concurrent change", async () => {
    const repository = RelayTokenMutationRepository.getInstance(),
      candidates = repository.candidates.bind(repository);
    vi.spyOn(repository, "candidates").mockImplementation(async (...args) => {
      const rows = await candidates(...args);
      if (!args[2])
        await prisma.relayToken.update({
          where: { id: first },
          data: { name: "external change", updateTime: new Date(rows[0]!.updateTime.getTime() + 1000) },
        });
      return rows;
    });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect((await fullState()).name).toBe("external change");
  });
  it("supports JSON-only exact grants and ignores forged Action headers without reading credentials", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant("quyan:relay:UpdateToken", own(), "Allow");
    await grant("quyan:relay:GetToken", own(), "Allow");
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow");
    const sources = vi.spyOn(RelayTokenUpdateAdmissionRepository.getInstance(), "source");
    const result = await update();
    expect(result).toMatchObject({ id: first, name: "updated" });
    expect(result).not.toHaveProperty("token");
    for (const call of sources.mock.results)
      if (call.type === "return") {
        const value = await call.value;
        expect(value).not.toHaveProperty("token");
        expect(JSON.stringify(value)).not.toContain("fixture-private-secret");
      }
  });
  it.each(["hidden", "disabled", "provider"])("rejects %s ordered selections", async (kind) => {
    await prisma.relayChannel.update({
      where: { id: channels[0] },
      data:
        kind === "hidden"
          ? { visibilityMode: "hidden" }
          : kind === "disabled"
            ? { status: RELAY_CHANNEL_STATUS.DISABLED }
            : { providerServiceEnabled: false },
    });
    const before = await fullState();
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
  });
  it("converts to an automatic pool and then back to ordered without discarding unrelated settings", async () => {
    const pool = await autoPool();
    await update({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: pool,
      blockedAutomaticProxyPoolChannelIds: [channels[0]!],
      name: "automatic",
    });
    expect(await fullState()).toMatchObject({
      routingMode: "automatic-pool",
      channelId: null,
      channelConfigs: [],
      automaticProxyPoolChannelId: pool,
      blockedAutomaticProxyPoolChannelIds: [channels[0]],
    });
    await update({ name: "automatic renamed" });
    await update({ routingMode: "ordered", channelId: channels[1] });
    expect(await fullState()).toMatchObject({
      routingMode: "ordered",
      channelId: channels[1],
      automaticProxyPoolChannelId: null,
      blockedAutomaticProxyPoolChannelIds: [],
    });
  });
  it("accepts reachable nested strict members and applies strict settings over conflicting legacy edges", async () => {
    const logical = await prisma.relayChannel.create({ data: { name: prefix, channelType: "pooled" } });
    channels.push(logical.id);
    await prisma.relayChannel.update({
      where: { id: channels[0] },
      data: { channelType: "pooled-member", pooledParentId: logical.id, pooledMemberEnabled: true },
    });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: logical.id, memberChannelId: channels[0]!, priority: 0, enabled: false },
    });
    const pool = await autoPool();
    await prisma.relayChannelMember.update({
      where: { relayChannelId_memberChannelId: { relayChannelId: pool, memberChannelId: channels[0]! } },
      data: { memberChannelId: logical.id },
    });
    await update({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: pool,
      blockedAutomaticProxyPoolChannelIds: [channels[0]!],
    });
    expect((await fullState()).blockedAutomaticProxyPoolChannelIds).toEqual([channels[0]]);
    const before = await fullState();
    await expect(
      update({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: [logical.id, channels[1]!],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await fullState()).toEqual(before);
  });
  it("does not introduce an unauthorized dormant channel binding while retaining automatic mode", async () => {
    const pool = await autoPool();
    await update({ routingMode: "automatic-pool", automaticProxyPoolChannelId: pool });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[2]!));
    const before = await fullState();
    await expect(update({ channelId: channels[2] })).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
  });
  it("preserves the existing dormant-binding patch variant only with independent channel admission", async () => {
    const pool = await autoPool();
    await update({ routingMode: "automatic-pool", automaticProxyPoolChannelId: pool });
    await update({ channelId: channels[2] });
    expect(await fullState()).toMatchObject({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: pool,
      channelId: channels[2],
    });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[2]!));
    const before = await fullState();
    await expect(update({ name: "must recheck dormant bindings" })).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
  });
  it("checks automatic-root admission before revealing blocked-member validation results", async () => {
    const pool = await autoPool();
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, pool));
    await expect(
      update({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: ["unknown"],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires selection of the automatic root and never treats it as an ordinary channel", async () => {
    const pool = await autoPool();
    const before = await fullState();
    await expect(update({ routingMode: "ordered", channelId: pool })).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, pool));
    await expect(update({ routingMode: "automatic-pool", automaticProxyPoolChannelId: pool })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await fullState()).toEqual(before);
  });
  it.each(["all", "foreign", "disabled"])("rejects %s automatic blocked-member lists atomically", async (kind) => {
    const pool = await autoPool();
    if (kind === "disabled")
      await prisma.relayChannel.update({ where: { id: channels[0] }, data: { status: RELAY_CHANNEL_STATUS.DISABLED } });
    const before = await fullState();
    const blocked = kind === "all" ? channels.slice(0, 2) : [kind === "foreign" ? channels[2]! : channels[0]!];
    await expect(
      update({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: blocked,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await fullState()).toEqual(before);
  });
  it("converts to composite with a complete independently authorized referenced subtree", async () => {
    const leaf = await member(),
      child = await member([leaf]);
    await update({ routingMode: "composite", memberTokenConfigs: [{ tokenId: child, priority: 0, enabled: true }] });
    const state = await fullState();
    expect(state.routingMode).toBe("composite");
    expect(state.channelId).toBeNull();
    expect(state.memberTokenConfigs).toMatchObject([{ tokenId: child }]);
    expect(state.failoverConfig?.enabled).toBe(true);
    await expect(update({ name: "cannot mutate existing composite" })).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["ReferenceToken", "GetToken"])(
    "rejects a nested member denied %s including disabled references",
    async (operation) => {
      const leaf = await member(),
        child = await member([leaf]);
      await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: child }, data: { enabled: false } });
      await grant("quyan:relay:" + operation, relayTokenArn(owner, actor, leaf));
      const before = await fullState();
      await expect(
        update({ routingMode: "composite", memberTokenConfigs: [{ tokenId: child, priority: 0, enabled: true }] }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await fullState()).toEqual(before);
    },
  );
  it("rejects foreign-owner composition references and cycles", async () => {
    for (const tokenId of [peerToken, first])
      await expect(
        update({ routingMode: "composite", memberTokenConfigs: [{ tokenId, priority: 0, enabled: true }] }),
      ).rejects.toThrow();
    expect((await fullState()).routingMode).toBe("ordered");
  });
  it("changes a custom credential only with separate setter and reveal authority", async () => {
    customConfig();
    await customPermission();
    const assertRate = vi
      .spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit")
      .mockResolvedValue(undefined);
    const mark = vi.spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure").mockResolvedValue(undefined);
    const value = getCredentialPrefix("relayToken") + "custom-" + randomUUID();
    const result = await update({ token: value });
    expect(result.token).toBe(value);
    expect((await fullState()).isCustomKey).toBe(true);
    expect(assertRate).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledTimes(1);
  });
  it.each(["SetTokenCredential", "RevealToken"])(
    "does not bypass %s denial by setting a known key",
    async (operation) => {
      customConfig();
      await customPermission();
      await grant("quyan:relay:" + operation, own());
      const before = await fullState();
      await expect(
        update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await fullState()).toEqual(before);
    },
  );
  it("uses a fresh disclosed credential without adopting an occupied alias", async () => {
    customConfig();
    await customPermission();
    vi.spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit").mockResolvedValue(undefined);
    vi.spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure").mockResolvedValue(undefined);
    const other = await fullState(peerToken),
      result = await update({ token: other.token });
    expect(result.token).toBeTruthy();
    expect(result.token).not.toBe(other.token);
    expect((await fullState()).legacyToken).toBeNull();
    expect((await fullState(peerToken)).token).toBe(other.token);
  });
  it("canonicalizes a free legacy alias without changing its secret suffix", async () => {
    await customPermission(true);
    const preferred = "rlt_" + randomUUID().replaceAll("-", "");
    const result = await update({ token: preferred });
    expect(result.token).toBe(getCredentialPrefix("relayToken") + preferred.slice(4));
    expect((await fullState()).legacyToken).toBe(preferred);
  });
  it("rolls back credential and related configuration on a final custom-key configuration change", async () => {
    const config = customConfig();
    await customPermission();
    vi.spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit").mockResolvedValue(undefined);
    const mark = vi.spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure").mockResolvedValue(undefined);
    const before = await fullState(),
      responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      config.mockResolvedValue({
        enabled: false,
        maxTokensPerUser: 2,
        createLimitWindowMinutes: 1,
        createLimitMaxCount: 10,
      });
      return result;
    });
    await expect(
      update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID(), quotaLimit: 10 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
    expect(mark).toHaveBeenCalledTimes(1);
  });
  it("enforces custom-key count/config/rate limits instead of granting an implicit bypass", async () => {
    const config = customConfig();
    await customPermission();
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 0,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    const before = await fullState();
    await expect(update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toMatchObject(
      { statusCode: 400 },
    );
    config.mockResolvedValue({
      enabled: false,
      maxTokensPerUser: 2,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    await expect(update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toMatchObject(
      { statusCode: 403 },
    );
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 2,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    vi.spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit").mockRejectedValue(
      new Error("fixture rate unavailable"),
    );
    await expect(update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toThrow(
      "fixture rate unavailable",
    );
    expect(await fullState()).toEqual(before);
  });
  it("requires the independent free capability to bypass limits", async () => {
    const config = customConfig();
    await customPermission(true);
    config.mockResolvedValue({
      enabled: false,
      maxTokensPerUser: 0,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    const mark = vi.spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure");
    await update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() });
    expect(mark).not.toHaveBeenCalled();
    await grant("quyan:relay:BypassTokenCredentialLimits", own());
    await expect(update({ token: getCredentialPrefix("relayToken") + "other-" + randomUUID() })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("requires persisted OAuth custom-key scope, not just request or identity grants", async () => {
    customConfig();
    await customPermission();
    const req = await oauthRequest();
    await expect(
      update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }, first, undefined, req),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    const scoped = await oauthRequest([
      Permission.RELAY_TOKEN_UPDATE,
      Permission.RELAY_TOKEN_READ,
      Permission.RELAY_TOKEN_CUSTOM_KEY,
    ]);
    vi.spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit").mockResolvedValue(undefined);
    vi.spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure").mockResolvedValue(undefined);
    await expect(
      update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }, first, undefined, scoped),
    ).resolves.toMatchObject({ id: first });
  });
  it("does not borrow free identity scope when an OAuth token delegates only ordinary custom-key scope", async () => {
    const config = customConfig();
    await customPermission(true);
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 0,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    const req = await oauthRequest([
      Permission.RELAY_TOKEN_UPDATE,
      Permission.RELAY_TOKEN_READ,
      Permission.RELAY_TOKEN_CUSTOM_KEY,
    ]);
    await expect(
      update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }, first, undefined, req),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("does not bypass target custom-key limits simply because a different owner was selected", async () => {
    const config = customConfig();
    await manager(true);
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 0,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    await grant("quyan:relay:SetManagedTokenCredential", platformRelayTokenArn(peer, peerToken), "Allow");
    const before = await fullState(peerToken);
    await expect(
      update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }, peerToken, peer),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await fullState(peerToken)).toEqual(before);
  });
  it("requires persisted global ceilings and target-specific management and response authority", async () => {
    await expect(update({ name: "managed" }, peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
    await manager();
    await update({ name: "managed" }, peerToken, peer);
    await grant("quyan:relay:UpdateManagedToken", platformRelayTokenArn(peer, peerToken));
    await expect(update({ name: "denied" }, peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
    expect((await fullState(peerToken)).name).toBe("managed");
  });
  it.each(["policy", "request", "key", "oauth", "source", "selection"])(
    "rolls back real writes when %s changes during response projection",
    async (kind) => {
      const req = kind === "oauth" ? await oauthRequest() : request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const before = await fullState(),
        responses = RelayTokenMutationResponseRepository.getInstance(),
        read = responses.read.bind(responses);
      vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
        const result = await read(tx, ...args);
        expect((await tx.relayToken.findUniqueOrThrow({ where: { id: first }, select: { name: true } })).name).toBe(
          "updated",
        );
        if (kind === "policy")
          vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
            input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
          );
        else if (kind === "request") req.authContext!.accountOwnerId = foreign;
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "oauth")
          await tx.oAuthAccessToken.update({
            where: { id: req.oauthAccessToken!.id },
            data: { revokedAt: new Date() },
          });
        else if (kind === "source") await tx.relayToken.update({ where: { id: first }, data: { isCustomKey: true } });
        else await tx.relayChannel.update({ where: { id: channels[0] }, data: { visibilityMode: "hidden" } });
        return result;
      });
      await expect(
        update(
          { name: "updated", quotaWindows: [{ quotaLimit: 2, quotaUnit: "request", quotaWindowHours: 1 }] },
          first,
          undefined,
          req,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await fullState()).toEqual(before);
    },
  );
  it("rolls back a composed write if a referenced token's authority changes after it is stored", async () => {
    const leaf = await member(),
      before = await fullState(),
      responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      await tx.relayToken.update({ where: { id: leaf }, data: { status: -1 } });
      return result;
    });
    await expect(
      update({ routingMode: "composite", memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: true }] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
  });
  it("uses role-only grants and rolls back when the role session is revoked after writing", async () => {
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
    await expect(update({}, first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    for (const action of ["UpdateToken", "GetToken"])
      await grant("quyan:relay:" + action, own(), "Allow", { type: "role", id: role.id });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow", {
      type: "role",
      id: role.id,
    });
    expect((await update({ name: "role update" }, first, undefined, req)).id).toBe(first);
    const before = await fullState(),
      responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(update({ name: "revoked" }, first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await fullState()).toEqual(before);
  });
  it("retains the fail-closed distributed graph lock before composite storage", async () => {
    const leaf = await member(),
      before = await fullState();
    const lock = vi
      .spyOn(DistributedLockService.getInstance(), "runWithLock")
      .mockRejectedValue(new Error("fixture graph lock unavailable"));
    const write = vi.spyOn(RelayTokenUpdateRepository.getInstance(), "apply");
    await expect(
      update({ routingMode: "composite", memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: true }] }),
    ).rejects.toThrow("fixture graph lock unavailable");
    expect(lock).toHaveBeenCalledWith(
      DistributedLockService.buildKey("relay-composition", actor),
      expect.any(Function),
      { failClosed: true },
    );
    expect(write).not.toHaveBeenCalled();
    expect(await fullState()).toEqual(before);
  });
  it("records one successful update without request credentials or upstream configuration", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const result = await update();
    expect(audit).toHaveBeenCalledOnce();
    const text = JSON.stringify(audit.mock.calls);
    expect(text).not.toContain(result.token!);
    expect(text).not.toContain("fixture-private-secret");
    expect(text).not.toContain("fixture-upstream-private");
    expect(text).not.toContain("legacyToken");
  });
  it.each(["legacy", "shadow"] as const)(
    "runs the %s business mutation exactly once and shadow never writes or consumes custom-key attempts",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      customConfig();
      await customPermission();
      const writes = vi.spyOn(RelayTokenUpdateRepository.getInstance(), "apply");
      const mark = vi
        .spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure")
        .mockResolvedValue(undefined);
      vi.spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit").mockResolvedValue(undefined);
      await update({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() });
      expect(writes).toHaveBeenCalledTimes(1);
      expect(mark).toHaveBeenCalledTimes(1);
    },
  );
  it("fails closed without a request binding in enforce", async () => {
    await expect(service().updateToken(first, actor, { name: "missing context" })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
