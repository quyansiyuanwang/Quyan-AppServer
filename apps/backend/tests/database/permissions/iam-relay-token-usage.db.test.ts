import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenInspectionRepository } from "@/store/relay/relay-token-inspection.repository";
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  first: string,
  second: string,
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
const stats = (id = first, targetUserId?: string, req = request()) =>
  service().getUsageStats(id, actor, undefined, undefined, targetUserId, req);
const detail = (id = first, targetUserId?: string, req = request()) =>
  service().getUsageSummary(id, actor, undefined, undefined, 20, 0, targetUserId, req);
const statuses = async (ids = [first, second]) =>
  (
    await prisma.relayToken.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { status: true } })
  ).map((row) => row.status);
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
    data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
  });
async function oauthRequest(scopes: string[] = [Permission.RELAY_TOKEN_READ]) {
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
  prefix = "token-usage-" + randomUUID();
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
        name: "Usage fixture",
        permissions: [Permission.RELAY_TOKEN_READ],
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
  second = await token(actor);
  peerToken = await token(peer);
  foreignToken = await token(foreign);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayTokenMemberConfig.deleteMany({
    where: { parentToken: { userId: { in: [actor, peer, foreign] } } },
  });
  await prisma.relayUsageTokenAttribution.deleteMany({
    where: { relayTokenId: { in: [first, second, peerToken, foreignToken] } },
  });
  await prisma.relayUsage.deleteMany({ where: { relayTokenId: { in: [first, second, peerToken, foreignToken] } } });
  await prisma.relayLogicalRequest.deleteMany({
    where: { relayTokenId: { in: [first, second, peerToken, foreignToken] } },
  });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer, foreign] } } });
  await prisma.accessKey.deleteMany({ where: { userId: { in: [actor, peer] } } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource-authorized token usage inspection", () => {
  it("reads usage without loading rich tokens, secret columns, or requiring credential disclosure", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations"),
      read = vi.spyOn(prisma.relayToken, "findFirst");
    await prisma.relayUsage.create({
      data: {
        relayTokenId: first,
        totalTokens: 10,
        path: "/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
      },
    });
    const result = await stats();
    expect(result.totalTokens).toBe(10);
    expect(result.usages).toHaveLength(1);
    expect(rich).not.toHaveBeenCalled();
    for (const [args] of read.mock.calls)
      expect(args?.select).toEqual({
        id: true,
        userId: true,
        status: true,
        updateTime: true,
        name: true,
        quotaLimit: true,
        usedQuota: true,
        requestCount: true,
        totalTokens: true,
        lastUsedAt: true,
      });
    expect(JSON.stringify(result)).not.toMatch(/sk-rlt-fixture|fixture-private-secret|fixture-legacy/);
  });
  it("supports JSON-only usage access with GetToken and RevealToken explicitly denied", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant("quyan:relay:GetTokenUsage", relayTokenArn(owner, actor, first), "Allow");
    await grant("quyan:relay:GetToken", "*");
    await grant("quyan:relay:RevealToken", "*");
    expect(await detail()).toMatchObject({ relayTokenId: first, total: 0 });
    await expect(stats(second)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never begins a usage query for a denied target", async () => {
    await grant("quyan:relay:GetTokenUsage", relayTokenArn(owner, actor, first));
    const aggregate = vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds");
    await expect(detail()).rejects.toMatchObject({ statusCode: 403 });
    expect(aggregate).not.toHaveBeenCalled();
  });
  it("permissionRemoves applies an explicit Deny", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_TOKEN_READ] } });
    await expect(stats()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "alias", "deleted"])("rejects %s token identity", async (kind) => {
    if (kind === "deleted") await prisma.relayToken.update({ where: { id: first }, data: { status: -1 } });
    await expect(
      detail(kind === "missing" ? "missing" : kind === "alias" ? first.toUpperCase() : first),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("permits inspection of disabled or expired tokens without enabling them", async () => {
    await prisma.relayToken.update({ where: { id: first }, data: { status: 0, expiresAt: new Date(0) } });
    expect(await stats()).toMatchObject({ totalTokens: 0 });
    expect(await statuses([first])).toEqual([0]);
  });
  it("account wildcard does not create platform management eligibility even for same-account peers", async () => {
    await grant("quyan:relay:*", "*", "Allow");
    await expect(stats(peerToken)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("management UPDATE cannot replace required READ eligibility", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE] },
    });
    await expect(detail(foreignToken, foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("qualified managers can inspect peers and other-account users", async () => {
    await manager();
    expect(await stats(peerToken)).toMatchObject({ totalTokens: 0 });
    expect(await detail(foreignToken, foreign)).toMatchObject({ relayTokenId: foreignToken, total: 0 });
  });
  it.each(["admission", "user", "token"])("enforces management %s denial", async (kind) => {
    await manager();
    await grant(
      kind === "admission" ? "quyan:relay:GetTokenUsage" : "quyan:relay:GetManagedTokenUsage",
      kind === "admission" ? "*" : kind === "user" ? platformUserArn(peer) : platformRelayTokenArn(peer, peerToken),
    );
    await expect(stats(peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects an owner mismatch even for qualified managers", async () => {
    await manager();
    await expect(stats(first, peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["actor", "owner", "group"])("rejects disabled %s authority", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    await expect(stats()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not release usage after resource ownership/status changes during aggregation", async () => {
    vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds").mockImplementation(async () => {
      await prisma.relayToken.update({ where: { id: first }, data: { status: -1 } });
      return [];
    });
    await expect(detail()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks current IAM decisions after aggregation", async () => {
    vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds").mockImplementation(async () => {
      vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
        input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
      );
      return [];
    });
    await expect(stats()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["key", "oauth", "request"])("does not release usage after %s revocation during projection", async (kind) => {
    const req = kind === "oauth" ? await oauthRequest() : request();
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.authContext!.subjectType = "access_key";
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    }
    vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds").mockImplementation(async () => {
      if (kind === "key") await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
      else if (kind === "oauth")
        await prisma.oAuthClient.update({ where: { id: req.oauthAccessToken!.oauthClientId }, data: { status: 0 } });
      else req.authContext!.accountOwnerId = foreign;
      return [];
    });
    await expect(stats(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks persisted OAuth READ scopes, not forged request scopes", async () => {
    const req = await oauthRequest([Permission.RELAY_TOKEN_UPDATE]);
    req.oauthAccessToken!.scopes = [Permission.RELAY_TOKEN_READ];
    await expect(stats(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts the existing usage OAuth alias without requiring another scope", async () => {
    const req = await oauthRequest(["relay:usage:read"]);
    expect(await stats(first, undefined, req)).toMatchObject({ totalTokens: 0 });
  });
  it("uses assumed-role usage grants and rechecks sessions", async () => {
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
    await expect(stats(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:relay:GetTokenUsage", relayTokenArn(owner, actor, first), "Allow", {
      type: "role",
      id: role.id,
    });
    expect(await stats(first, undefined, req)).toMatchObject({ totalTokens: 0 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(stats(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("projects attributed usage under the authorized token ID instead of exposing a different token ID", async () => {
    const logical = await prisma.relayLogicalRequest.create({
      data: { relayTokenId: second, requestId: "fixture-" + randomUUID() },
    });
    const usage = await prisma.relayUsage.create({
      data: {
        relayTokenId: second,
        logicalRequestId: logical.id,
        totalTokens: 19,
        path: "/v1/responses",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
      },
    });
    await prisma.relayUsageTokenAttribution.create({
      data: { relayUsageId: usage.id, logicalRequestId: logical.id, relayTokenId: first, depth: 0 },
    });
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant("quyan:relay:GetTokenUsage", relayTokenArn(owner, actor, first), "Allow");
    expect((await stats()).usages).toMatchObject([{ relayTokenId: first, totalTokens: 19 }]);
    expect((await detail()).usages).toMatchObject([{ relayTokenId: first, totalTokens: 19 }]);
  });
  it("shadow authorizes metadata only and invokes the legacy usage reader once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const aggregate = vi.spyOn(RelayUsageRepository.getInstance(), "aggregateByRelayTokenIds");
    const target = vi.spyOn(RelayTokenInspectionRepository.getInstance(), "target");
    await stats();
    expect(target).toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledOnce();
  });
});
