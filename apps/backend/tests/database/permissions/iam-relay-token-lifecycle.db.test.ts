import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission } from "@quyan/shared";
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
const toggle = (id = first, targetUserId?: string, req = request()) =>
  service().toggleTokenStatus(id, actor, req, targetUserId);
const refresh = (id = first, targetUserId?: string, req = request()) =>
  service().refreshToken(id, actor, req, targetUserId);
const credential = async (id = first) =>
  (await prisma.relayToken.findUniqueOrThrow({ where: { id }, select: { token: true } })).token;
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
  prefix = "token-lifecycle-" + randomUUID();
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
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer, foreign] } } });
  await prisma.accessKey.deleteMany({ where: { userId: { in: [actor, peer] } } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("atomic token toggle and credential refresh", () => {
  it("toggles under the same locked mutation and response boundary, without a postcommit GET", async () => {
    const publicRead = vi.spyOn(RelayTokenService.prototype, "getToken"),
      rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    const old = await credential();
    const result = await toggle();
    expect(result).toMatchObject({ id: first, status: 0, token: old });
    expect(await statuses()).toEqual([0, 1]);
    expect(publicRead).not.toHaveBeenCalled();
    expect(rich).not.toHaveBeenCalled();
    expect((await toggle()).status).toBe(1);
  });
  it("returns metadata-only toggle DTOs when Reveal is denied and never loads credential columns", async () => {
    await grant("quyan:relay:RevealToken", "*");
    const original = prisma.$transaction.bind(prisma),
      selects: unknown[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      original(async (tx) => {
        const read = tx.relayToken.findFirst.bind(tx.relayToken);
        vi.spyOn(tx.relayToken, "findFirst").mockImplementation((args) => {
          selects.push(args?.select);
          return read(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const result = await toggle();
    expect(result).not.toHaveProperty("token");
    expect(result.status).toBe(0);
    for (const select of selects) {
      expect(select).not.toHaveProperty("token");
      expect(select).not.toHaveProperty("legacyToken");
      expect(select).not.toHaveProperty("upstreamApiKey");
    }
  });
  it("rotates only after refresh/read/reveal admission and retires the old canonical and legacy credentials", async () => {
    const before = await prisma.relayToken.findUniqueOrThrow({ where: { id: first } }),
      rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    const result = await refresh();
    expect(result.token).toMatch(/^sk-rlt-[a-f0-9]{64}$/);
    expect(result.token).not.toBe(before.token);
    expect(await credential()).toBe(result.token);
    expect(
      await prisma.relayToken.count({ where: { OR: [{ token: before.token }, { legacyToken: before.legacyToken! }] } }),
    ).toBe(0);
    const after = await prisma.relayToken.findUniqueOrThrow({ where: { id: first } });
    expect({ ...after, token: before.token, legacyToken: before.legacyToken, updateTime: before.updateTime }).toEqual(
      before,
    );
    expect(rich).not.toHaveBeenCalled();
  });
  it.each(["RefreshToken", "GetToken", "RevealToken"])(
    "rejects %s Deny before credential rotation",
    async (operation) => {
      const old = await credential();
      await grant("quyan:relay:" + operation, "*");
      await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
      expect(await credential()).toBe(old);
    },
  );
  it("rejects a missing read grant before changing status, but leaves batch write-only status available", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.RELAY_TOKEN_UPDATE] } });
    await expect(toggle()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
    expect(await service().batchSetTokenStatus({ ids: [first], enabled: false }, actor, request())).toEqual({
      total: 1,
      affected: 1,
    });
  });
  it("supports exact JSON-only lifecycle/read/reveal grants without legacy permissions", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    for (const action of ["RefreshToken", "SetTokenStatus", "GetToken", "RevealToken"])
      await grant("quyan:relay:" + action, relayTokenArn(owner, actor, first), "Allow");
    expect((await refresh()).id).toBe(first);
    expect((await toggle()).status).toBe(0);
    await expect(refresh(second)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "alias", "deleted"])("rejects %s targets without credential mutation", async (kind) => {
    const old = await credential();
    if (kind === "deleted") await prisma.relayToken.update({ where: { id: first }, data: { status: -1 } });
    await expect(
      refresh(kind === "missing" ? "missing" : kind === "alias" ? first.toUpperCase() : first),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await credential()).toBe(old);
  });
  it("allows refresh of a disabled/expired token without enabling or unexpiring it", async () => {
    await prisma.relayToken.update({ where: { id: first }, data: { status: 0, expiresAt: new Date(0) } });
    expect(await refresh()).toMatchObject({ status: 0, expiresAt: new Date(0) });
    expect(await statuses([first])).toEqual([0]);
  });
  it("does not use account wildcards to qualify peer management", async () => {
    await grant("quyan:relay:*", "*", "Allow");
    await expect(refresh(peerToken)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires both management UPDATE and READ eligibility for the complete mutation DTO", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: {
        permissions: [
          Permission.RELAY_TOKEN_UPDATE,
          Permission.RELAY_TOKEN_READ,
          Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
        ],
      },
    });
    await expect(toggle(peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses([peerToken])).toEqual([1]);
  });
  it("qualified managers can refresh other users only through platform resources", async () => {
    await manager();
    expect((await refresh(peerToken)).userId).toBe(peer);
    expect((await toggle(foreignToken, foreign)).status).toBe(0);
  });
  it.each(["admission", "user", "token", "read", "reveal"])(
    "enforces managed %s denial before writes",
    async (kind) => {
      await manager();
      const old = await credential(peerToken);
      const action =
        kind === "admission"
          ? "RefreshToken"
          : kind === "read"
            ? "GetManagedToken"
            : kind === "reveal"
              ? "RevealManagedToken"
              : "RefreshManagedToken";
      const resource =
        kind === "admission" ? "*" : kind === "user" ? platformUserArn(peer) : platformRelayTokenArn(peer, peerToken);
      await grant("quyan:relay:" + action, resource);
      await expect(refresh(peerToken, peer)).rejects.toMatchObject({ statusCode: 403 });
      expect(await credential(peerToken)).toBe(old);
    },
  );
  it("rejects supplied-owner mismatches even for platform managers", async () => {
    await manager();
    await expect(toggle(first, peer)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it.each(["actor", "owner", "group"])("rejects disabled %s authority", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    await expect(toggle()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("does not disclose denied composite member metadata in a mutation response", async () => {
    await prisma.relayTokenMemberConfig.create({
      data: { parentTokenId: first, tokenId: second, enabled: true, priority: 0 },
    });
    await grant("quyan:relay:GetToken", relayTokenArn(owner, actor, second));
    expect((await toggle()).memberTokenConfigs).toEqual([]);
  });
  it("keeps permitted composite member metadata without returning its credential", async () => {
    await prisma.relayTokenMemberConfig.create({
      data: { parentTokenId: first, tokenId: second, enabled: true, priority: 0 },
    });
    const result = await refresh();
    expect(result.memberTokenConfigs).toMatchObject([{ tokenId: second }]);
    expect(JSON.stringify(result)).not.toContain(await credential(second));
  });
  it.each(["toggle", "refresh"])(
    "rolls back an executed %s UPDATE when response hydration loses authorization",
    async (operation) => {
      const old = await credential(),
        repo = RelayTokenMutationResponseRepository.getInstance(),
        read = repo.read.bind(repo);
      let sawWrite = false;
      vi.spyOn(repo, "read").mockImplementation(async (tx, ...rest) => {
        const row = await tx.relayToken.findUniqueOrThrow({
          where: { id: first },
          select: { token: true, status: true },
        });
        sawWrite = operation === "refresh" ? row.token !== old : row.status === 0;
        expect(sawWrite).toBe(true);
        vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
          input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
        );
        return read(tx, ...rest);
      });
      await expect(operation === "refresh" ? refresh() : toggle()).rejects.toMatchObject({ statusCode: 403 });
      expect(sawWrite).toBe(true);
      expect(await credential()).toBe(old);
      expect(await statuses()).toEqual([1, 1]);
    },
  );
  it("rolls back rotation when DTO projection fails, instead of leaving the caller with an unknown new credential", async () => {
    const old = await credential();
    await prisma.relayTokenQuotaWindow.create({
      data: { relayTokenId: first, quotaWindowHours: 1, quotaUnit: "requests", quotaLimit: 10 },
    });
    const usage = (await import("@/store/relay/relay-usage.repository")).RelayUsageRepository.getInstance();
    vi.spyOn(usage, "aggregateByRelayTokenIds").mockRejectedValue(new Error("fixture projection failure"));
    await expect(refresh()).rejects.toThrow("fixture projection failure");
    expect(await credential()).toBe(old);
  });
  it("rejects a token changed while entering its mutation boundary", async () => {
    const repo = RelayTokenMutationRepository.getInstance(),
      apply = repo.apply.bind(repo),
      old = await credential();
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayToken.update({ where: { id: first }, data: { name: "changed" } });
      return apply(...args);
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(await credential()).toBe(old);
  });
  it("requires persisted OAuth UPDATE and READ scopes for a full response", async () => {
    const req = await oauthRequest([Permission.RELAY_TOKEN_UPDATE]);
    req.oauthAccessToken!.scopes = [Permission.RELAY_TOKEN_UPDATE, Permission.RELAY_TOKEN_READ];
    await expect(refresh(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await refresh(first, undefined, await oauthRequest())).id).toBe(first);
  });
  it.each(["key", "oauth", "request"])(
    "rolls back rotation when %s authority changes during response construction",
    async (kind) => {
      const req = kind === "oauth" ? await oauthRequest() : request(),
        old = await credential();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
      const responses = RelayTokenMutationResponseRepository.getInstance(),
        read = responses.read.bind(responses);
      vi.spyOn(responses, "read").mockImplementation(async (tx, ...rest) => {
        const response = await read(tx, ...rest);
        if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "oauth")
          await tx.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { status: 0 } });
        else req.authContext!.accountOwnerId = foreign;
        return response;
      });
      await expect(refresh(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(await credential()).toBe(old);
    },
  );
  it("uses current assumed-role grants instead of the user's lifecycle grants", async () => {
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
    await expect(refresh(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    for (const action of ["RefreshToken", "GetToken", "RevealToken"])
      await grant("quyan:relay:" + action, relayTokenArn(owner, actor, first), "Allow", { type: "role", id: role.id });
    expect((await refresh(first, undefined, req)).id).toBe(first);
    const old = await credential();
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(refresh(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await credential()).toBe(old);
  });
  it("does not put old or new credentials into success audit records", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation"),
      old = await credential(),
      result = await refresh();
    expect(audit).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(audit.mock.calls);
    expect(serialized).not.toContain(old);
    expect(serialized).not.toContain(result.token!);
    expect(serialized).not.toContain("fixture-private-secret");
  });
  it("shadow performs no native rotation or response hydration and invokes legacy exactly once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const core = vi.spyOn(RelayTokenMutationRepository.getInstance(), "apply"),
      response = vi.spyOn(RelayTokenMutationResponseRepository.getInstance(), "read"),
      legacy = vi.spyOn(RelayTokenRepository.getInstance(), "update");
    await refresh();
    expect(core.mock.calls[0]![3]).toBe(false);
    expect(response).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
  });
});
