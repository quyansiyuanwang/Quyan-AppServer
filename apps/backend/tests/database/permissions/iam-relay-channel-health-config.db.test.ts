import { RelayChannelHealthService } from "@/services/relay/relay-channel-health.service";
import { RelayChannelHealthConfigIamService } from "@/services/relay/relay-channel-health-config-iam.service";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelHealthConfigRepository } from "@/store/relay/relay-channel-health-config.repository";
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
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const action = "quyan:relay:UpdateChannelHealthConfig";
const config = { healthTrackingMode: "manual" as const, manualAvailability: 0.75, manualLatencyMs: 123 };
const change = (ids = channels.slice(0, 2), req = request()) =>
  RelayChannelService.getInstance().batchUpdateChannelHealthConfig({ ...config, ids }, actor, req);
const single = (id = channels[0]!, req = request()) =>
  RelayChannelService.getInstance().updateChannelHealthConfig(id, config, actor, req);
const configs = () =>
  prisma.relayChannel.findMany({
    where: { id: { in: channels } },
    select: { id: true, routingConfig: true },
    orderBy: { id: "asc" },
  });
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  principalType = "user",
  principalId = actor,
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
  prefix = "channel-health-config-" + randomUUID();
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
describe("atomic resource-scoped channel health configuration", () => {
  it("merges only selected health settings, preserving credentials, routing, visibility and bindings", async () => {
    const before = await prisma.relayChannel.findMany({ where: { id: { in: channels } }, orderBy: { id: "asc" } });
    const bindings = await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } });
    const readHealth = vi.spyOn(RelayChannelHealthService.getInstance(), "getHealth");
    expect(await change()).toEqual({ total: 2, affected: 2 });
    expect(readHealth).not.toHaveBeenCalled();
    const after = await prisma.relayChannel.findMany({ where: { id: { in: channels } }, orderBy: { id: "asc" } });
    expect(
      after.map((row, i) => ({ ...row, updateTime: before[i]!.updateTime, routingConfig: before[i]!.routingConfig })),
    ).toEqual(before);
    expect(after.slice(0, 2).map((row) => row.routingConfig)).toEqual([
      expect.objectContaining({ ...config, timeoutMs: 8765, custom: { keep: true } }),
      expect.objectContaining({ ...config, timeoutMs: 8765, custom: { keep: true } }),
    ]);
    expect(after[2]!.routingConfig).toEqual(before[2]!.routingConfig);
    expect(await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } })).toEqual(bindings);
  });
  it("returns only a health projection for a single write, without requiring read Actions", async () => {
    await grant("quyan:relay:GetChannelHealth", "*", "Deny");
    await grant("quyan:relay:GetChannel", "*", "Deny");
    const result = await single();
    expect(result).toMatchObject({
      channelId: channels[0],
      trackingMode: "manual",
      source: "manual",
      availability: 0.75,
      averageLatencyMs: 123,
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|fixture.invalid|timeoutMs|visibilityConfig/);
  });
  it("per-resource Deny prevents every batch write before configuration is hydrated", async () => {
    const before = await configs();
    await grant(action, platformRelayChannelArn(channels[1]!));
    const apply = vi.spyOn(RelayChannelHealthConfigRepository.getInstance(), "apply");
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(apply).not.toHaveBeenCalled();
    expect(await configs()).toEqual(before);
  });
  it.each(["missing", "deleted"])("rejects a %s target atomically", async (kind) => {
    if (kind === "deleted")
      await prisma.relayChannel.update({ where: { id: channels[1] }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
    const before = await configs();
    await expect(change([channels[0]!, kind === "missing" ? "missing" : channels[1]!])).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await configs()).toEqual(before);
  });
  it("allows disabled standalone channels but rejects pool batches", async () => {
    await prisma.relayChannel.update({ where: { id: channels[0] }, data: { status: RELAY_CHANNEL_STATUS.DISABLED } });
    expect(await single()).toMatchObject({ trackingMode: "manual" });
    await prisma.relayChannel.update({ where: { id: channels[1] }, data: { channelType: "manual-proxy-pool" } });
    const before = await configs();
    await expect(change()).rejects.toMatchObject({ statusCode: 400 });
    expect(await configs()).toEqual(before);
  });
  it("enforces the persisted deployment group ceiling, not a user-added permission", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_UPDATE] } });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "foreign", "oauth"])("rejects %s authentication context", async (kind) => {
    const req = kind === "oauth" ? await oauthRequest() : request();
    if (kind === "missing") delete req.authContext;
    if (kind === "foreign") req.authContext!.accountOwnerId = foreign;
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["duplicate", "empty", "wildcard", "manual", "range"])(
    "validates %s input before authorization",
    async (kind) => {
      const input = { ...config, ids: channels.slice(0, 2) };
      if (kind === "duplicate") input.ids = [channels[0]!, channels[0]!];
      if (kind === "empty") input.ids = [];
      if (kind === "wildcard") input.ids = ["*"];
      if (kind === "manual") delete (input as Partial<typeof input>).manualLatencyMs;
      if (kind === "range") input.manualAvailability = 10;
      await expect(
        RelayChannelService.getInstance().batchUpdateChannelHealthConfig(input, actor, request()),
      ).rejects.toMatchObject({ statusCode: 400 });
    },
  );
  it("does not hydrate rich records, credential or upstream fields", async () => {
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
    await change();
    expect(rich).not.toHaveBeenCalled();
    expect(selects.length).toBeGreaterThan(0);
    const allowed = new Set([
      "id",
      "status",
      "updateTime",
      "channelType",
      "routingConfig",
      "visibilityMode",
      "visibilityConfig",
    ]);
    for (const select of selects) {
      expect(select).toBeTruthy();
      expect(Object.keys(select as object).every((key) => allowed.has(key))).toBe(true);
    }
  });
  it("rejects stale metadata before locking", async () => {
    const repo = RelayChannelHealthConfigRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: channels[0] }, data: { name: "changed" } });
      return apply(...args);
    });
    const before = await configs();
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await configs()).toEqual(before);
  });
  it.each(["policy", "request", "key", "group", "user", "config"])(
    "rolls back SQL after the response projection changes %s proof",
    async (kind) => {
      const req = request(),
        before = await configs();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const transact = prisma.$transaction.bind(prisma);
      let sawWrite = false;
      vi.spyOn(prisma, "$transaction").mockImplementation(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: object,
      ) =>
        transact(async (tx) => {
          vi.spyOn(RelayChannelHealthService.getInstance(), "getHealth").mockImplementation(async () => {
            const row = await tx.relayChannel.findUniqueOrThrow({
              where: { id: channels[0] },
              select: { routingConfig: true, updateTime: true },
            });
            sawWrite = (row.routingConfig as { healthTrackingMode?: string }).healthTrackingMode === "manual";
            if (kind === "policy")
              vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
                input.resources.map(() => ({
                  decision: "ExplicitDeny",
                  reason: "explicit-deny",
                  matchedStatements: [],
                })),
              );
            else if (kind === "request") req.authContext!.accountOwnerId = foreign;
            else if (kind === "key")
              await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
            else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
            else if (kind === "user") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
            else
              await tx.relayChannel.update({
                where: { id: channels[0] },
                data: { routingConfig: { changed: true }, updateTime: row.updateTime },
              });
            return undefined as never;
          });
          return callback(tx);
        }, options)) as typeof prisma.$transaction);
      await expect(single(channels[0], req)).rejects.toMatchObject({ statusCode: 403 });
      expect(sawWrite).toBe(true);
      expect(await configs()).toEqual(before);
    },
  );
  it("uses only the assumed role's resource grants", async () => {
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
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(action, platformRelayChannelArn(channels[0]!), "Allow", "role", role.id);
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await single(channels[0], req)).toMatchObject({ trackingMode: "manual" });
  });
  it.each(["automatic", "disabled"] as const)(
    "clears manual overrides when switching to %s",
    async (healthTrackingMode) => {
      await change();
      expect(
        await RelayChannelService.getInstance().batchUpdateChannelHealthConfig(
          { ids: channels.slice(0, 2), healthTrackingMode },
          actor,
          request(),
        ),
      ).toEqual({ total: 2, affected: 2 });
      for (const row of (await configs()).slice(0, 2))
        expect(row.routingConfig).toMatchObject({
          healthTrackingMode,
          manualAvailability: null,
          manualLatencyMs: null,
          timeoutMs: 8765,
        });
    },
  );
  it.each(["legacy", "shadow"] as const)(
    "runs the old callback once and never writes natively in %s",
    async (authorizationMode) => {
      env.security.iamAuthorizationMode = authorizationMode;
      const legacy = vi.fn(async () => ({ total: 2, affected: 2 }));
      const repo = RelayChannelHealthConfigRepository.getInstance(),
        apply = vi.spyOn(repo, "apply");
      const before = await configs();
      await RelayChannelHealthConfigIamService.getInstance().execute(
        { ...config, ids: channels.slice(0, 2) },
        actor,
        request(),
        legacy,
      );
      expect(legacy).toHaveBeenCalledTimes(1);
      expect(await configs()).toEqual(before);
      if (authorizationMode === "legacy") expect(apply).not.toHaveBeenCalled();
      else expect(apply.mock.calls[0]?.[3]).toBe(false);
    },
  );
  it("audits each successful mutation once without credential or configuration payloads", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    await change();
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/fixture-secret|fixture.invalid|timeoutMs|custom/);
    audit.mockClear();
    await grant(action, platformRelayChannelArn(channels[0]!));
    await expect(single()).rejects.toMatchObject({ statusCode: 403 });
    expect(audit).not.toHaveBeenCalled();
  });
  it("rolls back an earlier write when a later optimistic update fails", async () => {
    const before = await configs(),
      transact = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      transact(async (tx) => {
        const update = tx.relayChannel.updateMany.bind(tx.relayChannel);
        let count = 0;
        vi.spyOn(tx.relayChannel, "updateMany").mockImplementation((args) =>
          ++count === 2 ? (Promise.resolve({ count: 0 }) as never) : update(args),
        );
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await configs()).toEqual(before);
  });
  it("rechecks role-session revocation before returning the write response", async () => {
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
    await grant(action, platformRelayChannelArn(channels[0]!), "Allow", "role", role.id);
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    const before = await configs(),
      transact = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      transact(async (tx) => {
        vi.spyOn(RelayChannelHealthService.getInstance(), "getHealth").mockImplementation(async () => {
          await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
          return undefined as never;
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await expect(single(channels[0], req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await configs()).toEqual(before);
  });
  it.each([[], "malformed", 123])(
    "rejects non-object routing configuration %j without overwriting it",
    async (routingConfig) => {
      await prisma.relayChannel.update({ where: { id: channels[0] }, data: { routingConfig } });
      const before = await configs();
      await expect(change()).rejects.toMatchObject({ statusCode: 403 });
      expect(await configs()).toEqual(before);
    },
  );
  it("does not accept a missing request in enforce or shadow mode", async () => {
    await expect(
      RelayChannelService.getInstance().updateChannelHealthConfig(channels[0]!, config, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "shadow";
    await expect(
      RelayChannelService.getInstance().batchUpdateChannelHealthConfig({ ...config, ids: channels.slice(0, 2) }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
