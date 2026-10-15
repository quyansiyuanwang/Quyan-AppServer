import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
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
