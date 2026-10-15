import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenReadRepository } from "@/store/relay/relay-token-read.repository";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { ExportRelayTokensRequest } from "@/api/dto/relay/relay.dto";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  tokenId: string,
  secondId: string,
  peerToken: string,
  foreignToken: string,
  channelId: string,
  prefix: string;
let oauthClientId: string | undefined;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const service = () => new RelayTokenService();
const list = (targetUserId?: string, page = 1, pageSize = 20, req = request()) =>
  service().listTokens(actor, page, pageSize, targetUserId, req);
const get = (id = tokenId, targetUserId?: string, req = request()) => service().getToken(id, actor, targetUserId, req);
const exportTokens = (body: ExportRelayTokensRequest = {}, req = request()) => service().exportTokens(body, actor, req);
function traceCredentialReads() {
  const tx = prisma.$transaction.bind(prisma),
    secretIds: string[] = [];
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    cb: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) =>
    tx(async (client) => {
      const original = client.relayToken.findFirst.bind(client.relayToken);
      vi.spyOn(client.relayToken, "findFirst").mockImplementation((args) => {
        if ((args?.select as { token?: boolean })?.token) secretIds.push(String(args?.where?.id));
        return original(args);
      });
      return cb(client);
    }, options)) as typeof prisma.$transaction);
  return secretIds;
}
async function policy(
  action: string,
  resource: string,
  effect: "Allow" | "Deny" = "Deny",
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: action, Resource: resource, ...(condition ? { Condition: condition } : {}) },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
  return created.id;
}

async function manager() {
  await prisma.group.update({
    where: { id: groupId },
    data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
  });
}
async function oauthRequest(scopes: string[] = [Permission.RELAY_TOKEN_READ]) {
  const client = await prisma.oAuthClient.create({
    data: {
      userId: actor,
      name: prefix,
      clientId: prefix,
      clientSecretHash: "fixture-hash",
      grantTypes: ["authorization_code"],
      redirectUris: [],
      scopes,
      reviewStatus: "approved",
    },
  });
  oauthClientId = client.id;
  const token = await prisma.oAuthAccessToken.create({
    data: {
      userId: actor,
      oauthClientId: client.id,
      tokenHash: randomUUID(),
      scopes,
      expiresAt: new Date(Date.now() + 60_000),
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
  oauthClientId = undefined;
  prefix = "token-read-" + randomUUID();
  owner = actor = peer = foreign = groupId = tokenId = secondId = peerToken = foreignToken = channelId = "";
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
        name: "Fixture relay reader",
        accountOwnerId: null,
        permissions: [Permission.RELAY_TOKEN_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channelId = (
    await prisma.relayChannel.create({
      data: {
        name: prefix,
        openaiUpstreamApiKey: "fixture-private-upstream-key",
        openaiUpstreamUrl: "https://fixture-private.invalid",
      },
    })
  ).id;
  const token = async (userId: string, daysAgo: number) =>
    (
      await prisma.relayToken.create({
        data: {
          userId,
          name: prefix,
          channelId,
          token: "sk-rlt-fixture-" + randomUUID(),
          legacyToken: "fixture-legacy-" + randomUUID(),
          upstreamApiKey: "fixture-private-token-upstream",
          upstreamUrl: "https://fixture-private-token.invalid",
          createTime: new Date(Date.now() - daysAgo * 86400_000),
        },
      })
    ).id;
  tokenId = await token(actor, 2);
  secondId = await token(actor, 1);
  peerToken = await token(peer, 1);
  foreignToken = await token(foreign, 1);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  if (oauthClientId) {
    await prisma.oAuthAccessToken.deleteMany({ where: { oauthClientId } });
    await prisma.oAuthClient.deleteMany({ where: { id: oauthClientId } });
  }
  await prisma.relayTokenMemberConfig.deleteMany({
    where: { parentToken: { userId: { in: [actor, peer, foreign] } } },
  });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer, foreign] } } });
  await prisma.relayChannel.deleteMany({ where: { id: channelId } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource scoped relay token reads", () => {
  it("keeps legacy read grants limited to the authenticated user's tokens", async () => {
    const result = await list();
    expect(result.items.map((row) => row.id)).toEqual([secondId, tokenId]);
    expect(result.total).toBe(2);
    expect(result.items.every((row) => row.token?.startsWith("sk-rlt-") && row.userId === actor)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/fixture-private|fixture-legacy|password/);
  });
  it("single reads use the same safe projection, not the legacy credential-rich relations", async () => {
    const full = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    expect((await get()).id).toBe(tokenId);
    expect(full).not.toHaveBeenCalled();
  });
  it("denied metadata disappears from both pagination and total, before any credential read", async () => {
    await policy("quyan:relay:ListTokens", relayTokenArn(owner, actor, secondId));
    const result = await list(undefined, 1, 1);
    expect(result.items.map((row) => row.id)).toEqual([tokenId]);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });
  it("supports JSON-only exact-resource policies without a global legacy Permission", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("quyan:relay:ListTokens", relayTokenArn(owner, actor, tokenId), "Allow");
    const result = await list();
    expect(result.items.map((row) => row.id)).toEqual([tokenId]);
    expect(result.items[0]).not.toHaveProperty("token");
  });
  it("metadata Allow is not permission to read the credential column", async () => {
    await policy("quyan:relay:RevealToken", relayTokenArn(owner, actor, tokenId));
    const tx = prisma.$transaction.bind(prisma);
    const secretIds: string[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      cb: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      tx(async (client) => {
        const read = client.relayToken.findFirst.bind(client.relayToken);
        vi.spyOn(client.relayToken, "findFirst").mockImplementation((args) => {
          if ((args?.select as { token?: boolean })?.token) secretIds.push(String(args?.where?.id));
          return read(args);
        });
        return cb(client);
      }, options)) as typeof prisma.$transaction);
    const result = await list();
    expect(result.items.find((row) => row.id === tokenId)).not.toHaveProperty("token");
    expect(result.items.find((row) => row.id === secondId)?.token).toBeTruthy();
    expect(secretIds).toEqual([secondId]);
  });
  it("returns metadata when only credential reveal is denied on a single token", async () => {
    await policy("quyan:relay:RevealToken", relayTokenArn(owner, actor, tokenId));
    expect(await get()).not.toHaveProperty("token");
  });
  it("a matching explicit Deny defeats a JSON Allow across policy sources", async () => {
    await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, tokenId), "Allow");
    await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, tokenId));
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["peer", "foreign"])("an account wildcard never manufactures %s management qualification", async (kind) => {
    await policy("*", "*", "Allow");
    await expect(get(kind === "peer" ? peerToken : foreignToken)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("platform managers read foreign tokens only with both endpoint and platform grants", async () => {
    await manager();
    const result = await list(foreign);
    expect(result.items.map((row) => row.id)).toEqual([foreignToken]);
    expect(result.items[0]?.token).toBeTruthy();
    expect((await get(foreignToken)).id).toBe(foreignToken);
  });
  it.each(["target-user", "token"])("honors platform %s Deny and never falls back to a personal ARN", async (kind) => {
    await manager();
    await policy(
      "quyan:relay:GetManagedToken",
      kind === "target-user" ? platformUserArn(foreign) : platformRelayTokenArn(foreign, foreignToken),
    );
    await expect(get(foreignToken)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("manager credential Deny keeps metadata but does not reveal another user's token", async () => {
    await manager();
    await policy("quyan:relay:RevealManagedToken", platformRelayTokenArn(foreign, foreignToken));
    expect(await get(foreignToken)).not.toHaveProperty("token");
  });
  it("does not let manager scopes bypass a denied personal endpoint admission", async () => {
    await manager();
    await policy("quyan:relay:ListTokens", "*");
    await expect(list(foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects mismatched requested owners, missing IDs and case aliases uniformly", async () => {
    await manager();
    await expect(get(tokenId, peer)).rejects.toMatchObject({ statusCode: 403 });
    await expect(get("fixture-missing-token")).rejects.toMatchObject({ statusCode: 403 });
    await expect(get(tokenId.toUpperCase())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("disabled tokens remain visible while deleted tokens are hidden", async () => {
    await prisma.relayToken.update({ where: { id: tokenId }, data: { status: 0 } });
    expect((await get()).status).toBe(0);
    await prisma.relayToken.update({ where: { id: tokenId }, data: { status: -1 } });
    expect((await list()).total).toBe(1);
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["actor", "owner", "group"])("a disabled %s closes reads", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("a conditional policy uses trusted transport, not client Action/Resource headers", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, tokenId), "Allow", {
      Bool: { "acs:SecureTransport": "true" },
    });
    const req = request();
    req.headers["x-action"] = "quyan:relay:GetToken";
    req.headers["x-resource"] = "*";
    expect((await get(tokenId, undefined, req)).id).toBe(tokenId);
    Object.defineProperty(req, "secure", { value: false });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("authorizes composite members separately and never hydrates an unauthorized member's name", async () => {
    await prisma.relayToken.update({ where: { id: tokenId }, data: { routingMode: "composite" } });
    await prisma.relayTokenMemberConfig.create({ data: { parentTokenId: tokenId, tokenId: secondId, priority: 0 } });
    await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, secondId));
    expect((await get()).memberTokenConfigs).toEqual([]);
  });
  it("returns authorized composite member metadata without member credentials", async () => {
    await prisma.relayTokenMemberConfig.create({ data: { parentTokenId: tokenId, tokenId: secondId, priority: 0 } });
    const result = await get();
    expect(result.memberTokenConfigs).toMatchObject([{ tokenId: secondId, name: prefix }]);
    expect(result.memberTokenConfigs?.[0]).not.toHaveProperty("token");
  });
  it("rechecks a late reveal revocation after quota projection before returning any secret", async () => {
    await prisma.relayTokenQuotaWindow.create({
      data: { relayTokenId: tokenId, quotaWindowHours: 1, quotaUnit: "request", quotaLimit: 10 },
    });
    let revoked = false;
    vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds").mockImplementation(async () => {
      revoked = true;
      return [];
    });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return revoked && input.action === "quyan:relay:RevealToken"
        ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : result;
    });
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
    expect(revoked).toBe(true);
  });
  it("revocation or ownership changes after hydration prevent the original row from returning", async () => {
    const repository = RelayTokenReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await prisma.relayToken.update({ where: { id: tokenId }, data: { userId: peer } });
      return result;
    });
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses persisted OAuth scopes and rechecks token revocation, not request scope assertions", async () => {
    const req = await oauthRequest();
    expect((await get(tokenId, undefined, req)).id).toBe(tokenId);
    await prisma.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { revokedAt: new Date() } });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("OAuth application scope removal or expiry closes metadata reads", async () => {
    const req = await oauthRequest();
    await prisma.oAuthClient.update({ where: { id: oauthClientId }, data: { scopes: [] } });
    await expect(list(undefined, 1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("OAuth personal read scope cannot be reused for management of another user", async () => {
    await manager();
    const req = await oauthRequest();
    await expect(get(foreignToken, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires a current AccessKey owned by the authenticated user", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-only-" + randomUUID() } });
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    expect((await get(tokenId, undefined, req)).id).toBe(tokenId);
    await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects AccessKey expiry and principal/key ownership substitution", async () => {
    const key = await prisma.accessKey.create({ data: { userId: peer, key: "fixture-only-" + randomUUID() } });
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.accessKey.update({ where: { id: key.id }, data: { userId: actor, expiresAt: new Date(0) } });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks persisted AccessKey revocation after quota projection", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-only-" + randomUUID() } });
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    await prisma.relayTokenQuotaWindow.create({
      data: { relayTokenId: tokenId, quotaWindowHours: 1, quotaUnit: "request", quotaLimit: 10 },
    });
    vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds").mockImplementation(async () => {
      await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
      return [];
    });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses assumed-role policies rather than the user's legacy read permission", async () => {
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
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    const policyId = await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, tokenId), "Allow");
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "role",
        principalId: role.id,
        policyId,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    expect(await get(tokenId, undefined, req)).toMatchObject({ id: tokenId });
    expect(await get(tokenId, undefined, req)).not.toHaveProperty("token");
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a role session revoked between hydration and response projection", async () => {
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
    const policyId = await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, tokenId), "Allow");
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "role",
        principalId: role.id,
        policyId,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    const repository = RelayTokenReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
      return result;
    });
    await expect(get(tokenId, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow reads metadata only, then executes the legacy list once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const read = vi.spyOn(RelayTokenReadRepository.getInstance(), "read"),
      legacy = vi.spyOn(RelayTokenRepository.getInstance(), "findPageWithRelations");
    const result = await list();
    expect(result.total).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![6]).toBe(false);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("legacy mode does not execute the native reader", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const read = vi.spyOn(RelayTokenReadRepository.getInstance(), "read");
    expect((await list()).total).toBe(2);
    expect(read).not.toHaveBeenCalled();
  });
  it("requires authentication context and bounded pagination in enforce mode", async () => {
    await expect(service().listTokens(actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(list(undefined, 0)).rejects.toMatchObject({ statusCode: 400 });
    await expect(list(undefined, 1, 101)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("exports selected own tokens in caller order using credential-free configuration relations", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByUserIdWithRelations");
    const result = await exportTokens({ ids: [tokenId, secondId] });
    expect(result.tokens.map((row) => row.id)).toEqual([tokenId, secondId]);
    expect(result.tokens.every((row) => row.token.startsWith("sk-rlt-"))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/fixture-private|fixture-legacy|password/);
    expect(rich).not.toHaveBeenCalled();
  });
  it.each(["ExportTokens", "RevealToken"])(
    "refuses an entire selected export before credential reads when %s is denied",
    async (operation) => {
      await policy("quyan:relay:" + operation, relayTokenArn(owner, actor, secondId));
      const secretIds = traceCredentialReads();
      await expect(exportTokens({ ids: [tokenId, secondId] })).rejects.toMatchObject({ statusCode: 403 });
      expect(secretIds).toEqual([]);
    },
  );
  it("does not treat a list/get grant as credential-bearing export permission", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("quyan:relay:GetToken", relayTokenArn(owner, actor, tokenId), "Allow");
    await policy("quyan:relay:RevealToken", relayTokenArn(owner, actor, tokenId), "Allow");
    await expect(exportTokens({ ids: [tokenId] })).rejects.toMatchObject({ statusCode: 403 });
    await policy("quyan:relay:ExportTokens", relayTokenArn(owner, actor, tokenId), "Allow");
    expect((await exportTokens({ ids: [tokenId] })).tokens[0].id).toBe(tokenId);
  });
  it("all-token export is all-or-nothing rather than a silently filtered backup", async () => {
    await policy("quyan:relay:ExportTokens", relayTokenArn(owner, actor, secondId));
    const secrets = traceCredentialReads();
    await expect(exportTokens()).rejects.toMatchObject({ statusCode: 403 });
    expect(secrets).toEqual([]);
  });
  it("exports enabled tokens by default and includes disabled ones only on explicit request", async () => {
    await prisma.relayToken.update({ where: { id: secondId }, data: { status: 0 } });
    expect((await exportTokens()).tokens.map((row) => row.id)).toEqual([tokenId]);
    expect((await exportTokens({ includeDisabled: true })).tokens.map((row) => row.id)).toEqual([secondId, tokenId]);
    await expect(exportTokens({ ids: [secondId] })).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayToken.update({ where: { id: secondId }, data: { status: -1 } });
    await expect(exportTokens({ ids: [secondId], includeDisabled: true })).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing-token", "case-alias", "peer-token"])("never silently omits a requested %s", async (kind) => {
    const id = kind === "missing-token" ? "fixture-missing" : kind === "case-alias" ? tokenId.toUpperCase() : peerToken;
    await expect(exportTokens({ ids: [tokenId, id] })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires export authorization on every referenced composite member before reading any credential", async () => {
    await prisma.relayToken.update({ where: { id: tokenId }, data: { routingMode: "composite" } });
    await prisma.relayTokenMemberConfig.create({ data: { parentTokenId: tokenId, tokenId: secondId, priority: 0 } });
    await policy("quyan:relay:ExportTokens", relayTokenArn(owner, actor, secondId));
    const secrets = traceCredentialReads();
    await expect(exportTokens({ ids: [tokenId] })).rejects.toMatchObject({ statusCode: 403 });
    expect(secrets).toEqual([]);
  });
  it("preserves authorized disabled composite member references without exporting their credentials", async () => {
    await prisma.relayToken.update({ where: { id: tokenId }, data: { routingMode: "composite" } });
    await prisma.relayToken.update({ where: { id: secondId }, data: { status: 0 } });
    await prisma.relayTokenMemberConfig.create({
      data: { parentTokenId: tokenId, tokenId: secondId, priority: 0, enabled: false },
    });
    await policy("quyan:relay:RevealToken", relayTokenArn(owner, actor, secondId));
    const secrets = traceCredentialReads(),
      result = await exportTokens({ ids: [tokenId] });
    expect(result.tokens[0].memberTokenConfigs).toEqual([{ tokenId: secondId, priority: 0, enabled: false }]);
    expect(secrets).toEqual([tokenId]);
  });
  it("does not invent platform management eligibility for a wildcard account policy", async () => {
    await policy("quyan:relay:*", "*", "Allow");
    await expect(exportTokens({ targetUserId: foreign, ids: [foreignToken] })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["ExportManagedTokens", "RevealManagedToken"])(
    "keeps managed export behind %s on each exact token",
    async (operation) => {
      await manager();
      expect((await exportTokens({ targetUserId: foreign, ids: [foreignToken] })).tokens.map((row) => row.id)).toEqual([
        foreignToken,
      ]);
      await policy("quyan:relay:" + operation, platformRelayTokenArn(foreign, foreignToken));
      await expect(exportTokens({ targetUserId: foreign, ids: [foreignToken] })).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );
  it("suppresses all exported credentials if owner identity changes after hydration", async () => {
    const repository = RelayTokenReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await prisma.relayToken.update({ where: { id: tokenId }, data: { userId: peer } });
      return result;
    });
    await expect(exportTokens({ ids: [tokenId, secondId] })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow checks export members without native credential hydration then calls legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const read = vi.spyOn(RelayTokenReadRepository.getInstance(), "read"),
      legacy = vi.spyOn(RelayTokenRepository.getInstance(), "findByUserIdWithRelations");
    const secrets = traceCredentialReads();
    expect((await exportTokens()).tokens).toHaveLength(2);
    expect(read.mock.calls[0]![6]).toBe(false);
    expect(secrets).toEqual([]);
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("rechecks export disclosure decisions after DTO construction, not just at the initial scan", async () => {
    const repository = RelayTokenReadRepository.getInstance(),
      original = repository.read.bind(repository);
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    let revoked = false;
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      revoked = true;
      return result;
    });
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      return revoked && input.action === "quyan:relay:RevealToken"
        ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : result;
    });
    await expect(exportTokens({ ids: [tokenId, secondId] })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("managed export still requires personal endpoint admission and the target-user grant", async () => {
    await manager();
    await policy("quyan:relay:ExportManagedTokens", platformUserArn(foreign));
    await expect(exportTokens({ targetUserId: foreign, ids: [foreignToken] })).rejects.toMatchObject({
      statusCode: 403,
    });
    await policy("quyan:relay:ExportTokens", "*");
    await expect(exportTokens({ targetUserId: peer, ids: [peerToken] })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("OAuth export rechecks application and token scopes rather than trusting request assertions", async () => {
    const req = await oauthRequest();
    expect((await exportTokens({ ids: [tokenId] }, req)).tokens[0].id).toBe(tokenId);
    await prisma.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { scopes: [] } });
    await expect(exportTokens({ ids: [tokenId] }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
