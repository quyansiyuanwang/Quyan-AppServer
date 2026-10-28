import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, getCredentialPrefix, buildAcsResource } from "@quyan/shared";
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
import type { RelayTokenImportItemDto } from "@/api/dto/relay/relay.dto";
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
  prefix = "token-import-" + randomUUID();
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

const imported = (
  items: Partial<RelayTokenImportItemDto>[] = [{ name: "first" }, { name: "second" }],
  req = request(),
  targetUserId?: string,
) =>
  new RelayTokenService().importTokens(
    { tokens: items.map((item) => ({ channelId: channels[0], ...item })), targetUserId },
    actor,
    req,
  );
const absentAll = async () => {
  await absent();
  expect(await prisma.relayToken.count({ where: { id: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenChannelConfig.count({ where: { relayTokenId: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenQuotaWindow.count({ where: { relayTokenId: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenMemberConfig.count({ where: { parentTokenId: { in: ids } } })).toBe(0);
  expect(await prisma.relayTokenFailoverConfig.count({ where: { relayTokenId: { in: ids } } })).toBe(0);
};
const credential = () => getCredentialPrefix("relayToken") + "custom-" + randomUUID();

describe("atomic native resource-authorized token import", () => {
  it("imports all configuration in request order without legacy rich reads or nested transactions", async () => {
    const legacyCreate = vi.spyOn(RelayTokenRepository.getInstance(), "create"),
      transactions = vi.spyOn(prisma, "$transaction");
    const result = await imported([
      {
        name: "  first  ",
        enabled: false,
        quotaLimit: 0,
        quotaWindows: [{ quotaLimit: 2, quotaUnit: "request", quotaWindowHours: 1 }],
        streamConfig: { preflightBufferLimitBytes: 512 * 1024 },
        contentSafetyConfig: { requestEnabled: false },
        modelMapping: { a: "b" },
      },
      {
        name: "second",
        channelConfigs: [
          { channelId: channels[1]!, priority: 4 },
          { channelId: channels[0]!, priority: 0 },
        ],
      },
    ]);
    expect(result).toMatchObject({ code: 0, message: "success", total: 2, created: 2 });
    expect(result.data.map((row) => row.id)).toEqual(ids);
    expect(result.data.map((row) => row.name)).toEqual(["first", "second"]);
    expect(result.data.every((row) => Boolean(row.token))).toBe(true);
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(transactions).toHaveBeenCalledOnce();
    const first = await prisma.relayToken.findUniqueOrThrow({
      where: { id },
      include: { quotaWindows: true, channelConfigs: true },
    });
    expect(first).toMatchObject({
      status: 0,
      streamConfig: { preflightBufferLimitBytes: 512 * 1024 },
      contentSafetyConfig: { requestEnabled: false },
      modelMapping: { a: "b" },
      normalizerConfig: { enabled: false, v1PathMode: "auto" },
    });
    expect(Number(first.quotaLimit)).toBe(0);
    expect(first.quotaWindows).toHaveLength(1);
    expect(
      (
        await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: ids[1] }, orderBy: { priority: "asc" } })
      ).map((row) => row.channelId),
    ).toEqual([channels[0], channels[1]]);
  });
  it.each(["ImportTokens", "CreateToken", "GetToken"])(
    "refuses the whole batch if independent %s is denied on only the final token",
    async (operation) => {
      await grant("quyan:relay:" + operation, own(ids[1]!));
      await expect(imported()).rejects.toMatchObject({ statusCode: 403 });
      await absentAll();
    },
  );
  it.each(["ImportTokens", "CreateToken"])(
    "requires %s on the caller's creation scope, not only new resources",
    async (operation) => {
      await grant("quyan:relay:" + operation, control());
      await expect(imported()).rejects.toMatchObject({ statusCode: 403 });
      await absentAll();
    },
  );
  it("allows exact JSON-only import, creation and response grants without UPDATE", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    for (const action of ["ImportTokens", "CreateToken"]) {
      await grant("quyan:relay:" + action, control(), "Allow");
      for (const target of ids) await grant("quyan:relay:" + action, own(target), "Allow");
    }
    for (const target of ids) await grant("quyan:relay:GetToken", own(target), "Allow");
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow");
    const result = await imported();
    expect(result.data.map((row) => row.id)).toEqual(ids);
    expect(result.data.every((row) => row.token === undefined)).toBe(true);
  });
  it("does not turn ordinary single-create authorization into JSON-only import authority", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    for (const resource of [control(), ...ids.map((id) => own(id))])
      await grant("quyan:relay:CreateToken", resource, "Allow");
    for (const id of ids) await grant("quyan:relay:GetToken", own(id), "Allow");
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow");
    await expect(imported()).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("can disclose only one new credential while returning authorized metadata for both", async () => {
    await grant("quyan:relay:RevealToken", own(ids[1]!));
    const result = await imported();
    expect(result.data[0]!.token).toBeTruthy();
    expect(result.data[1]!.token).toBeUndefined();
  });
  it("checks every selected fallback of every item", async () => {
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[1]!));
    await expect(
      imported([
        {},
        {
          channelConfigs: [
            { channelId: channels[0]!, priority: 0 },
            { channelId: channels[1]!, priority: 1 },
          ],
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("keeps copy-name behavior for existing and within-batch collisions, including disabled tokens", async () => {
    const existing = await member();
    await prisma.relayToken.update({ where: { id: existing }, data: { name: "same", status: 0 } });
    const result = await imported([{ name: " same " }, { name: "same" }]);
    expect(result.data.map((row) => row.name)).toEqual(["same（副本）", "same（副本2）"]);
  });
  it("uses case-sensitive collision checks and bounded suffixes without reading credential columns", async () => {
    const existing = await member();
    await prisma.relayToken.update({ where: { id: existing }, data: { name: "Name" } });
    expect((await imported([{ name: "name" }, { name: "Name" }])).data.map((row) => row.name)).toEqual([
      "name",
      "Name（副本）",
    ]);
  });
  it("retains top-level ownership and ignores per-item target, ID and action fields", async () => {
    const req = request(),
      body = {
        tokens: [
          { channelId: channels[0]!, targetUserId: foreign, id: "client-id", action: "fake:*" },
          { channelId: channels[0]!, targetUserId: peer },
        ],
        targetUserId: undefined,
      };
    const result = await new RelayTokenService().importTokens(body, actor, req);
    expect(result.data.every((row) => row.userId === actor)).toBe(true);
    expect(result.data.map((row) => row.id)).toEqual(ids);
    expect(req.iamDecisions?.some((entry) => entry.action === "fake:*")).toBe(false);
  });
  it("preserves unoccupied canonical/legacy credential aliases while preventing duplicate values in one batch", async () => {
    const { config, attempt } = customConfig();
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 3,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 10,
    });
    await permissions(true);
    const legacy = "rlt_" + randomUUID().replaceAll("-", "");
    const result = await imported([{ token: legacy }, { token: legacy }]);
    expect(result.data[0]!.token).toBe(getCredentialPrefix("relayToken") + legacy.slice(4));
    expect(result.data[1]!.token).not.toBe(result.data[0]!.token);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({
      legacyToken: legacy,
      isCustomKey: true,
    });
    expect(await prisma.relayToken.findUnique({ where: { id: ids[1] } })).toMatchObject({
      legacyToken: null,
      isCustomKey: true,
    });
  });
  it("reserves generated credentials too, even when the generator repeats a value within the batch", async () => {
    const value = credential();
    vi.spyOn(
      RelayTokenService.prototype as unknown as { generateRelayTokenValue: () => string },
      "generateRelayTokenValue",
    ).mockReturnValue(value);
    const result = await imported();
    expect(new Set(result.data.map((row) => row.token)).size).toBe(2);
    expect(result.data[0]!.token).toBe(value);
    expect(result.data[1]!.token).not.toBe(value);
    expect(await prisma.relayToken.count({ where: { id: { in: ids }, isCustomKey: true } })).toBe(0);
  });
  it("does not adopt an occupied alias or canonical value from an existing token", async () => {
    customConfig();
    await permissions(true);
    const existing = await member(peer),
      value = credential();
    await prisma.relayToken.update({ where: { id: existing }, data: { legacyToken: value } });
    const result = await imported([{ token: value }, {}]);
    expect(result.data[0]!.token).not.toBe(value);
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({ legacyToken: null });
  });
  it("reserves canonical and legacy values together across different batch aliases", async () => {
    const { config } = customConfig();
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 2,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 10,
    });
    await permissions(true);
    const legacy = "rlt_" + randomUUID().replaceAll("-", "");
    const canonical = getCredentialPrefix("relayToken") + legacy.slice(4);
    const result = await imported([{ token: legacy }, { token: canonical }]);
    expect(result.data[0]!.token).toBe(canonical);
    expect(result.data[1]!.token).not.toBe(canonical);
    expect(await prisma.relayToken.findUnique({ where: { id: ids[1] } })).toMatchObject({ legacyToken: null });
  });
  it("rejects the batch when planned custom additions exceed the live per-user quota", async () => {
    const { attempt } = customConfig();
    await permissions(true);
    await expect(imported([{ token: credential() }, { token: credential() }])).rejects.toMatchObject({
      statusCode: 400,
    });
    await absentAll();
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it("also counts pre-existing disabled custom tokens in planned quota", async () => {
    const { config } = customConfig();
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 2,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 10,
    });
    await permissions(true);
    const existing = await member();
    await prisma.relayToken.update({ where: { id: existing }, data: { isCustomKey: true, status: 0 } });
    await expect(imported([{ token: credential() }, { token: credential() }])).rejects.toMatchObject({
      statusCode: 400,
    });
    await absentAll();
  });
  it("retains independent setter and Reveal permissions on each caller-known credential", async () => {
    customConfig();
    await permissions(true);
    await grant("quyan:relay:SetTokenCredential", own(ids[1]!));
    await expect(imported([{}, { token: credential() }])).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("does not let a later credential's FREE grant change an earlier ordinary decision", async () => {
    const { config, attempt } = customConfig();
    config.mockResolvedValue({
      enabled: true,
      maxTokensPerUser: 1,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 10,
    });
    await permissions(true);
    await grant("quyan:relay:BypassTokenCredentialLimits", own(ids[1]!), "Allow");
    const result = await imported([{ token: credential() }, { token: credential() }]);
    expect(result.created).toBe(2);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it("does not erase earlier FREE additions when a later ordinary item checks its quota", async () => {
    customConfig();
    await permissions(true);
    await grant("quyan:relay:BypassTokenCredentialLimits", own(), "Allow");
    await expect(imported([{ token: credential() }, { token: credential() }])).rejects.toMatchObject({
      statusCode: 400,
    });
    await absentAll();
  });
  it("uses current persisted platform ceilings and cannot implicitly bypass quotas for a managed import", async () => {
    customConfig();
    await permissions(true, false, true);
    await expect(imported([{ token: credential() }, { token: credential() }], request(), peer)).rejects.toMatchObject({
      statusCode: 400,
    });
    await absentAll();
  });
  it("requires managed import authority for the last target token, not merely global qualification", async () => {
    await permissions(false, false, true);
    await grant("quyan:relay:ImportManagedTokens", platformRelayTokenArn(peer, ids[1]!));
    await expect(imported(undefined, request(), peer)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("imports into a live qualified target and preserves disabled status", async () => {
    await permissions(false, false, true);
    const result = await imported([{ enabled: false }, {}], request(), peer);
    expect(result.data.every((row) => row.userId === peer)).toBe(true);
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({ userId: peer, status: 0 });
  });
  it("rolls back every earlier insert when the final insert fails", async () => {
    const writer = RelayTokenCreateRepository.getInstance(),
      write = writer.apply.bind(writer);
    let count = 0;
    vi.spyOn(writer, "apply").mockImplementation(async (...args) => {
      if (++count === 2) throw new Error("fixture final insert failed");
      return write(...args);
    });
    await expect(imported()).rejects.toThrow("fixture final insert failed");
    expect(count).toBe(2);
    await absentAll();
  });
  it.each(["policy", "request", "key", "oauth", "selection", "first-source", "config"])(
    "rolls back all resources when %s changes while projecting the last response",
    async (kind) => {
      const req = kind === "oauth" ? await oauthRequest() : request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const { config } = customConfig();
      if (kind === "config") await permissions(true);
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
        else if (kind === "selection")
          await tx.relayChannel.update({ where: { id: channels[0] }, data: { visibilityMode: "hidden" } });
        else if (kind === "first-source") await tx.relayToken.update({ where: { id }, data: { isCustomKey: true } });
        else
          config.mockResolvedValue({
            enabled: false,
            maxTokensPerUser: 1,
            createLimitWindowMinutes: 1,
            createLimitMaxCount: 10,
          });
        return result;
      });
      await expect(imported(kind === "config" ? [{ token: credential() }, {}] : undefined, req)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(count).toBe(2);
      await absentAll();
    },
  );
  it("validates all automatic-pool routing and can atomically import ordered and automatic tokens", async () => {
    const pool = await automatic();
    const result = await imported([
      {},
      {
        channelId: undefined,
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: [channels[0]!],
      },
    ]);
    expect(result.created).toBe(2);
    expect(await prisma.relayToken.findUnique({ where: { id: ids[1] } })).toMatchObject({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: pool,
      channelId: null,
    });
  });
  it("does not commit another item when the automatic pool root is denied", async () => {
    const pool = await automatic();
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, pool));
    await expect(
      imported([{}, { channelId: undefined, routingMode: "automatic-pool", automaticProxyPoolChannelId: pool }]),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("checks composite descendants and holds one fail-closed graph lock for the entire batch", async () => {
    const leaf = await member(),
      child = await member(actor, [leaf]);
    await grant("quyan:relay:ReferenceToken", own(leaf));
    await expect(
      imported([
        {},
        {
          channelId: undefined,
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId: child, priority: 0, enabled: false }],
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("imports multiple composites and still rechecks the full stored graph", async () => {
    const leaf = await member();
    const result = await imported([
      {
        channelId: undefined,
        routingMode: "composite",
        memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: false }],
      },
      {
        channelId: undefined,
        routingMode: "composite",
        memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: true }],
      },
    ]);
    expect(result.created).toBe(2);
    expect(await prisma.relayTokenMemberConfig.count({ where: { parentTokenId: { in: ids } } })).toBe(2);
  });
  it("does not write any item if the distributed graph lock cannot be acquired", async () => {
    const leaf = await member();
    const lock = vi
      .spyOn(DistributedLockService.getInstance(), "runWithLock")
      .mockRejectedValue(new Error("fixture graph unavailable"));
    const writes = vi.spyOn(RelayTokenCreateRepository.getInstance(), "apply");
    await expect(
      imported([
        {},
        {
          channelId: undefined,
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: true }],
        },
      ]),
    ).rejects.toThrow("fixture graph unavailable");
    expect(lock).toHaveBeenCalledWith(
      DistributedLockService.buildKey("relay-composition", actor),
      expect.any(Function),
      { failClosed: true },
    );
    expect(writes).not.toHaveBeenCalled();
    await absentAll();
  });
  it.each(["legacy", "shadow"] as const)(
    "imports exactly one batch in %s, without extra custom attempts",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const { config, attempt } = customConfig();
      config.mockResolvedValue({
        enabled: true,
        maxTokensPerUser: 3,
        createLimitWindowMinutes: 1,
        createLimitMaxCount: 10,
      });
      await permissions(true);
      const previews = vi.spyOn(RelayTokenCreateMutationRepository.getInstance(), "apply"),
        writes = vi.spyOn(RelayTokenCreateRepository.getInstance(), "apply");
      const result = await imported([{ token: credential() }, { token: credential() }]);
      expect(result.created).toBe(2);
      expect(writes).toHaveBeenCalledTimes(2);
      expect(attempt).toHaveBeenCalledTimes(2);
      expect(previews).toHaveBeenCalledTimes(mode === "shadow" ? 1 : 0);
      if (mode === "shadow") {
        expect(previews.mock.calls[0]![0].persist).toBe(false);
        await expect(previews.mock.results[0]!.value).resolves.toEqual({});
      }
    },
  );
  it("uses role-only import grants and rolls back both inserts if the role session is revoked", async () => {
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
    for (const action of ["ImportTokens", "CreateToken"]) {
      await grant("quyan:relay:" + action, control(), "Allow", { type: "role", id: role.id });
      for (const target of ids)
        await grant("quyan:relay:" + action, own(target), "Allow", { type: "role", id: role.id });
    }
    for (const target of ids) await grant("quyan:relay:GetToken", own(target), "Allow", { type: "role", id: role.id });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow", {
      type: "role",
      id: role.id,
    });
    const responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    let count = 0;
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      if (++count === 2) await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(imported(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("rejects malformed or empty input and does not treat missing context as legacy in enforce", async () => {
    await expect(new RelayTokenService().importTokens({ tokens: [] }, actor, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      new RelayTokenService().importTokens({ tokens: [{ channelId: channels[0] }] }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absentAll();
  });
  it("imports the supported 200-item maximum atomically without quadratic batch reauthorization", async () => {
    const result = await imported(Array.from({ length: 200 }, (_, index) => ({ name: `batch-${index}` })));
    expect(result.created).toBe(200);
    expect(new Set(result.data.map((row) => row.id)).size).toBe(200);
    expect(await prisma.relayToken.count({ where: { userId: actor } })).toBe(200);
  }, 60000);
  it("records one batch audit without input credentials, aliases or upstream configuration", async () => {
    customConfig();
    await permissions(true);
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation"),
      value = credential();
    await imported([{ token: value }, {}]);
    expect(audit).toHaveBeenCalledOnce();
    const text = JSON.stringify(audit.mock.calls);
    expect(text).not.toContain(value);
    expect(text).not.toContain("fixture-upstream-private");
    expect(text).not.toContain("legacyToken");
  });
});
