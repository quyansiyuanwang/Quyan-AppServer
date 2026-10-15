import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
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
import { RelayChannelSelectionRepository } from "@/store/relay/relay-channel-selection.repository";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
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
const change = (channelId = channels[1]!, id = first, targetUserId?: string, req = request()) =>
  service().updateTokenChannel(id, actor, { channelId }, req, targetUserId);
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
const manager = () =>
  prisma.group.update({
    where: { id: groupId },
    data: {
      permissions: [
        Permission.RELAY_TOKEN_UPDATE,
        Permission.RELAY_TOKEN_READ,
        Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
        Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
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
  prefix = "token-channel-" + randomUUID();
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
describe("atomic resource-authorized token channel changes", () => {
  it("adds and reorders channels without public or rich postcommit reads", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations"),
      publicGet = vi.spyOn(RelayTokenService.prototype, "getToken"),
      old = await prisma.relayToken.findUniqueOrThrow({ where: { id: first }, select: { token: true } });
    const result = await change();
    expect(result).toMatchObject({ id: first, channelId: channels[1], token: old.token });
    expect(await routing()).toEqual({
      channelId: channels[1],
      routingMode: "ordered",
      channelConfigs: [
        { channelId: channels[1], priority: 0 },
        { channelId: channels[0], priority: 1 },
      ],
    });
    await change(channels[0]);
    expect((await routing()).channelConfigs).toEqual([
      { channelId: channels[0], priority: 0 },
      { channelId: channels[1], priority: 1 },
    ]);
    expect(rich).not.toHaveBeenCalled();
    expect(publicGet).not.toHaveBeenCalled();
  });
  it("supports the primary-only legacy representation without losing its previous channel", async () => {
    await prisma.relayTokenChannelConfig.deleteMany({ where: { relayTokenId: first } });
    await change();
    expect((await routing()).channelConfigs.map((row) => row.channelId)).toEqual([channels[1], channels[0]]);
  });
  it.each(["UpdateTokenChannel", "GetToken", "SelectTokenChannel"])("rejects %s Deny before writes", async (action) => {
    const before = await routing();
    await grant("quyan:relay:" + action, "*");
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await routing()).toEqual(before);
  });
  it("checks every retained channel, not only the requested primary", async () => {
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[0]!));
    const before = await routing();
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await routing()).toEqual(before);
  });
  it("permits JSON-only narrowly scoped update, read and selection without legacy global permissions", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    for (const action of ["UpdateTokenChannel", "GetToken"])
      await grant("quyan:relay:" + action, relayTokenArn(owner, actor, first), "Allow");
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    for (const id of channels.slice(0, 2))
      await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, id), "Allow");
    expect(await change()).not.toHaveProperty("token");
    await expect(change(channels[2])).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { visibilityMode: "hidden" },
    { visibilityMode: "private" },
    { visibilityMode: "whitelist", visibilityConfig: {} },
    { status: RELAY_CHANNEL_STATUS.DISABLED },
    { status: RELAY_CHANNEL_STATUS.DELETED },
    { providerServiceEnabled: false },
    { channelType: "automatic-proxy-pool" },
    { visibilityMode: "unknown" },
  ])("rejects unavailable selection %j", async (data) => {
    await prisma.relayChannel.update({ where: { id: channels[1] }, data });
    const before = await routing();
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await routing()).toEqual(before);
  });
  it.each(["user", "group", "direct-role", "group-role"])(
    "honors persisted %s whitelists without reading rich identities",
    async (kind) => {
      let config: Record<string, string[]>;
      if (kind === "user") config = { userIds: [actor] };
      else if (kind === "group") config = { groupIds: [groupId] };
      else {
        const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
        if (kind === "direct-role")
          await prisma.ramUserRoleBinding.create({
            data: { accountOwnerId: owner, roleId: role.id, userId: actor },
          });
        else
          await prisma.ramGroupRoleBinding.create({
            data: { accountOwnerId: owner, roleId: role.id, groupId },
          });
        config = { roleIds: [role.id] };
      }
      await prisma.relayChannel.update({
        where: { id: channels[1] },
        data: { visibilityMode: "whitelist", visibilityConfig: config },
      });
      expect((await change()).channelId).toBe(channels[1]);
    },
  );
  it("requires active business visibility for retained channels too", async () => {
    await prisma.relayChannel.update({ where: { id: channels[0] }, data: { visibilityMode: "private" } });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not accept missing, deleted or foreign token ownership", async () => {
    for (const id of ["missing", foreignToken])
      await expect(change(channels[1], id)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayToken.update({ where: { id: first }, data: { status: -1 } });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["composite", "automatic-pool"])("cannot implicitly convert %s tokens", async (routingMode) => {
    await prisma.relayToken.update({ where: { id: first }, data: { routingMode } });
    const before = await routing();
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(await routing()).toEqual(before);
  });
  it("requires independent managed UPDATE and READ ceilings and platform-resource proofs", async () => {
    await expect(change(channels[1], peerToken)).rejects.toMatchObject({ statusCode: 403 });
    await manager();
    expect((await change(channels[1], peerToken, peer)).userId).toBe(peer);
    await grant("quyan:relay:UpdateManagedTokenChannel", platformRelayTokenArn(peer, peerToken));
    await expect(change(channels[0], peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("account policy grants cannot manufacture platform management membership", async () => {
    for (const action of ["UpdateManagedTokenChannel", "GetManagedToken"]) {
      await grant("quyan:relay:" + action, platformUserArn(peer), "Allow");
      await grant("quyan:relay:" + action, platformRelayTokenArn(peer, peerToken), "Allow");
    }
    await expect(change(channels[1], peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never reads credentials when Reveal is denied, including channel selection", async () => {
    await grant("quyan:relay:RevealToken", "*");
    const original = prisma.$transaction.bind(prisma),
      selects: unknown[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        const read = tx.relayToken.findFirst.bind(tx.relayToken);
        vi.spyOn(tx.relayToken, "findFirst").mockImplementation((args) => {
          selects.push(args?.select);
          return read(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const selection = vi.spyOn(RelayChannelSelectionRepository.getInstance(), "snapshot");
    const result = await change();
    expect(result).not.toHaveProperty("token");
    expect(selection).toHaveBeenCalled();
    for (const row of selection.mock.results)
      if (row.type === "return") expect(JSON.stringify(await row.value)).not.toContain("fixture-upstream-private");
    for (const select of selects)
      for (const key of ["token", "legacyToken", "upstreamApiKey"]) expect(select).not.toHaveProperty(key);
  });
  it.each(["policy", "request", "key", "oauth", "visibility", "configuration"])(
    "rolls back relation and primary writes on %s changes during response construction",
    async (kind) => {
      const req = kind === "oauth" ? await oauthRequest() : request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const before = await routing(),
        responses = RelayTokenMutationResponseRepository.getInstance(),
        read = responses.read.bind(responses);
      vi.spyOn(responses, "read").mockImplementation(async (tx, ...rest) => {
        const result = await read(tx, ...rest);
        expect(
          (await tx.relayToken.findUniqueOrThrow({ where: { id: first }, select: { channelId: true } })).channelId,
        ).toBe(channels[1]);
        if (kind === "policy")
          vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
            input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
          );
        else if (kind === "request") req.authContext!.accountOwnerId = foreign;
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "oauth")
          await tx.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { status: 0 } });
        else if (kind === "visibility")
          await tx.relayChannel.update({ where: { id: channels[0] }, data: { visibilityMode: "private" } });
        else await tx.relayTokenChannelConfig.deleteMany({ where: { relayTokenId: first, channelId: channels[0] } });
        return result;
      });
      await expect(change(channels[1], first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(await routing()).toEqual(before);
    },
  );
  it("rejects source configuration changes before mutation admission", async () => {
    const repo = RelayTokenMutationRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayTokenChannelConfig.updateMany({ where: { relayTokenId: first }, data: { priority: 3 } });
      return apply(...args);
    });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect((await routing()).channelId).toBe(channels[0]);
  });
  it("does not trust request-claimed OAuth scopes", async () => {
    const req = await oauthRequest([Permission.RELAY_TOKEN_UPDATE]);
    req.oauthAccessToken!.scopes.push(Permission.RELAY_TOKEN_READ);
    await expect(change(channels[1], first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await change(channels[1], first, undefined, await oauthRequest())).id).toBe(first);
  });
  it("requires role-only grants and detects revocation during the write response", async () => {
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
    await expect(change(channels[1], first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    for (const action of ["UpdateTokenChannel", "GetToken"])
      await grant("quyan:relay:" + action, relayTokenArn(owner, actor, first), "Allow", { type: "role", id: role.id });
    for (const id of channels.slice(0, 2))
      await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, id), "Allow", {
        type: "role",
        id: role.id,
      });
    expect((await change(channels[1], first, undefined, req)).id).toBe(first);
    const before = await routing(),
      responses = RelayTokenMutationResponseRepository.getInstance(),
      read = responses.read.bind(responses);
    vi.spyOn(responses, "read").mockImplementation(async (tx, ...rest) => {
      const result = await read(tx, ...rest);
      await tx.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(change(channels[0], first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await routing()).toEqual(before);
  });
  it("records a single successful change without token or channel credentials", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const result = await change();
    expect(audit).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(audit.mock.calls);
    expect(serialized).not.toContain(result.token!);
    expect(serialized).not.toContain("fixture-upstream-private");
    expect(serialized).not.toContain("fixture-private-secret");
  });
  it("a global visibility ceiling still needs an independent selection Allow and cannot expose hidden channels", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        permissions: [Permission.RELAY_TOKEN_UPDATE, Permission.RELAY_TOKEN_READ, Permission.RELAY_CHANNEL_UPDATE],
      },
    });
    await prisma.relayChannel.update({ where: { id: channels[1] }, data: { visibilityMode: "private" } });
    expect((await change()).channelId).toBe(channels[1]);
    await prisma.relayChannel.update({ where: { id: channels[1] }, data: { visibilityMode: "hidden" } });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannel.update({ where: { id: channels[1] }, data: { visibilityMode: "private" } });
    await grant("quyan:relay:SelectTokenChannel", relayChannelSelectionArn(owner, channels[1]!));
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("%s executes the original mutation exactly once", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const legacy = vi.spyOn(RelayTokenRepository.getInstance(), "replaceChannelConfigs"),
      response = vi.spyOn(RelayTokenMutationResponseRepository.getInstance(), "read"),
      mutation = vi.spyOn(RelayTokenMutationRepository.getInstance(), "apply");
    await change();
    expect(legacy).toHaveBeenCalledOnce();
    expect(response).not.toHaveBeenCalled();
    if (mode === "shadow") expect(mutation.mock.calls[0]![3]).toBe(false);
    else expect(mutation).not.toHaveBeenCalled();
  });
});
