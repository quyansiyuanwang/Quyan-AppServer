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
import type { CreateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import type { TypedRequest } from "@/types/express";

let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  id: string,
  prefix: string,
  channels: string[];
const originalMode = env.security.iamAuthorizationMode;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const create = (data: Partial<CreateRelayTokenDto> = {}, req: TypedRequest | undefined = request()) =>
  new RelayTokenService().generateToken(actor, { channelId: channels[0], ...data }, req);
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
  prefix = "token-create-" + randomUUID();
  id = randomUUID().replaceAll("-", "");
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
  vi.spyOn(
    RelayTokenCreateIamService.getInstance() as unknown as { allocateId: () => string },
    "allocateId",
  ).mockReturnValue(id);
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

describe("atomic native resource-authorized token creation", () => {
  it("creates complete ordered configuration and returns an authorized projection without legacy rich reads", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "create"),
      read = vi.spyOn(RelayTokenService.prototype, "getToken");
    const result = await create({
      name: "  created  ",
      channelConfigs: [
        { channelId: channels[1]!, priority: 8 },
        { channelId: channels[0]!, priority: 2 },
      ],
      quotaLimit: 0,
      quotaWindows: [{ quotaLimit: 2, quotaUnit: "request", quotaWindowHours: 1 }],
      allowedModels: "  a,b  ",
      ipWhitelist: "127.0.0.1",
      modelMapping: { a: "b" },
      streamConfig: { preflightBufferLimitBytes: 512 * 1024 },
      failoverConfig: {
        enabled: false,
        maxRetries: 0,
        retryStatusCodes: [],
        failoverThreshold: 0,
        failbackCooldownMinutes: 0,
      },
    });
    expect(result).toMatchObject({ id, userId: actor, name: "created", channelId: channels[0], allowedModels: "a,b" });
    expect(result.token).toBeTruthy();
    expect(rich).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    const stored = await prisma.relayToken.findUniqueOrThrow({
      where: { id },
      include: { channelConfigs: { orderBy: { priority: "asc" } }, quotaWindows: true, failoverConfig: true },
    });
    expect(stored.channelConfigs.map(({ channelId, priority }) => ({ channelId, priority }))).toEqual([
      { channelId: channels[0], priority: 0 },
      { channelId: channels[1], priority: 1 },
    ]);
    expect(Number(stored.quotaLimit)).toBe(0);
    expect(Number(stored.quotaWindows[0]!.quotaLimit)).toBe(2);
    expect(stored.failoverConfig).toMatchObject({ enabled: false, maxRetries: 0 });
    expect(stored.normalizerConfig).toMatchObject({ enabled: false, v1PathMode: "auto" });
    expect(stored.modelMapping).toEqual({ a: "b" });
  });
  it.each(["CreateToken", "GetToken", "SelectTokenChannel"])(
    "does not insert when independent %s is denied",
    async (operation) => {
      await grant(
        "quyan:relay:" + operation,
        operation === "SelectTokenChannel" ? relayChannelSelectionArn(owner, channels[0]!) : own(),
      );
      await expect(create()).rejects.toMatchObject({ statusCode: 403 });
      await absent();
    },
  );
  it("requires create collection scope as well as the server-allocated resource", async () => {
    await grant("quyan:relay:CreateToken", control());
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it("uses exact JSON-only grants without a legacy UPDATE or broad creation permission", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant("quyan:relay:CreateToken", control(), "Allow");
    await grant("quyan:relay:CreateToken", own(), "Allow");
    await grant("quyan:relay:GetToken", own(), "Allow");
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow");
    const req = request(),
      result = await create({}, req);
    expect(result.id).toBe(id);
    expect(result.token).toBeUndefined();
    expect(
      req.iamDecisions?.some(
        (decision) => decision.action === "quyan:relay:CreateToken" && decision.resource === own(),
      ),
    ).toBe(true);
    expect(
      req.iamDecisions?.some(
        (decision) => decision.action === "fake:*" || decision.action === "quyan:relay:UpdateToken",
      ),
    ).toBe(false);
  });
  it("does not read credential columns when Reveal is denied", async () => {
    await grant("quyan:relay:RevealToken", own());
    const responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const selects = vi.spyOn(tx.relayToken, "findFirst");
      try {
        const result = await read(tx, ...args);
        for (const [arg] of selects.mock.calls) {
          expect(arg?.select).not.toHaveProperty("token");
          expect(arg?.select).not.toHaveProperty("legacyToken");
          expect(arg?.select).not.toHaveProperty("upstreamApiKey");
        }
        return result;
      } finally {
        selects.mockRestore();
      }
    });
    expect((await create()).token).toBeUndefined();
    expect(await prisma.relayToken.count({ where: { id } })).toBe(1);
  });
  it("checks every selected ordered fallback and persisted business visibility", async () => {
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[1]!));
    await expect(
      create({
        channelConfigs: [
          { channelId: channels[0]!, priority: 0 },
          { channelId: channels[1]!, priority: 1 },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it.each(["disabled", "hidden", "provider-disabled"])(
    "refuses a %s channel even when the policy permits it",
    async (kind) => {
      await prisma.relayChannel.update({
        where: { id: channels[0] },
        data:
          kind === "disabled"
            ? { status: 0 }
            : kind === "hidden"
              ? { visibilityMode: "hidden" }
              : { providerServiceEnabled: false },
      });
      await expect(create()).rejects.toMatchObject({ statusCode: 403 });
      await absent();
    },
  );
  it("creates automatic routing and keeps the full allowed paths of its effective topology", async () => {
    const pool = await automatic();
    const result = await create({
      channelId: undefined,
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: pool,
      blockedAutomaticProxyPoolChannelIds: [channels[0]!],
    });
    expect(result.id).toBe(id);
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: pool,
      channelId: null,
      blockedAutomaticProxyPoolChannelIds: [channels[0]],
    });
  });
  it("does not inspect inaccessible automatic-pool member validation before authorizing its root", async () => {
    const pool = await automatic();
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, pool));
    await expect(
      create({
        channelId: undefined,
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: ["not-a-member"],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it("rejects automatic-pool blocks that eliminate every usable path", async () => {
    const pool = await automatic();
    await expect(
      create({
        channelId: undefined,
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: pool,
        blockedAutomaticProxyPoolChannelIds: channels.slice(0, 2),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await absent();
  });
  it("creates composite tokens including disabled members with independent reference and read proofs", async () => {
    const leaf = await member();
    const result = await create({
      channelId: undefined,
      routingMode: "composite",
      memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: false }],
    });
    expect(result.id).toBe(id);
    expect(await prisma.relayTokenMemberConfig.findMany({ where: { parentTokenId: id } })).toMatchObject([
      { tokenId: leaf, enabled: false },
    ]);
  });
  it.each(["ReferenceToken", "GetToken"])(
    "checks %s across the entire composite subtree, not just directly named children",
    async (operation) => {
      const leaf = await member(),
        child = await member(actor, [leaf]);
      await grant("quyan:relay:" + operation, own(leaf));
      await expect(
        create({
          channelId: undefined,
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId: child, priority: 0, enabled: true }],
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await absent();
    },
  );
  it("rejects foreign-owner references and server-reserved self references", async () => {
    const leaf = await member(peer);
    for (const tokenId of [leaf, id]) {
      await expect(
        create({
          channelId: undefined,
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId, priority: 0, enabled: false }],
        }),
      ).rejects.toThrow();
      await absent();
    }
  });
  it("preserves the fail-closed Redis composition lock", async () => {
    const leaf = await member(),
      writes = vi.spyOn(RelayTokenCreateRepository.getInstance(), "apply");
    const lock = vi
      .spyOn(DistributedLockService.getInstance(), "runWithLock")
      .mockRejectedValue(new Error("fixture graph lock unavailable"));
    await expect(
      create({
        channelId: undefined,
        routingMode: "composite",
        memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: true }],
      }),
    ).rejects.toThrow("fixture graph lock unavailable");
    expect(lock).toHaveBeenCalledWith(
      DistributedLockService.buildKey("relay-composition", actor),
      expect.any(Function),
      { failClosed: true },
    );
    expect(writes).not.toHaveBeenCalled();
    await absent();
  });
  it("requires independently authorized custom credentials and enforces configured quota/rate", async () => {
    const { attempt } = customConfig();
    await permissions(true);
    const preferred = getCredentialPrefix("relayToken") + "custom-" + randomUUID(),
      result = await create({ token: preferred });
    expect(result.token).toBe(preferred);
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({
      isCustomKey: true,
      legacyToken: null,
    });
    expect(attempt).toHaveBeenCalledOnce();
  });
  it.each(["SetTokenCredential", "RevealToken"])(
    "does not let a caller-known custom value bypass independent %s denial",
    async (operation) => {
      customConfig();
      await permissions(true);
      await grant("quyan:relay:" + operation, own());
      await expect(
        create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await absent();
    },
  );
  it("does not treat ordinary token creation as permission to set credentials", async () => {
    customConfig();
    await expect(create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toMatchObject(
      { statusCode: 403 },
    );
    await absent();
  });
  it("does not exceed custom credential limits when a new token is created", async () => {
    customConfig();
    await permissions(true);
    const existing = await member();
    await prisma.relayToken.update({ where: { id: existing }, data: { isCustomKey: true } });
    await expect(create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await absent();
  });
  it("uses a generated replacement without adopting another token's occupied alias", async () => {
    customConfig();
    await permissions(true);
    const existing = await member(peer),
      preferred = getCredentialPrefix("relayToken") + "occupied-" + randomUUID();
    await prisma.relayToken.update({ where: { id: existing }, data: { token: preferred } });
    const result = await create({ token: preferred });
    expect(result.token).not.toBe(preferred);
    expect(result.token).toBeTruthy();
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({ legacyToken: null });
  });
  it("allows independently granted free-limit bypass without consulting ordinary limits", async () => {
    const { config, attempt } = customConfig();
    await permissions(false, true);
    config.mockResolvedValue({
      enabled: false,
      maxTokensPerUser: 0,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 0,
    });
    expect((await create({ token: getCredentialPrefix("relayToken") + "free-" + randomUUID() })).id).toBe(id);
    expect(attempt).not.toHaveBeenCalled();
  });
  it("does not implicitly bypass custom limits for a managed target", async () => {
    const { attempt } = customConfig();
    await permissions(true, false, true);
    const existing = await member(peer);
    await prisma.relayToken.update({ where: { id: existing }, data: { isCustomKey: true } });
    await expect(
      create({ targetUserId: peer, token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(attempt).not.toHaveBeenCalled();
    await absent();
  });
  it("requires qualified platform creation and response authority for a different owner", async () => {
    await expect(create({ targetUserId: peer })).rejects.toMatchObject({ statusCode: 403 });
    await permissions(false, false, true);
    await grant("quyan:relay:CreateManagedToken", platformRelayTokenArn(peer, id));
    await expect(create({ targetUserId: peer })).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it("permits qualified managed creation only into the requested live target", async () => {
    await permissions(false, false, true);
    const result = await create({ targetUserId: peer });
    expect(result.userId).toBe(peer);
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({ userId: peer });
  });
  it.each(["policy", "request", "key", "oauth", "selection", "source", "config"])(
    "rolls back an executed INSERT if %s changes during response projection",
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
      vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
        const result = await read(tx, ...args);
        if (kind === "policy") vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
        else if (kind === "request") req.authContext!.accountOwnerId = foreign;
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "oauth")
          await tx.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { scopes: [] } });
        else if (kind === "selection")
          await tx.relayChannel.update({ where: { id: channels[0] }, data: { visibilityMode: "hidden" } });
        else if (kind === "source") await tx.relayToken.update({ where: { id }, data: { channelId: channels[1] } });
        else
          config.mockResolvedValue({
            enabled: false,
            maxTokensPerUser: 1,
            createLimitWindowMinutes: 1,
            createLimitMaxCount: 10,
          });
        return result;
      });
      await expect(
        create(kind === "config" ? { token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() } : {}, req),
      ).rejects.toMatchObject({ statusCode: 403 });
      await absent();
    },
  );
  it("rolls back a composite creation if a protected descendant is withdrawn after insertion", async () => {
    const leaf = await member(),
      responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      await tx.relayToken.update({ where: { id: leaf }, data: { status: -1 } });
      return result;
    });
    await expect(
      create({
        channelId: undefined,
        routingMode: "composite",
        memberTokenConfigs: [{ tokenId: leaf, priority: 0, enabled: true }],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it("uses role-only grants and aborts if the active role session is revoked after insertion", async () => {
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
    await expect(create({}, req)).rejects.toMatchObject({ statusCode: 403 });
    for (const resource of [control(), own()])
      await grant("quyan:relay:CreateToken", resource, "Allow", { type: "role", id: role.id });
    await grant("quyan:relay:GetToken", own(), "Allow", { type: "role", id: role.id });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!), "Allow", {
      type: "role",
      id: role.id,
    });
    const responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(create({}, req)).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it("rechecks actual OAuth creation and response scopes rather than trusting cached request scopes", async () => {
    const req = await oauthRequest([Permission.RELAY_TOKEN_CREATE]);
    await expect(create({}, req)).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it.each(["legacy", "shadow"] as const)(
    "creates exactly once in %s and shadow preview consumes no credential attempts",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const { attempt } = customConfig();
      await permissions(true);
      const previews = vi.spyOn(RelayTokenCreateMutationRepository.getInstance(), "apply");
      const writes = vi.spyOn(RelayTokenCreateRepository.getInstance(), "apply"),
        result = await create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() });
      expect(result.id).toBeTruthy();
      expect(writes).toHaveBeenCalledOnce();
      expect(attempt).toHaveBeenCalledOnce();
      expect(previews).toHaveBeenCalledTimes(mode === "shadow" ? 1 : 0);
      if (mode === "shadow") {
        expect(previews.mock.calls[0]![0].persist).toBe(false);
        await expect(previews.mock.results[0]!.value).resolves.toEqual({});
      }
    },
  );
  it("ignores a client-supplied resource ID and snapshots input before asynchronous policy reads", async () => {
    const data = { channelId: channels[0]!, name: "original", id: "client-chosen", action: "fake:*" };
    const iam = IamAuthorizationService.getInstance(),
      load = iam.loadPolicies.bind(iam);
    let changed = false;
    vi.spyOn(iam, "loadPolicies").mockImplementation(async (...args) => {
      if (!changed) {
        changed = true;
        data.name = "mutated";
        data.channelId = channels[1]!;
      }
      return load(...args);
    });
    const result = await new RelayTokenService().generateToken(actor, data, request());
    expect(result).toMatchObject({ id, name: "original", channelId: channels[0] });
    expect(await prisma.relayToken.count({ where: { id: "client-chosen" } })).toBe(0);
  });
  it("canonicalizes a legacy custom credential without retaining an unrequested alias", async () => {
    await permissions(false, true);
    const preferred = "rlt_" + randomUUID().replaceAll("-", "");
    const result = await create({ token: preferred });
    expect(result.token).toBe(getCredentialPrefix("relayToken") + preferred.slice(4));
    expect(await prisma.relayToken.findUnique({ where: { id } })).toMatchObject({
      legacyToken: null,
      isCustomKey: true,
    });
  });
  it("does not write when the current custom-credential switch is disabled", async () => {
    const { config, attempt } = customConfig();
    await permissions(true);
    config.mockResolvedValue({
      enabled: false,
      maxTokensPerUser: 1,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 10,
    });
    await expect(create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(attempt).not.toHaveBeenCalled();
    await absent();
  });
  it("fails closed if custom-credential rate storage is unavailable", async () => {
    customConfig();
    await permissions(true);
    vi.spyOn(RateLimiterService.getInstance(), "markBackoffRateLimitFailure").mockRejectedValue(
      new Error("fixture rate storage unavailable"),
    );
    await expect(create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() })).rejects.toThrow(
      "fixture rate storage unavailable",
    );
    await absent();
  });
  it("does not use a FREE group grant to bypass a narrower OAuth credential scope", async () => {
    const { config, attempt } = customConfig();
    await permissions(false, true);
    config.mockResolvedValue({
      enabled: false,
      maxTokensPerUser: 1,
      createLimitWindowMinutes: 1,
      createLimitMaxCount: 10,
    });
    const req = await oauthRequest([
      Permission.RELAY_TOKEN_CREATE,
      Permission.RELAY_TOKEN_READ,
      Permission.RELAY_TOKEN_CUSTOM_KEY,
    ]);
    await expect(
      create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }, req),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(attempt).not.toHaveBeenCalled();
    await absent();
  });
  it("rolls back a custom insertion when the persisted credential scope is revoked before final checks", async () => {
    customConfig();
    await permissions(true);
    const req = await oauthRequest([
      Permission.RELAY_TOKEN_CREATE,
      Permission.RELAY_TOKEN_READ,
      Permission.RELAY_TOKEN_CUSTOM_KEY,
    ]);
    const responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...args) => {
      const result = await read(tx, ...args);
      await tx.oAuthAccessToken.update({
        where: { id: req.oauthAccessToken!.id },
        data: { scopes: [Permission.RELAY_TOKEN_CREATE, Permission.RELAY_TOKEN_READ] },
      });
      return result;
    });
    await expect(
      create({ token: getCredentialPrefix("relayToken") + "custom-" + randomUUID() }, req),
    ).rejects.toMatchObject({ statusCode: 403 });
    await absent();
  });
  it("preserves explicit member priorities even when the request lists composite members out of order", async () => {
    const a = await member(),
      b = await member();
    const result = await create({
      channelId: undefined,
      routingMode: "composite",
      memberTokenConfigs: [
        { tokenId: b, priority: 3, enabled: false },
        { tokenId: a, priority: 1, enabled: true },
      ],
    });
    expect(result.id).toBe(id);
    expect(
      await prisma.relayTokenMemberConfig.findMany({
        where: { parentTokenId: id },
        orderBy: { priority: "asc" },
        select: { tokenId: true, priority: true },
      }),
    ).toEqual([
      { tokenId: a, priority: 1 },
      { tokenId: b, priority: 3 },
    ]);
  });
  it("writes one safe business audit without the body, credential or upstream configuration", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation"),
      result = await create();
    expect(audit).toHaveBeenCalledOnce();
    const text = JSON.stringify(audit.mock.calls);
    expect(text).not.toContain(result.token!);
    expect(text).not.toContain("fixture-upstream-private");
    expect(text).not.toContain("legacyToken");
  });
  it("fails closed without a bound request in enforce", async () => {
    await expect(new RelayTokenService().generateToken(actor, { channelId: channels[0] })).rejects.toMatchObject({
      statusCode: 403,
    });
    await absent();
  });
});
