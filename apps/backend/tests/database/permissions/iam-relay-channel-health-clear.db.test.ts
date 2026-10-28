import logger from "@/util/logger";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RelayChannelHealthService } from "@/services/relay/relay-channel-health.service";
import { RelayChannelHealthClearIamService } from "@/services/relay/relay-channel-health-clear-iam.service";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelHealthClearRepository } from "@/store/relay/relay-channel-health-clear.repository";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, foreign: string, groupId: string, channels: string[], tokenId: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {
      "x-action": "fake:*",
      authorization: "Bearer fixture-token-never-log",
      "user-agent": "fixture-sensitive-agent",
      "x-request-id": "fixture-untrusted-request-id",
    },
    res: { locals: { requestId: "fixture-server-request-id" } },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const action = "quyan:relay:ClearChannelHealth";
const clear = (ids = channels.slice(0, 2), req = request()) =>
  RelayChannelService.getInstance().batchClearChannelHealth(ids, actor, req);
const single = (id = channels[0]!, req = request()) =>
  RelayChannelService.getInstance().clearChannelHealth(id, actor, req);
const health = RelayChannelHealthService.getInstance();
const samples = async () => Promise.all(channels.map(async (id) => (await health.getHealth(id)).sampleCount));
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  principalType = "user",
  principalId = actor,
  Condition?: IamCondition,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect, Action, Resource, ...(Condition ? { Condition } : {}) },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function oauthRequest(scopes: string[] = [Permission.RELAY_CHANNEL_UPDATE]) {
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
  prefix = "channel-health-clear-" + randomUUID();
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
  foreign = await user();
  groupId = (
    await prisma.group.create({
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_UPDATE] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channels = [];
  for (let i = 0; i < 3; i++)
    channels.push(
      (
        await prisma.relayChannel.create({
          data: {
            name: prefix + i,
            openaiUpstreamApiKey: "fixture-secret-channel-key",
            openaiUpstreamUrl: "https://fixture.invalid",
            visibilityMode: i === 1 ? "hidden" : "public",
            routingConfig: { timeoutMs: 8765, custom: { keep: true } },
          },
        })
      ).id,
    );
  tokenId = (
    await prisma.relayToken.create({
      data: { userId: actor, token: "fixture-token-" + randomUUID(), channelId: channels[0] },
    })
  ).id;
  await prisma.relayTokenChannelConfig.create({
    data: { relayTokenId: tokenId, channelId: channels[1]!, priority: 0 },
  });
});
beforeEach(async () => {
  for (const channelId of channels)
    await health.recordAttempt({ channelId, requestId: randomUUID(), success: true, observedAt: new Date() });
  expect(await samples()).toEqual([1, 1, 1]); // Prove the isolated Redis service, not just an empty fallback, is used.
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayToken.deleteMany({ where: { userId: actor } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channels } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource-scoped irreversible channel health clearing", () => {
  it("clears all admitted targets once without changing any SQL channel/configuration/token data", async () => {
    const rows = await prisma.relayChannel.findMany({ where: { id: { in: channels } }, orderBy: { id: "asc" } });
    const bindings = await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } });
    const effect = vi.spyOn(health, "clearHealthMany"),
      del = vi.spyOn(RedisService.getInstance(), "deleteMany");
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    expect(await clear()).toEqual({ total: 2, affected: 2 });
    expect(await samples()).toEqual([0, 0, 1]);
    expect(effect).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledOnce();
    expect(effect).toHaveBeenCalledWith(channels.slice(0, 2));
    expect(await prisma.relayChannel.findMany({ where: { id: { in: channels } }, orderBy: { id: "asc" } })).toEqual(
      rows,
    );
    expect(await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } })).toEqual(bindings);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]![0]).toMatchObject({
      success: true,
      requestId: "fixture-server-request-id",
      metadata: { ids: channels.slice(0, 2), externalEffect: "confirmed", requestAccepted: true },
    });
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(
      /fixture-secret|fixture.invalid|fixture-token-never-log|fixture-sensitive-agent|fixture-untrusted-request-id|timeoutMs/,
    );
  });
  it("requires only clear authority, not health-read or configuration-update Actions", async () => {
    for (const read of ["GetChannelHealth", "GetChannel", "UpdateChannelHealthConfig"])
      await grant("quyan:relay:" + read, "*");
    expect(await single()).toBeUndefined();
    expect(await samples()).toEqual([0, 1, 1]);
  });
  it.each(["resource-deny", "permission-remove"])("rejects %s before any Redis or rich channel read", async (kind) => {
    if (kind === "resource-deny") await grant(action, platformRelayChannelArn(channels[1]!));
    else
      await prisma.user.update({
        where: { id: actor },
        data: { permissionRemoves: [Permission.RELAY_CHANNEL_UPDATE] },
      });
    const effect = vi.spyOn(health, "clearHealthMany"),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
    expect(effect).not.toHaveBeenCalled();
    expect(rich).not.toHaveBeenCalled();
    expect(await samples()).toEqual([1, 1, 1]);
  });
  it.each(["missing", "deleted"])("rejects a %s target without clearing the allowed targets", async (kind) => {
    if (kind === "deleted")
      await prisma.relayChannel.update({ where: { id: channels[1] }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
    const effect = vi.spyOn(health, "clearHealthMany");
    await expect(clear([channels[0]!, kind === "missing" ? "missing" : channels[1]!])).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "permission.insufficientPermission",
    });
    expect(effect).not.toHaveBeenCalled();
    expect(await samples()).toEqual([1, 1, 1]);
  });
  it("rejects pool targets before clearing and accepts disabled standalone targets", async () => {
    await prisma.relayChannel.update({ where: { id: channels[1] }, data: { channelType: "automatic-proxy-pool" } });
    const effect = vi.spyOn(health, "clearHealthMany");
    await expect(clear()).rejects.toMatchObject({ statusCode: 400 });
    expect(effect).not.toHaveBeenCalled();
    await prisma.relayChannel.update({
      where: { id: channels[0] },
      data: { status: RELAY_CHANNEL_STATUS.DISABLED, providerServiceEnabled: false },
    });
    await single();
    expect(await samples()).toEqual([0, 1, 1]);
  });
  it.each(["account-group", "user-add"])("cannot manufacture platform qualification from %s", async (kind) => {
    if (kind === "account-group")
      await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_UPDATE] } });
    }
    const effect = vi.spyOn(health, "clearHealthMany");
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(["missing", "foreign", "oauth"])("rejects %s context before Redis", async (kind) => {
    const req = kind === "oauth" ? await oauthRequest() : request();
    if (kind === "missing") delete req.authContext;
    if (kind === "foreign") req.authContext!.accountOwnerId = foreign;
    const effect = vi.spyOn(health, "clearHealthMany");
    await expect(clear(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(effect).not.toHaveBeenCalled();
  });
  it.each([{ ids: [] }, { ids: ["*"] }, { ids: ["invalid/arn"] }, { ids: ["same", "same"] }])(
    "validates $ids before any Redis operation",
    async ({ ids }) => {
      const effect = vi.spyOn(health, "clearHealthMany");
      await expect(clear(ids)).rejects.toMatchObject({ statusCode: 400 });
      expect(effect).not.toHaveBeenCalled();
    },
  );
  it("does not hydrate routing configuration, credential, URL, name or provider fields", async () => {
    const selects: unknown[] = [],
      transact = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      transact(async (tx) => {
        const read = tx.relayChannel.findMany.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
          selects.push(args?.select);
          return read(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
    await clear();
    expect(rich).not.toHaveBeenCalled();
    expect(selects.length).toBeGreaterThan(0);
    const allowed = new Set(["id", "status", "updateTime", "channelType", "visibilityMode", "visibilityConfig"]);
    for (const select of selects) {
      expect(select).toBeTruthy();
      expect(Object.keys(select as object).every((key) => allowed.has(key))).toBe(true);
    }
  });
  it("rejects stale target metadata before external admission", async () => {
    const repo = RelayChannelHealthClearRepository.getInstance(),
      admission = repo.withAdmission.bind(repo);
    vi.spyOn(repo, "withAdmission").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: channels[0] }, data: { name: "changed" } });
      return admission(...args);
    });
    const effect = vi.spyOn(health, "clearHealthMany");
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(["request", "key", "group", "actor", "owner", "mode", "condition", "target"])(
    "fails %s proof changed before the effect without touching Redis",
    async (kind) => {
      const req = request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      if (kind === "condition")
        await grant(action, "*", "Deny", "user", actor, { Bool: { "acs:SecureTransport": false } });
      const repo = RelayChannelHealthClearRepository.getInstance(),
        candidates = repo.candidates.bind(repo);
      let changed = false;
      vi.spyOn(repo, "candidates").mockImplementation(async (ids, tx) => {
        const rows = await candidates(ids, tx);
        if (tx && !changed) {
          changed = true;
          if (kind === "request") req.authContext!.accountOwnerId = foreign;
          else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
          else if (kind === "actor" || kind === "owner")
            await tx.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
          else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
          else if (kind === "condition") Object.defineProperty(req, "secure", { value: false });
          else
            await tx.relayChannel.update({
              where: { id: channels[0] },
              data: { channelType: "pooled", updateTime: rows.find((row) => row.id === channels[0])!.updateTime },
            });
        }
        return rows;
      });
      const effect = vi.spyOn(health, "clearHealthMany"),
        audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
      await expect(clear(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(changed).toBe(true);
      expect(effect).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
      expect(await samples()).toEqual([1, 1, 1]);
    },
  );
  it.each(["request", "policy", "key", "group", "visibility", "mode"])(
    "records the confirmed effect despite a final %s denial; SQL rollback does not restore Redis",
    async (kind) => {
      const req = request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const transact = prisma.$transaction.bind(prisma),
        clearMany = health.clearHealthMany.bind(health);
      vi.spyOn(prisma, "$transaction").mockImplementation(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: object,
      ) =>
        transact(async (tx) => {
          vi.spyOn(health, "clearHealthMany").mockImplementation(async (ids) => {
            const cleared = await clearMany(ids);
            if (kind === "request") req.authContext!.accountOwnerId = foreign;
            else if (kind === "policy")
              vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
                input.resources.map(() => ({
                  decision: "ExplicitDeny",
                  reason: "explicit-deny",
                  matchedStatements: [],
                })),
              );
            else if (kind === "key")
              await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
            else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
            else if (kind === "visibility") {
              const old = await tx.relayChannel.findUniqueOrThrow({
                where: { id: channels[0] },
                select: { updateTime: true },
              });
              await tx.relayChannel.update({
                where: { id: channels[0] },
                data: { visibilityMode: "private", updateTime: old.updateTime },
              });
            } else env.security.iamAuthorizationMode = "legacy";
            return cleared;
          });
          return callback(tx);
        }, options)) as typeof prisma.$transaction);
      const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation"),
        del = vi.spyOn(RedisService.getInstance(), "deleteMany");
      await expect(clear(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(await samples()).toEqual([0, 0, 1]);
      expect(del).toHaveBeenCalledOnce();
      expect(audit).toHaveBeenCalledOnce();
      expect(audit.mock.calls[0]![0]).toMatchObject({
        success: false,
        metadata: { externalEffect: "confirmed", requestAccepted: false },
      });
    },
  );
  it.each(["applied-reply-lost", "unavailable", "throw"])(
    "audits %s as uncertain and never retries Redis",
    async (kind) => {
      const redis = RedisService.getInstance(),
        actual = redis.deleteMany.bind(redis);
      const del = vi.spyOn(redis, "deleteMany").mockImplementation(async (keys) => {
        if (kind === "applied-reply-lost") {
          await actual(keys);
          return null;
        }
        if (kind === "throw") throw new Error("fixture-secret-do-not-log");
        return null;
      });
      const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
      await expect(clear()).rejects.toMatchObject({
        statusCode: 400,
        messageKey: "relayChannel.healthStorageUnavailable",
      });
      expect(del).toHaveBeenCalledOnce();
      expect(audit).toHaveBeenCalledOnce();
      expect(await samples()).toEqual(kind === "applied-reply-lost" ? [0, 0, 1] : [1, 1, 1]);
      expect(audit.mock.calls[0]![0]).toMatchObject({
        success: false,
        metadata: { externalEffect: "uncertain", requestAccepted: false },
      });
      expect(JSON.stringify(audit.mock.calls)).not.toContain("fixture-secret-do-not-log");
    },
  );
  it("uses only role-scoped grants and detects a revoked session before clear", async () => {
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
    const effect = vi.spyOn(health, "clearHealthMany");
    await expect(clear(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(effect).not.toHaveBeenCalled();
    await grant(action, platformRelayChannelArn(channels[0]!), "Allow", "role", role.id);
    await expect(clear(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await single(channels[0], req);
    expect(await samples()).toEqual([0, 1, 1]);
    effect.mockClear();
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(single(channels[0], req)).rejects.toMatchObject({ statusCode: 403 });
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "%s runs the old batch effect once, not once per observation",
    async (authorizationMode) => {
      env.security.iamAuthorizationMode = authorizationMode;
      const effect = vi.spyOn(health, "clearHealthMany"),
        native = vi.spyOn(RelayChannelHealthClearRepository.getInstance(), "withAdmission");
      expect(await clear()).toEqual({ total: 2, affected: 2 });
      expect(effect).toHaveBeenCalledOnce();
      if (authorizationMode === "legacy") expect(native).not.toHaveBeenCalled();
      else expect(native.mock.calls[0]?.[2]).toBeUndefined();
      expect(await samples()).toEqual([0, 0, 1]);
    },
  );
  it("shadow denial still executes exactly one old business callback", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await grant(action, "*");
    const legacy = vi.fn(async () => ({ total: 2, affected: 2 }));
    const effect = vi.spyOn(health, "clearHealthMany");
    expect(
      await RelayChannelHealthClearIamService.getInstance().execute(
        { ids: channels.slice(0, 2) },
        actor,
        request(),
        legacy,
      ),
    ).toEqual({ total: 2, affected: 2 });
    expect(legacy).toHaveBeenCalledOnce();
    expect(effect).not.toHaveBeenCalled();
    expect(await samples()).toEqual([1, 1, 1]);
  });
  it("rejects missing requests in enforce and shadow modes", async () => {
    await expect(RelayChannelService.getInstance().clearChannelHealth(channels[0]!, actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "shadow";
    await expect(
      RelayChannelService.getInstance().batchClearChannelHealth(channels.slice(0, 2), actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("records redacted admission before Redis and an independent confirmed outcome afterward", async () => {
    const log = vi.spyOn(logger, "info");
    const calls = () => log.mock.calls as unknown as [string, Record<string, unknown>][];
    const actual = health.clearHealthMany.bind(health);
    vi.spyOn(health, "clearHealthMany").mockImplementation(async (ids) => {
      const entries = calls().filter(([message]) => message === "Channel health clear admitted");
      expect(entries).toHaveLength(1);
      expect(entries[0]![1]).toMatchObject({
        externalEffect: "uncertain",
        requestAccepted: false,
        requestId: "fixture-server-request-id",
      });
      return actual(ids);
    });
    await clear();
    const entries = calls().filter(([message]) => String(message).startsWith("Channel health clear "));
    expect(entries).toHaveLength(2);
    expect(entries[1]![1]).toMatchObject({ externalEffect: "confirmed", requestAccepted: true });
    for (const [, details] of entries) {
      expect(details).toHaveProperty(
        "resourceHashes",
        expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]),
      );
      expect(JSON.stringify(details)).not.toMatch(
        /fixture-secret|fixture.invalid|fixture-token-never-log|fixture-sensitive-agent|timeoutMs|"ids"/,
      );
    }
  });
  it.each(["before", "after"])("detects a role session revoked %s the irreversible effect", async (when) => {
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
    await grant(action, "*", "Allow", "role", role.id);
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    const transact = prisma.$transaction.bind(prisma),
      actual = health.clearHealthMany.bind(health);
    let changed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      transact(async (tx) => {
        if (when === "before") {
          const repo = RelayChannelHealthClearRepository.getInstance(),
            candidates = repo.candidates.bind(repo);
          vi.spyOn(repo, "candidates").mockImplementation(async (ids, client) => {
            const rows = await candidates(ids, client);
            if (client && !changed) {
              changed = true;
              await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
            }
            return rows;
          });
        } else
          vi.spyOn(health, "clearHealthMany").mockImplementation(async (ids) => {
            const result = await actual(ids);
            changed = true;
            await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
            return result;
          });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    await expect(clear(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await samples()).toEqual(when === "before" ? [1, 1, 1] : [0, 0, 1]);
    if (when === "before") expect(audit).not.toHaveBeenCalled();
    else
      expect(audit.mock.calls[0]![0]).toMatchObject({
        success: false,
        metadata: { externalEffect: "confirmed", requestAccepted: false },
      });
  });
  it("does not turn an audit sink failure into a retry of the irreversible operation", async () => {
    vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockRejectedValueOnce(
      new Error("fixture-audit-unavailable"),
    );
    const effect = vi.spyOn(health, "clearHealthMany");
    expect(await clear()).toEqual({ total: 2, affected: 2 });
    expect(effect).toHaveBeenCalledOnce();
    expect(await samples()).toEqual([0, 0, 1]);
  });
});
