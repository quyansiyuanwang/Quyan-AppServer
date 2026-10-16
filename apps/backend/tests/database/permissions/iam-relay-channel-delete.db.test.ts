import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { PlatformRelayChannelDeleteRepository } from "@/store/relay/platform-relay-channel-delete.repository";
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
const action = "quyan:relay:DeleteChannel";
const change = (ids = channels.slice(0, 2), req = request()) =>
  RelayChannelService.getInstance().batchDeleteChannels({ ids }, actor, req);
const single = (id = channels[0]!, req = request()) => RelayChannelService.getInstance().deleteChannel(id, actor, req);
function transactionHook(hook: (tx: Prisma.TransactionClient) => void) {
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
const bindings = async () => ({
  tokens: await prisma.relayToken.findMany({
    where: { id: tokenId },
    select: { id: true, channelId: true, automaticProxyPoolChannelId: true, routingMode: true },
  }),
  configs: await prisma.relayTokenChannelConfig.findMany({
    where: { relayTokenId: tokenId },
    select: { id: true, channelId: true },
    orderBy: { id: "asc" },
  }),
  members: await prisma.relayChannelMember.findMany({
    where: { OR: [{ relayChannelId: { in: channels } }, { memberChannelId: { in: channels } }] },
    select: { id: true, relayChannelId: true, memberChannelId: true },
    orderBy: { id: "asc" },
  }),
  changes: await prisma.relayChannelChangeRequest.findMany({
    where: { relayChannelId: { in: channels } },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  }),
});
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
async function oauthRequest(scopes: string[] = [Permission.RELAY_CHANNEL_DELETE]) {
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
async function roleRequest() {
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
  return { req, role, session };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "channel-delete-" + randomUUID();
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
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_DELETE] },
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
  await prisma.relayToken.update({
    where: { id: tokenId },
    data: { automaticProxyPoolChannelId: channels[1], routingMode: "automatic-proxy-pool" },
  });
  await prisma.relayTokenChannelConfig.create({
    data: { relayTokenId: tokenId, channelId: channels[2]!, priority: 1 },
  });
  await prisma.relayChannelMember.createMany({
    data: [
      { relayChannelId: channels[0]!, memberChannelId: channels[2]!, priority: 0 },
      { relayChannelId: channels[2]!, memberChannelId: channels[1]!, priority: 0 },
    ],
  });
  for (const channel of channels)
    await prisma.relayChannelChangeRequest.create({
      data: {
        relayChannelId: channel,
        submittedByUserId: actor,
        configSnapshot: {},
        encryptedCredentials: "fixture-ciphertext-never-read",
      },
    });
  await prisma.relayChannelProvider.create({
    data: { relayChannelId: channels[0]!, userId: actor, commissionPercent: 1, settlementMode: "manual" },
  });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
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

describe("atomic resource-scoped platform channel deletion", () => {
  it("deletes every admitted target and clears both routing references, configurations, memberships and active changes", async () => {
    const before = await bindings();
    expect(await change()).toEqual({ total: 2, affected: 2 });
    expect(await statuses()).toEqual([
      RELAY_CHANNEL_STATUS.DELETED,
      RELAY_CHANNEL_STATUS.DELETED,
      RELAY_CHANNEL_STATUS.ENABLED,
    ]);
    const after = await bindings();
    expect(after.tokens).toEqual([
      { id: tokenId, channelId: null, automaticProxyPoolChannelId: null, routingMode: "ordered" },
    ]);
    expect(after.configs).toEqual(before.configs.filter((row) => row.channelId === channels[2]));
    expect(after.members).toEqual([]);
    expect(after.changes.filter((row) => row.status === -1)).toHaveLength(2);
    expect(after.changes.filter((row) => row.status === 1)).toHaveLength(1);
    expect(await prisma.relayChannelProvider.count({ where: { relayChannelId: channels[0], status: 1 } })).toBe(1);
  });
  it("supports single deletion without returning channel configuration", async () => {
    expect(await single()).toBeUndefined();
    expect(await statuses()).toEqual([0, 1, 1]);
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledOnce();
  });
  it("allows JSON-only grants while keeping all-resource evaluation and fixed server Action", async () => {
    const { req, role } = await roleRequest();
    for (const id of channels.slice(0, 2)) await grant(action, platformRelayChannelArn(id), "Allow", "role", role.id);
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation((input) =>
      input.action === action
        ? authorize(input)
        : Promise.resolve(
            input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
          ),
    );
    expect(await change(undefined, req)).toEqual({ total: 2, affected: 2 });
    for (const [input] of vi.mocked(iam.authorizeMany).mock.calls) expect(input.action).toBe(action);
  });
  it("a Deny on the last requested resource cancels the whole batch, including reference cleanup", async () => {
    const before = await bindings();
    await grant(action, platformRelayChannelArn(channels[1]!));
    const candidates = vi.spyOn(PlatformRelayChannelDeleteRepository.getInstance(), "candidates");
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(candidates).not.toHaveBeenCalled();
    expect(await statuses()).toEqual([1, 1, 1]);
    expect(await bindings()).toEqual(before);
  });
  it("default denial does not inspect channel or token configuration", async () => {
    const { req } = await roleRequest();
    const candidates = vi.spyOn(PlatformRelayChannelDeleteRepository.getInstance(), "candidates");
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(candidates).not.toHaveBeenCalled();
  });
  it.each(["owned-group", "permission-adds", "owner"])(
    "%s cannot manufacture deployment management authority",
    async (kind) => {
      await grant(action, "*", "Allow");
      if (kind === "owned-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      else if (kind === "permission-adds") {
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_DELETE] } });
      } else {
        const req = request();
        req.user!.userId = owner;
        req.authContext!.principalUserId = owner;
        await expect(
          RelayChannelService.getInstance().batchDeleteChannels({ ids: channels.slice(0, 2) }, owner, req),
        ).rejects.toMatchObject({ statusCode: 403 });
        return;
      }
      await expect(change()).rejects.toMatchObject({ statusCode: 403 });
      expect(await statuses()).toEqual([1, 1, 1]);
    },
  );
  it.each(["missing", "deleted", "case-alias"])("rejects an entire batch containing a %s target", async (kind) => {
    let id = channels[1]!;
    if (kind === "missing") id = "missing";
    else if (kind === "deleted") await prisma.relayChannel.update({ where: { id }, data: { status: 0 } });
    else id = id.toUpperCase();
    await expect(change([channels[0]!, id])).rejects.toMatchObject({ statusCode: 403 });
    expect((await statuses())[0]).toBe(1);
  });
  it.each(
    [[], ["same", "same"], ["invalid/id"], Array.from({ length: 201 }, (_, i) => "id" + i)].map((ids) => ({ ids })),
  )("rejects invalid batch inputs %# before mutation", async ({ ids }) => {
    await expect(change(ids)).rejects.toMatchObject({ statusCode: 400 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it.each(["missing", "forged-account", "forged-subject", "oauth"])("refuses %s identity contexts", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    else if (kind === "forged-account") req.authContext!.accountOwnerId = foreign;
    else if (kind === "forged-subject") req.authContext!.principalUserId = foreign;
    else req.oauthAccessToken = (await oauthRequest()).oauthAccessToken;
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
  });
  it("requires a request in non-legacy modes", async () => {
    await expect(RelayChannelService.getInstance().deleteChannel(channels[0]!, actor)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not hydrate rich channels, credentials, provider graphs or tokens", async () => {
    const selects: unknown[] = [];
    transactionHook((tx) => {
      const read = tx.relayChannel.findMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
        selects.push(args?.select);
        return read(args);
      });
      vi.spyOn(tx.relayToken, "findMany").mockRejectedValue(new Error("must not hydrate tokens"));
      vi.spyOn(tx.relayChannelProvider, "findMany").mockRejectedValue(new Error("must not hydrate providers"));
    });
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
    await change();
    expect(rich).not.toHaveBeenCalled();
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects)
      expect(select).toSatisfy(
        (value: unknown) =>
          JSON.stringify(value) === JSON.stringify({ id: true, status: true, updateTime: true }) ||
          JSON.stringify(value) === JSON.stringify({ id: true, visibilityMode: true, visibilityConfig: true }),
      );
  });
  it("rejects metadata changed before acquiring channel locks", async () => {
    const repo = PlatformRelayChannelDeleteRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: channels[0] }, data: { name: "changed" } });
      return apply(...args);
    });
    const before = await bindings();
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1, 1]);
    expect(await bindings()).toEqual(before);
  });
  it.each(["policy", "request", "mode", "key", "group", "user", "session", "visibility", "status", "binding"])(
    "rolls back deletion and all reference cleanup on final %s changes",
    async (kind) => {
      const req = request(),
        before = await bindings();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      let sessionId: string | undefined;
      if (kind === "session") {
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
        sessionId = session.id;
        req.authContext!.assumedRoleId = role.id;
        req.authContext!.roleSessionId = session.id;
        for (const id of channels.slice(0, 2))
          await grant(action, platformRelayChannelArn(id), "Allow", "role", role.id);
      }
      let changed = false;
      transactionHook((tx) => {
        const update = tx.relayChannelChangeRequest.updateMany.bind(tx.relayChannelChangeRequest);
        vi.spyOn(tx.relayChannelChangeRequest, "updateMany").mockImplementation((async (
          args: Prisma.RelayChannelChangeRequestUpdateManyArgs,
        ) => {
          const result = await update(args);
          if (!changed) {
            changed = true;
            if (kind === "policy")
              vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
                input.resources.map(() => ({
                  decision: "ExplicitDeny",
                  reason: "explicit-deny",
                  matchedStatements: [],
                })),
              );
            else if (kind === "request") req.authContext!.accountOwnerId = foreign;
            else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
            else if (kind === "key")
              await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
            else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
            else if (kind === "user") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
            else if (kind === "session")
              await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
            else if (kind === "visibility") {
              const row = await tx.relayChannel.findUniqueOrThrow({
                where: { id: channels[0] },
                select: { updateTime: true },
              });
              await tx.relayChannel.update({
                where: { id: channels[0] },
                data: { visibilityMode: "hidden", updateTime: row.updateTime },
              });
            } else if (kind === "status")
              await tx.relayChannel.update({ where: { id: channels[0] }, data: { status: 1 } });
            else
              await tx.relayTokenChannelConfig.create({
                data: { relayTokenId: tokenId, channelId: channels[0]!, priority: 2 },
              });
          }
          return result;
        }) as unknown as typeof tx.relayChannelChangeRequest.updateMany);
      });
      await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(changed).toBe(true);
      expect(await statuses()).toEqual([1, 1, 1]);
      expect(await bindings()).toEqual(before);
    },
  );
  it("rolls back and sanitizes unexpected cleanup errors", async () => {
    const before = await bindings();
    let changed = false;
    transactionHook((tx) => {
      vi.spyOn(tx.relayTokenChannelConfig, "deleteMany").mockImplementation(() => {
        changed = true;
        throw new Error("fixture-secret-channel-key");
      });
    });
    let failure: unknown;
    try {
      await change();
    } catch (error) {
      failure = error;
    }
    expect(changed).toBe(true);
    expect(failure).toMatchObject({ statusCode: 500 });
    expect(String(failure)).not.toContain("fixture-secret-channel-key");
    expect(await statuses()).toEqual([1, 1, 1]);
    expect(await bindings()).toEqual(before);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("audits one safe success without reading request headers or secret channel data", async () => {
    await change();
    const audit = vi.mocked(BusinessLogService.getInstance().logOperation);
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/fixture-secret|fixture-ciphertext|fixture-token/);
  });
  it.each(["legacy", "shadow"] as const)("%s executes old batch mutation and audit exactly once", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const old = vi.spyOn(RelayChannelRepository.getInstance(), "softDeleteAndUnassignTokensByIds"),
      native = vi.spyOn(PlatformRelayChannelDeleteRepository.getInstance(), "apply");
    expect(await change()).toEqual({ total: 2, affected: 2 });
    expect(old).toHaveBeenCalledOnce();
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledOnce();
    if (mode === "shadow") expect(native.mock.calls[0]![2]).toBe(false);
    else expect(native).not.toHaveBeenCalled();
  });
});
