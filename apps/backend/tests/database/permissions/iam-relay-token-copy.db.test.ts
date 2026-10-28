import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, buildAcsResource } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenCreateIamService } from "@/services/relay/relay-token-create-iam.service";
import { RelayTokenCreateMutationRepository } from "@/store/relay/relay-token-create-mutation.repository";
import { RelayTokenCreateRepository } from "@/store/relay/relay-token-create.repository";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RelayTokenMutationResponseRepository } from "@/store/relay/relay-token-mutation-response.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { ConfigService } from "@/services/system/config.service";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";
import { DistributedLockService } from "@/services/infrastructure/distributed-lock.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { RelayTokenCopyRepository, relayTokenCopySelect } from "@/store/relay/relay-token-copy.repository";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";

let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  id: string,
  prefix: string,
  channels: string[];
let ids: string[];
let sources: string[];
const originalMode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;

const own = (targetId = id) => relayTokenArn(owner, actor, targetId);
const control = () => buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "user/" + actor });
const absent = async () => {
  expect(await prisma.relayToken.count({ where: { id } })).toBe(0);
  expect(await prisma.relayTokenChannelConfig.count({ where: { relayTokenId: id } })).toBe(0);
  expect(await prisma.relayTokenQuotaWindow.count({ where: { relayTokenId: id } })).toBe(0);
  expect(await prisma.relayTokenFailoverConfig.count({ where: { relayTokenId: id } })).toBe(0);
  expect(await prisma.relayTokenMemberConfig.count({ where: { parentTokenId: id } })).toBe(0);
};
async function permissions(custom = false, free = false, managed = false) {
  await prisma.group.update({
    where: { id: groupId },
    data: {
      permissions: [
        Permission.RELAY_TOKEN_CREATE,
        Permission.RELAY_TOKEN_READ,
        Permission.RELAY_TOKEN_UPDATE,
        ...(custom ? [Permission.RELAY_TOKEN_CUSTOM_KEY] : []),
        ...(free ? [Permission.RELAY_TOKEN_CUSTOM_KEY_FREE] : []),
        ...(managed ? [Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] : []),
      ],
    },
  });
}
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  principal = { type: "user", id: actor },
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
      principalType: principal.type,
      principalId: principal.id,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function member(userId = actor, children?: string[]) {
  return (
    await prisma.relayToken.create({
      data: {
        userId,
        token: "fixture-member-" + randomUUID(),
        name: prefix,
        channelId: children ? null : channels[0],
        routingMode: children ? "composite" : "ordered",
        memberTokenConfigs: children
          ? { create: children.map((tokenId, priority) => ({ tokenId, priority, enabled: false })) }
          : undefined,
      },
    })
  ).id;
}
async function automatic() {
  const pool = await prisma.relayChannel.create({
    data: {
      name: prefix,
      channelType: "automatic-proxy-pool",
      poolMembers: { create: channels.slice(0, 2).map((memberChannelId, priority) => ({ memberChannelId, priority })) },
    },
  });
  channels.push(pool.id);
  return pool.id;
}
function customConfig() {
  const config = vi
    .spyOn(ConfigService.getInstance(), "getRelayCustomKeyConfig")
    .mockResolvedValue({ enabled: true, maxTokensPerUser: 1, createLimitWindowMinutes: 1, createLimitMaxCount: 10 });
  const attempt = vi
    .spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure")
    .mockResolvedValue(undefined);
  vi.spyOn(RateLimiterService.getInstance(), "assertBackoffRateLimit").mockResolvedValue(undefined);
  return { config, attempt };
}
async function oauthRequest(scopes: string[] = [Permission.RELAY_TOKEN_CREATE, Permission.RELAY_TOKEN_READ]) {
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
  prefix = "token-copy-" + randomUUID();
  id = randomUUID().replaceAll("-", "");
  ids = [id, randomUUID().replaceAll("-", "")];
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
      data: { username: prefix, name: "Creation fixture", permissions: [], accountOwnerId: null },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await permissions();
  channels = [];
  for (let n = 0; n < 3; n++)
    channels.push(
      (
        await prisma.relayChannel.create({
          data: {
            name: prefix + n,
            openaiUpstreamApiKey: "fixture-upstream-private",
            openaiUpstreamUrl: "https://fixture.invalid",
          },
        })
      ).id,
    );
  sources = [await member(), await member()];
  for (const [index, source] of sources.entries())
    await prisma.relayToken.update({
      where: { id: source },
      data: {
        name: `source-${index}`,
        isCustomKey: true,
        legacyToken: "fixture-legacy-private-" + source,
        upstreamApiKey: "fixture-source-upstream-private",
        totalTokens: 19,
        requestCount: 7,
        usedQuota: 3,
      },
    });
  let allocation = 0;
  vi.spyOn(
    RelayTokenCreateIamService.getInstance() as unknown as { allocateId: () => string },
    "allocateId",
  ).mockImplementation(() => ids[allocation++] ?? randomUUID().replaceAll("-", ""));
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayTokenMemberConfig.deleteMany({
    where: { parentToken: { userId: { in: [actor, peer, foreign] } } },
  });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer, foreign] } } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channels } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});

const copied = (sourceIds = sources, req = request(), targetUserId?: string) =>
  new RelayTokenService().batchDuplicateTokens(sourceIds, actor, req, targetUserId);
const copiedOne = (sourceId = sources[0]!, req = request(), targetUserId?: string, name?: string | null) =>
  new RelayTokenService().duplicateToken(sourceId, { targetUserId, name }, actor, req);
const absentAll = async () => {
  await absent();
  expect(await prisma.relayToken.count({ where: { id: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenChannelConfig.count({ where: { relayTokenId: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenQuotaWindow.count({ where: { relayTokenId: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenMemberConfig.count({ where: { parentTokenId: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenFailoverConfig.count({ where: { relayTokenId: { in: ids } } })).toBe(0);
};

describe("atomic resource-authorized token duplication", () => {
  it("copies in request order in one transaction with fresh credentials and no source secrets or counters", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    const richCreate = vi.spyOn(RelayTokenRepository.getInstance(), "create");
    const transactions = vi.spyOn(prisma, "$transaction");
    const sourceReads = vi.spyOn(RelayTokenCopyRepository.getInstance(), "sources");
    const { config, attempt } = customConfig();
    config.mockResolvedValue({
      enabled: false,
      maxTokensPerUser: 0,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 1,
    });
    const result = await copied([...sources].reverse());
    expect(result.map((row) => row.id)).toEqual(ids);
    expect(result.map((row) => row.name)).toEqual(["source-1（副本）", "source-0（副本）"]);
    expect(transactions).toHaveBeenCalledOnce();
    expect(rich).not.toHaveBeenCalled();
    expect(richCreate).not.toHaveBeenCalled();
    expect(attempt).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(new Set(result.map((row) => row.token)).size).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-member|fixture-legacy-private|fixture-source-upstream-private|fixture-upstream-private/,
    );
    for (const row of result)
      expect(await prisma.relayToken.findUnique({ where: { id: row.id } })).toMatchObject({
        userId: actor,
        status: 1,
        isCustomKey: false,
        legacyToken: null,
        upstreamApiKey: null,
        totalTokens: 0,
        requestCount: 0,
      });
    for (const read of sourceReads.mock.results) {
      const rows = await read.value;
      for (const row of rows)
        for (const field of [
          "token",
          "legacyToken",
          "isCustomKey",
          "upstreamApiKey",
          "upstreamUrl",
          "user",
          "channel",
          "usedQuota",
          "requestCount",
        ])
          expect(row).not.toHaveProperty(field);
    }
    for (const field of ["token", "legacyToken", "isCustomKey", "upstreamApiKey", "upstreamUrl", "user", "channel"])
      expect(relayTokenCopySelect).not.toHaveProperty(field);
  });
  it.each(["DuplicateToken", "GetToken"])(
    "denies the whole batch before source configuration reads if the final source lacks %s",
    async (action) => {
      await grant("quyan:relay:" + action, own(sources[1]!));
      const reads = vi.spyOn(RelayTokenCopyRepository.getInstance(), "sources");
      await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
      expect(reads).not.toHaveBeenCalled();
      await absentAll();
    },
  );
  it.each(["CreateToken", "GetToken"])(
    "requires %s independently on the last prospective destination",
    async (action) => {
      await grant("quyan:relay:" + action, own(ids[1]!));
      await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
      await absentAll();
    },
  );
  it.each(["DuplicateToken", "CreateToken"])("requires the author's user creation scope for %s", async (action) => {
    await grant("quyan:relay:" + action, control());
    await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("uses exact JSON-only source and destination grants without UPDATE, Import or source Reveal", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    for (const action of ["DuplicateToken", "CreateToken"]) await grant("quyan:relay:" + action, control(), "Allow");
    for (const source of sources)
      for (const action of ["DuplicateToken", "GetToken"]) await grant("quyan:relay:" + action, own(source), "Allow");
    for (const id of ids)
      for (const action of ["CreateToken", "GetToken"]) await grant("quyan:relay:" + action, own(id), "Allow");
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow");
    const result = await copied();
    expect(result.map((row) => row.id)).toEqual(ids);
    expect(result.every((row) => row.token === undefined)).toBe(true);
  });
  it("does not treat new-token creation as authority to copy an existing source", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    for (const action of ["DuplicateToken", "CreateToken"]) await grant("quyan:relay:" + action, control(), "Allow");
    for (const id of ids)
      for (const action of ["CreateToken", "GetToken"]) await grant("quyan:relay:" + action, own(id), "Allow");
    for (const source of sources) await grant("quyan:relay:GetToken", own(source), "Allow");
    await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("can copy a source with explicit credential disclosure Deny while disclosing an independently allowed destination", async () => {
    for (const source of sources) await grant("quyan:relay:RevealToken", own(source));
    const result = await copied();
    expect(result.every((row) => Boolean(row.token))).toBe(true);
  });
  it("returns metadata-only for destinations denied Reveal without weakening another destination", async () => {
    await grant("quyan:relay:RevealToken", own(ids[1]!));
    const result = await copied();
    expect(result[0]!.token).toBeTruthy();
    expect(result[1]!.token).toBeUndefined();
  });
  it("preserves complete configuration but enables a copied disabled source and resets its usage", async () => {
    await prisma.relayToken.update({
      where: { id: sources[0] },
      data: {
        status: 0,
        name: " configured ",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
        quotaLimit: 0,
        allowedModels: "model-a",
        modelMapping: { "model-a": "upstream-a" },
        streamConfig: { preflightBufferLimitBytes: 524288 },
        contentSafetyConfig: { requestEnabled: false },
        normalizerConfig: { enabled: true },
        ipWhitelist: "127.0.0.1",
        channelConfigs: {
          create: [
            { channelId: channels[1]!, priority: 1 },
            { channelId: channels[0]!, priority: 0 },
          ],
        },
        quotaWindows: { create: { quotaLimit: 2.5, quotaUnit: "amount", quotaWindowHours: 1 } },
        failoverConfig: {
          create: { enabled: true, maxRetries: 3, retryStatusCodes: ["5xx"], maxAcceptedChannelMultiplier: 1.25 },
        },
      },
    });
    const result = await copiedOne();
    expect(result).toMatchObject({
      id,
      name: "configured（副本）",
      quotaLimit: 0,
      allowedModels: "model-a",
      modelMapping: { "model-a": "upstream-a" },
      streamConfig: { preflightBufferLimitBytes: 524288 },
      contentSafetyConfig: { requestEnabled: false },
      ipWhitelist: "127.0.0.1",
    });
    const row = await prisma.relayToken.findUniqueOrThrow({
      where: { id },
      include: { quotaWindows: true, channelConfigs: true, failoverConfig: true },
    });
    expect(row.status).toBe(1);
    expect(Number(row.usedQuota)).toBe(0);
    expect(row.requestCount).toBe(0);
    expect(
      row.quotaWindows.map((row) => [Number(row.quotaLimit), row.quotaUnit, Number(row.quotaWindowHours)]),
    ).toEqual([[2.5, "amount", 1]]);
    expect(row.channelConfigs).toHaveLength(2);
    expect(row.failoverConfig?.maxRetries).toBe(3);
  });
  it("reserves shared copy suffixes against disabled and within-batch destinations", async () => {
    for (const source of sources)
      await prisma.relayToken.update({ where: { id: source }, data: { name: " same ", status: 0 } });
    const existing = await member();
    await prisma.relayToken.update({ where: { id: existing }, data: { name: "same（副本）", status: 0 } });
    expect((await copied()).map((row) => row.name)).toEqual(["same（副本2）", "same（副本3）"]);
  });
  it("honors a single explicit name override rather than auto-renaming it and leaves unnamed sources unnamed", async () => {
    expect((await copiedOne(undefined, request(), undefined, " explicit ")).name).toBe("explicit");
    await prisma.relayToken.deleteMany({ where: { id: { in: ids } } });
    await prisma.relayToken.update({ where: { id: sources[0] }, data: { name: null } });
    const result = await copiedOne();
    expect(result.name == null || result.name === "").toBe(true);
  });
  it("checks every fallback selection before copying even a disabled source", async () => {
    await prisma.relayToken.update({
      where: { id: sources[1] },
      data: {
        status: 0,
        channelConfigs: {
          create: [
            { channelId: channels[0]!, priority: 0 },
            { channelId: channels[1]!, priority: 1 },
          ],
        },
      },
    });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[1]!));
    await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it.each(["missing", "foreign", "peer", "deleted"])(
    "fails closed for a %s source without silently returning partial copies",
    async (kind) => {
      const target =
        kind === "missing"
          ? "missing-id"
          : kind === "deleted"
            ? sources[1]!
            : await member(kind === "peer" ? peer : foreign);
      if (kind === "deleted") await prisma.relayToken.update({ where: { id: target }, data: { status: -1 } });
      await expect(copied([sources[0]!, target])).rejects.toMatchObject({ statusCode: 403 });
      await absentAll();
    },
  );
  it("does not let a single target override move a source into another owner", async () => {
    await permissions(false, false, true);
    await expect(copiedOne(sources[0], request(), peer)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("does not permit single inferred management to bypass persisted global qualification", async () => {
    const source = await member(peer);
    await expect(copiedOne(source)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it.each([true, false])(
    "copies managed resources only with exact live platform qualification (single=%s)",
    async (single) => {
      await permissions(false, false, true);
      const managedSources = [await member(peer), await member(peer)];
      const result = single ? [await copiedOne(managedSources[0])] : await copied(managedSources, request(), peer);
      expect(result.every((row) => row.userId === peer)).toBe(true);
    },
  );
  it.each(["DuplicateManagedToken", "GetManagedToken"])("requires %s on the last managed source", async (action) => {
    await permissions(false, false, true);
    const managedSources = [await member(peer), await member(peer)];
    await grant("quyan:relay:" + action, platformRelayTokenArn(peer, managedSources[1]!));
    await expect(copied(managedSources, request(), peer)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it.each(["CreateManagedToken", "GetManagedToken"])("requires %s on the last managed destination", async (action) => {
    await permissions(false, false, true);
    const managedSources = [await member(peer), await member(peer)];
    await grant("quyan:relay:" + action, platformRelayTokenArn(peer, ids[1]!));
    await expect(copied(managedSources, request(), peer)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("requires management on the exact target user, not just individual token grants", async () => {
    await permissions(false, false, true);
    const source = await member(peer);
    await grant("quyan:relay:DuplicateManagedToken", platformUserArn(peer));
    await expect(copiedOne(source)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("copies automatic-pool routing and applies current selection/topology admission", async () => {
    const pool = await automatic();
    await prisma.relayToken.update({
      where: { id: sources[1] },
      data: {
        channelId: null,
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: [channels[0]!],
      },
    });
    expect((await copied())[1]!.routingMode).toBe("automatic-pool");
    expect(await prisma.relayToken.findUnique({ where: { id: ids[1] } })).toMatchObject({
      automaticProxyPoolChannelId: pool,
      blockedAutomaticProxyPoolChannelIds: [channels[0]!],
    });
  });
  it("denies the entire copy if the automatic root selection is denied", async () => {
    const pool = await automatic();
    await prisma.relayToken.update({
      where: { id: sources[1] },
      data: { channelId: null, routingMode: "automatic-pool", automaticProxyPoolChannelId: pool },
    });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, pool));
    await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("copies composite references without revealing or copying descendant credentials", async () => {
    const leaf = await member(),
      child = await member(actor, [leaf]);
    await prisma.relayToken.update({
      where: { id: sources[1] },
      data: {
        channelId: null,
        routingMode: "composite",
        memberTokenConfigs: { create: { tokenId: child, priority: 0, enabled: false } },
      },
    });
    for (const source of [...sources, leaf, child]) await grant("quyan:relay:RevealToken", own(source));
    expect((await copied())[1]!.routingMode).toBe("composite");
    expect(
      await prisma.relayTokenMemberConfig.findMany({
        where: { parentTokenId: ids[1] },
        select: { tokenId: true, enabled: true },
      }),
    ).toEqual([{ tokenId: child, enabled: false }]);
  });
  it.each(["ReferenceToken", "GetToken"])(
    "requires %s on the full composite subtree including disabled bindings",
    async (action) => {
      const leaf = await member(),
        child = await member(actor, [leaf]);
      await prisma.relayToken.update({
        where: { id: sources[1] },
        data: {
          channelId: null,
          routingMode: "composite",
          memberTokenConfigs: { create: { tokenId: child, priority: 0, enabled: false } },
        },
      });
      await grant("quyan:relay:" + action, own(leaf));
      await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
      await absentAll();
    },
  );
  it("never falls back to copying outside the distributed graph lock", async () => {
    const reads = vi.spyOn(RelayTokenCopyRepository.getInstance(), "sources");
    vi.spyOn(DistributedLockService.getInstance(), "runWithLock").mockRejectedValue(
      new Error("fixture graph unavailable"),
    );
    await expect(copied()).rejects.toThrow("fixture graph unavailable");
    expect(reads).not.toHaveBeenCalled();
    await absentAll();
  });
  it.each(["policy", "principal"])(
    "rechecks %s after waiting for source locks and before configuration hydration",
    async (kind) => {
      const req = request(),
        copies = RelayTokenCopyRepository.getInstance(),
        lock = copies.lock.bind(copies);
      const reads = vi.spyOn(copies, "sources");
      vi.spyOn(copies, "lock").mockImplementation(async (...args) => {
        await lock(...args);
        if (kind === "policy") vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
        else req.authContext!.accountOwnerId = foreign;
      });
      await expect(copied(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(reads).not.toHaveBeenCalled();
      await absentAll();
    },
  );
  it("rolls back earlier destination inserts when the last insert fails", async () => {
    const writer = RelayTokenCreateRepository.getInstance(),
      write = writer.apply.bind(writer);
    let count = 0;
    vi.spyOn(writer, "apply").mockImplementation(async (...args) => {
      if (++count === 2) throw new Error("fixture final write failed");
      return write(...args);
    });
    await expect(copied()).rejects.toThrow("fixture final write failed");
    await absentAll();
    expect(await prisma.relayToken.count({ where: { id: { in: sources } } })).toBe(2);
  });
  it.each([
    "policy",
    "request",
    "key",
    "oauth",
    "source-owner",
    "source-status",
    "source-config",
    "source-relation",
    "selection",
    "destination",
  ])("rolls back every destination if %s changes during the last response", async (kind) => {
    const req = kind === "oauth" ? await oauthRequest() : request();
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.authContext!.subjectType = "access_key";
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    }
    const responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    let count = 0;
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      if (++count !== 2) return result;
      if (kind === "policy") vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
      else if (kind === "request") req.authContext!.accountOwnerId = foreign;
      else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
      else if (kind === "oauth")
        await tx.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { scopes: [] } });
      else if (kind === "source-owner")
        await tx.relayToken.update({ where: { id: sources[0] }, data: { userId: peer } });
      else if (kind === "source-status")
        await tx.relayToken.update({ where: { id: sources[0] }, data: { status: -1 } });
      else if (kind === "source-config")
        await tx.relayToken.update({ where: { id: sources[0] }, data: { modelMapping: { changed: "yes" } } });
      else if (kind === "source-relation")
        await tx.relayTokenQuotaWindow.create({
          data: { relayTokenId: sources[0]!, quotaLimit: 1, quotaUnit: "amount", quotaWindowHours: 1 },
        });
      else if (kind === "selection")
        await tx.relayChannel.update({ where: { id: channels[0] }, data: { visibilityMode: "hidden" } });
      else await tx.relayToken.update({ where: { id }, data: { isCustomKey: true } });
      return result;
    });
    await expect(copied(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(count).toBe(2);
    await absentAll();
  });
  it("rechecks sources when their relation changes without touching the parent update timestamp", async () => {
    const before = await prisma.relayToken.findUniqueOrThrow({ where: { id: sources[0] } });
    const writer = RelayTokenCreateRepository.getInstance(),
      write = writer.apply.bind(writer);
    let count = 0;
    vi.spyOn(writer, "apply").mockImplementation(async (tx, ...args) => {
      const result = await write(tx, ...args);
      if (++count === 2)
        await tx.relayTokenChannelConfig.create({
          data: { relayTokenId: sources[0]!, channelId: channels[1]!, priority: 0 },
        });
      return result;
    });
    await expect(copied()).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
    expect((await prisma.relayToken.findUniqueOrThrow({ where: { id: sources[0] } })).updateTime).toEqual(
      before.updateTime,
    );
  });
  it.each(["legacy", "shadow"] as const)(
    "executes the original batch once in %s without extra writes or custom attempts",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const { attempt } = customConfig();
      const previews = vi.spyOn(RelayTokenCreateMutationRepository.getInstance(), "apply"),
        writes = vi.spyOn(RelayTokenCreateRepository.getInstance(), "apply");
      const result = await copied();
      expect(result).toHaveLength(2);
      expect(writes).toHaveBeenCalledTimes(2);
      expect(attempt).not.toHaveBeenCalled();
      expect(previews).toHaveBeenCalledTimes(mode === "shadow" ? 1 : 0);
      if (mode === "shadow") {
        expect(previews.mock.calls[0]![0].persist).toBe(false);
        await expect(previews.mock.results[0]!.value).resolves.toEqual({});
      }
    },
  );
  it("uses role-only policies and rolls back if the AssumeRole session is revoked at the last response", async () => {
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
    const principal = { type: "role", id: role.id };
    for (const action of ["DuplicateToken", "CreateToken"])
      await grant("quyan:relay:" + action, control(), "Allow", principal);
    for (const source of sources)
      for (const action of ["DuplicateToken", "GetToken"])
        await grant("quyan:relay:" + action, own(source), "Allow", principal);
    for (const target of ids)
      for (const action of ["CreateToken", "GetToken"])
        await grant("quyan:relay:" + action, own(target), "Allow", principal);
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow", principal);
    const responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    let count = 0;
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      if (++count === 2) await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(copied(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("requires OAuth CREATE and READ in both the live application and token", async () => {
    await expect(copied(undefined, await oauthRequest([Permission.RELAY_TOKEN_CREATE]))).rejects.toMatchObject({
      statusCode: 403,
    });
    await absentAll();
  });
  it.each(
    [[], ["../id"], ["same", "same"], Array.from({ length: 201 }, (_, index) => "id-" + index)].map((values) => ({
      values,
    })),
  )("rejects malformed, duplicate and oversized batches (%j)", async ({ values }) => {
    await expect(copied(values)).rejects.toMatchObject({ statusCode: 400 });
    await absentAll();
  });
  it("fails closed without request principal context in enforce mode", async () => {
    await expect(new RelayTokenService().batchDuplicateTokens(sources, actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    await absentAll();
  });
  it("supports the full 200-item copy without weakening the atomicity or authorization bounds", async () => {
    for (let index = sources.length; index < 200; index++) sources.push(await member());
    const result = await copied();
    expect(result).toHaveLength(200);
    expect(new Set(result.map((row) => row.id)).size).toBe(200);
    expect(await prisma.relayToken.count({ where: { userId: actor } })).toBe(400);
  }, 60000);
  it("records one safe batch audit without source names, credentials or upstream configuration", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    await copied();
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(
      /fixture-member|fixture-legacy|source-0|fixture-source-upstream|fixture-upstream-private/,
    );
  });
});
