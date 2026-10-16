import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { PlatformRelayChannelStatusRepository } from "@/store/relay/platform-relay-channel-status.repository";
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
const change = (ids = channels.slice(0, 2), enabled = false, req = request()) =>
  RelayChannelService.getInstance().batchSetChannelStatus({ ids, enabled }, actor, req);
const statuses = async () =>
  (
    await prisma.relayChannel.findMany({
      where: { id: { in: channels } },
      select: { id: true, status: true },
      orderBy: { id: "asc" },
    })
  ).map((row) => row.status);
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
  prefix = "channel-status-" + randomUUID();
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
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("atomic platform channel status batches", () => {
  it("changes only explicit status targets, preserving credentials, provider settings, routing and token bindings", async () => {
    const old = await prisma.relayChannel.findMany({ where: { id: { in: channels } }, orderBy: { id: "asc" } }),
      bindings = await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } });
    expect(await change()).toEqual({ total: 2, affected: 2 });
    expect(await statuses()).toEqual([
      RELAY_CHANNEL_STATUS.DISABLED,
      RELAY_CHANNEL_STATUS.DISABLED,
      RELAY_CHANNEL_STATUS.ENABLED,
    ]);
    const after = await prisma.relayChannel.findMany({ where: { id: { in: channels } }, orderBy: { id: "asc" } });
    expect(after.map((row, i) => ({ ...row, status: old[i]!.status, updateTime: old[i]!.updateTime }))).toEqual(old);
    expect(await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } })).toEqual(bindings);
    expect(
      (await prisma.relayToken.findUniqueOrThrow({ where: { id: tokenId }, select: { channelId: true } })).channelId,
    ).toBe(channels[0]);
    expect(await change(undefined, true)).toEqual({ total: 2, affected: 2 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("per-resource Deny blocks an otherwise allowed batch without partial status changes", async () => {
    await grant("quyan:relay:SetChannelStatus", platformRelayChannelArn(channels[1]!));
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("does not require read or disclosure authorization for a counts-only mutation", async () => {
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) =>
      input.action === "quyan:relay:SetChannelStatus"
        ? authorize(input)
        : input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
    );
    expect(await change()).toEqual({ total: 2, affected: 2 });
    expect(iam.authorizeMany).toHaveBeenCalled();
    for (const [input] of vi.mocked(iam.authorizeMany).mock.calls)
      expect(input.action).toBe("quyan:relay:SetChannelStatus");
  });
  it("cannot replace the persisted platform ceiling with account-owned group permissions or a wildcard policy", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await grant("quyan:relay:SetChannelStatus", "*", "Allow");
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("additional permissions alone cannot manufacture platform eligibility", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_UPDATE] } });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "deleted"])("fails the entire batch on a %s resource", async (kind) => {
    if (kind === "deleted")
      await prisma.relayChannel.update({ where: { id: channels[1] }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
    await expect(change([channels[0]!, kind === "missing" ? "missing" : channels[1]!])).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await statuses())[0]).toBe(1);
  });
  it("does not load channel credentials or rich channel records", async () => {
    const original = prisma.$transaction.bind(prisma),
      selects: unknown[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
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
    for (const select of selects) expect(select).toEqual({ id: true, status: true, updateTime: true });
  });
  it("rejects target metadata changed before entering the transaction", async () => {
    const repo = PlatformRelayChannelStatusRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: channels[0] }, data: { name: "changed" } });
      return apply(...args);
    });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it.each(["policy", "request", "key", "oauth", "group", "user"])(
    "rolls back all SQL writes when %s proof changes",
    async (kind) => {
      const req = kind === "oauth" ? await oauthRequest() : request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const repo = PlatformRelayChannelStatusRepository.getInstance(),
        candidates = repo.candidates.bind(repo);
      let sawWrite = false;
      vi.spyOn(repo, "candidates").mockImplementation(async (ids, tx) => {
        const rows = await candidates(ids, tx);
        if (tx && rows.every((row) => row.status === RELAY_CHANNEL_STATUS.DISABLED)) {
          sawWrite = true;
          if (kind === "policy")
            vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
              input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
            );
          else if (kind === "request") req.authContext!.accountOwnerId = foreign;
          else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          else if (kind === "oauth")
            await tx.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { status: 0 } });
          else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
          else await tx.user.update({ where: { id: actor }, data: { status: 0 } });
        }
        return rows;
      });
      await expect(change(undefined, false, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(sawWrite).toBe(true);
      expect(await statuses()).toEqual([1, 1, 1]);
    },
  );
  it.each(["mode", "status"])("rejects final batch %s changes after a successful write", async (kind) => {
    const repo = PlatformRelayChannelStatusRepository.getInstance(),
      candidates = repo.candidates.bind(repo);
    let changed = false;
    vi.spyOn(repo, "candidates").mockImplementation(async (ids, tx) => {
      const rows = await candidates(ids, tx);
      if (tx && !changed && rows.every((row) => row.status === RELAY_CHANNEL_STATUS.DISABLED)) {
        changed = true;
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else
          await tx.relayChannel.update({
            where: { id: ids[0] },
            data: { status: RELAY_CHANNEL_STATUS.ENABLED, updateTime: rows[0]!.updateTime },
          });
      }
      return rows;
    });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("requires the real OAuth token and client scopes, not request-claimed scopes", async () => {
    const req = await oauthRequest([Permission.RELAY_CHANNEL_READ]);
    req.oauthAccessToken!.scopes = [Permission.RELAY_CHANNEL_UPDATE];
    await expect(change(undefined, false, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
    expect(await change(undefined, false, await oauthRequest())).toEqual({ total: 2, affected: 2 });
  });
  it("uses role-only scoped grants and rolls back a session revoked during execution", async () => {
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
    await expect(change(undefined, false, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:relay:SetChannelStatus", platformRelayChannelArn(channels[0]!), "Allow", "role", role.id);
    await expect(change(undefined, false, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await change([channels[0]!], false, req)).toEqual({ total: 1, affected: 1 });
    await grant("quyan:relay:SetChannelStatus", platformRelayChannelArn(channels[1]!), "Allow", "role", role.id);
    await prisma.relayChannel.update({ where: { id: channels[0] }, data: { status: 1 } });
    const repo = PlatformRelayChannelStatusRepository.getInstance(),
      candidates = repo.candidates.bind(repo);
    vi.spyOn(repo, "candidates").mockImplementation(async (ids, tx) => {
      const rows = await candidates(ids, tx);
      if (tx && rows.every((row) => row.status === RELAY_CHANNEL_STATUS.DISABLED))
        await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return rows;
    });
    await expect(change(undefined, false, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("logs exactly once without credential payloads", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    await change();
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.mock.calls)).not.toContain("fixture-secret-channel-key");
  });
  it.each(["legacy", "shadow"] as const)(
    "%s performs exactly one old business mutation and no native UPDATE",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const old = vi.spyOn(RelayChannelRepository.getInstance(), "updateStatusByIds"),
        native = vi.spyOn(PlatformRelayChannelStatusRepository.getInstance(), "apply");
      expect(await change()).toEqual({ total: 2, affected: 2 });
      expect(old).toHaveBeenCalledOnce();
      if (mode === "shadow") expect(native.mock.calls[0]![3]).toBe(false);
      else expect(native).not.toHaveBeenCalled();
    },
  );
});

describe("atomic single channel availability toggles", () => {
  const toggle = (req = request(), id = channels[0]!) =>
    RelayChannelService.getInstance().toggleChannelStatus(id, actor, req);
  function hookTransaction(hook: (tx: Prisma.TransactionClient) => void) {
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        hook(tx);
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
  }
  async function roleRequest() {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    return { req, role, session };
  }
  it("toggles both ways and returns a safe DTO from the same transaction without changing unrelated fields", async () => {
    const before = await prisma.relayChannel.findUniqueOrThrow({ where: { id: channels[0] } }),
      token = await prisma.relayToken.findUniqueOrThrow({ where: { id: tokenId } }),
      bindings = await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } }),
      transactions = vi.spyOn(prisma, "$transaction"),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      oldWrite = vi.spyOn(RelayChannelRepository.getInstance(), "updateById");
    const result = await toggle();
    expect(result).toMatchObject({ id: channels[0], enabled: false, hasOpenaiUpstreamApiKey: true });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|fixture-token|verify/);
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(rich).not.toHaveBeenCalled();
    expect(oldWrite).not.toHaveBeenCalled();
    const after = await prisma.relayChannel.findUniqueOrThrow({ where: { id: channels[0] } });
    expect({ ...after, status: before.status, updateTime: before.updateTime }).toEqual(before);
    expect(await prisma.relayToken.findUniqueOrThrow({ where: { id: tokenId } })).toEqual(token);
    expect(await prisma.relayTokenChannelConfig.findMany({ where: { relayTokenId: tokenId } })).toEqual(bindings);
    expect((await toggle()).enabled).toBe(true);
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("does not require read grants or disclose other channels", async () => {
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) =>
      input.action === "quyan:relay:SetChannelStatus"
        ? authorize(input)
        : input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
    );
    expect((await toggle()).id).toBe(channels[0]);
    for (const [input] of vi.mocked(iam.authorizeMany).mock.calls)
      expect(input.action).toBe("quyan:relay:SetChannelStatus");
  });
  it("projects pooled capabilities only from separately admitted related channels", async () => {
    const model = prefix + "model";
    await prisma.modelPricing.create({
      data: { model, provider: "openai", supportedFormats: "openai-chat-completions", inputPrice: 1, outputPrice: 2 },
    });
    await prisma.relayChannel.update({
      where: { id: channels[0] },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "all" } },
    });
    await prisma.relayChannel.update({
      where: { id: channels[2] },
      data: { allowedModels: JSON.stringify([model]), allowedFormats: "openai-chat-completions" },
    });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: channels[0]!, memberChannelId: channels[2]!, priority: 0 },
    });
    await grant("quyan:relay:SetChannelStatus", platformRelayChannelArn(channels[2]!));
    expect(await toggle()).toMatchObject({ poolMembers: [], allowedModels: [] });
  });
  it("does not hydrate channel credentials while preparing the transaction-local response", async () => {
    const selects: unknown[] = [];
    hookTransaction((tx) => {
      const read = tx.relayChannel.findMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
        selects.push(args?.select);
        return read(args);
      });
    });
    await toggle();
    expect(selects.length).toBeGreaterThan(0);
    expect(JSON.stringify(selects)).not.toMatch(/UpstreamApiKey/);
  });
  it("requires a role-only exact channel grant and rejects default-deny before rich reads", async () => {
    const { req, role } = await roleRequest(),
      candidates = vi.spyOn(PlatformRelayChannelStatusRepository.getInstance(), "candidates");
    await expect(toggle(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(candidates).not.toHaveBeenCalled();
    await grant("quyan:relay:SetChannelStatus", platformRelayChannelArn(channels[0]!), "Allow", "role", role.id);
    expect((await toggle(req)).enabled).toBe(false);
    await expect(toggle(req, channels[1]!)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("prioritizes resource Deny over the migrated update permission", async () => {
    await grant("quyan:relay:SetChannelStatus", platformRelayChannelArn(channels[0]!));
    await expect(toggle()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it.each(["missing", "deleted", "case-alias"])(
    "rejects a %s target without changing another channel",
    async (kind) => {
      let id = channels[0]!;
      if (kind === "missing") id = "missing";
      else if (kind === "deleted")
        await prisma.relayChannel.update({ where: { id }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
      else id = id.toUpperCase();
      const before = await statuses();
      await expect(toggle(undefined, id)).rejects.toMatchObject({ statusCode: 403 });
      expect(await statuses()).toEqual(before);
    },
  );
  it.each(["account-group", "adds-only"])("cannot mint platform eligibility with %s", async (kind) => {
    if (kind === "account-group")
      await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_UPDATE] } });
    }
    await grant("quyan:relay:SetChannelStatus", "*", "Allow");
    await expect(toggle()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it.each(["missing", "owner", "subject", "oauth"])("refuses %s authentication", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.user;
    else if (kind === "owner") req.authContext!.accountOwnerId = foreign;
    else if (kind === "subject") req.authContext!.principalUserId = foreign;
    else req.oauthAccessToken = (await oauthRequest()).oauthAccessToken;
    await expect(toggle(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it.each(["policy", "request", "mode", "key", "group", "actor", "session", "payload", "status"])(
    "rolls back the toggle and its response on final %s changes",
    async (kind) => {
      let req = request(),
        sessionId: string | undefined;
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      if (kind === "session") {
        const role = await roleRequest();
        req = role.req;
        sessionId = role.session.id;
        await grant(
          "quyan:relay:SetChannelStatus",
          platformRelayChannelArn(channels[0]!),
          "Allow",
          "role",
          role.role.id,
        );
      }
      const before = await prisma.relayChannel.findUniqueOrThrow({ where: { id: channels[0] } });
      let changed = false;
      hookTransaction((tx) => {
        const resolver = RelayPoolResolverService.getInstance(),
          resolve = resolver.resolveChannelCapabilities.bind(resolver);
        vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
          const result = await resolve(...args);
          if (!changed) {
            changed = true;
            if (kind === "policy")
              await tx.user.update({
                where: { id: actor },
                data: { permissionRemoves: [Permission.RELAY_CHANNEL_UPDATE] },
              });
            else if (kind === "request") req.authContext!.accountOwnerId = foreign;
            else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
            else if (kind === "key")
              await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
            else if (kind === "group")
              await tx.group.update({ where: { id: groupId }, data: { permissions: [], updateTime: new Date(0) } });
            else if (kind === "actor") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
            else if (kind === "session")
              await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
            else
              await tx.relayChannel.update({
                where: { id: channels[0] },
                data: {
                  ...(kind === "status" ? { status: 1 } : { name: prefix + "changed" }),
                  updateTime: before.updateTime,
                },
              });
          }
          return result;
        });
      });
      await expect(toggle(req)).rejects.toMatchObject({ statusCode: 403 });
      expect(changed).toBe(true);
      expect(await prisma.relayChannel.findUniqueOrThrow({ where: { id: channels[0] } })).toEqual(before);
      expect(await statuses()).toEqual([1, 1, 1]);
    },
  );
  it("sanitizes unexpected projection failure and does not commit the toggle", async () => {
    vi.spyOn(RelayPoolResolverService.getInstance(), "resolveChannelCapabilities").mockRejectedValue(
      new Error("fixture-secret-channel-key"),
    );
    const failure = await toggle().catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 500 });
    expect(String(failure)).not.toContain("fixture-secret-channel-key");
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("logs the single operation without credentials or upstream configuration", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    await toggle();
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]![0]).toMatchObject({ targetResourceId: channels[0], changes: { enabled: false } });
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/fixture-secret|fixture-token|fixture.invalid/);
  });
  it.each(["legacy", "shadow"] as const)("%s invokes one original write without native projection", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const write = vi.spyOn(RelayChannelRepository.getInstance(), "updateById"),
      native = vi.spyOn(PlatformRelayChannelStatusRepository.getInstance(), "apply");
    expect((await toggle()).enabled).toBe(false);
    expect(write).toHaveBeenCalledOnce();
    if (mode === "shadow") expect(native.mock.calls[0]![3]).toBe(false);
    else expect(native).not.toHaveBeenCalled();
  });
});
