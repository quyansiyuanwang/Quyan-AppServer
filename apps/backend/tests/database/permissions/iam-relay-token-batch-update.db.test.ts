import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenMutationRepository } from "@/store/relay/relay-token-mutation.repository";
import { ContentSafetyService } from "@/services/system/content-safety.service";
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
const status = (ids = [first, second], enabled = false, targetUserId?: string, req = request()) =>
  service().batchSetTokenStatus({ ids, enabled, targetUserId }, actor, req);
const content = (
  ids = [first, second],
  mode: "snapshot" | "clear" = "snapshot",
  targetUserId?: string,
  req = request(),
) => service().batchContentSafety({ ids, mode, targetUserId }, actor, req);
const storedConfig = async (id = first) =>
  (await prisma.relayToken.findUniqueOrThrow({ where: { id }, select: { contentSafetyConfig: true } }))
    .contentSafetyConfig;
const fixturePolicy = { requestEnabled: true, requestAction: "block" as const };
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
    data: { permissions: [Permission.RELAY_TOKEN_UPDATE, Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE] },
  });
async function oauthRequest(scopes: string[] = [Permission.RELAY_TOKEN_UPDATE]) {
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
function traceNativeMutation() {
  const selects: unknown[] = [],
    writes: { called: boolean } = { called: false };
  const original = prisma.$transaction.bind(prisma);
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) =>
    original(async (tx) => {
      const findMany = tx.relayToken.findMany.bind(tx.relayToken),
        write = tx.relayToken.updateMany.bind(tx.relayToken);
      vi.spyOn(tx.relayToken, "findMany").mockImplementation((args) => {
        selects.push(args?.select);
        return findMany(args);
      });
      vi.spyOn(tx.relayToken, "updateMany").mockImplementation((args) => {
        writes.called = true;
        return write(args);
      });
      return callback(tx);
    }, options)) as typeof prisma.$transaction);
  return { selects, writes };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  vi.spyOn(ContentSafetyService.getInstance(), "getEffectivePolicy").mockResolvedValue(fixturePolicy as never);
  prefix = "token-batch-update-" + randomUUID();
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
        permissions: [Permission.RELAY_TOKEN_UPDATE],
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
describe("atomic resource-scoped token batch metadata updates", () => {
  it("updates own status without READ/Reveal or rich/secret hydration", async () => {
    const trace = traceNativeMutation(),
      rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    expect(await status()).toEqual({ total: 2, affected: 2 });
    expect(await statuses()).toEqual([0, 0]);
    expect(rich).not.toHaveBeenCalled();
    expect(trace.writes.called).toBe(true);
    for (const select of trace.selects)
      expect(select).toEqual({ id: true, userId: true, status: true, updateTime: true });
    expect(await status(undefined, true)).toEqual({ total: 2, affected: 2 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("writes and clears a target-owner safety snapshot without credentials", async () => {
    expect(await content()).toEqual({ total: 2, affected: 2 });
    expect(await storedConfig()).toEqual(fixturePolicy);
    expect(await storedConfig(second)).toEqual(fixturePolicy);
    expect(ContentSafetyService.getInstance().getEffectivePolicy).toHaveBeenCalledExactlyOnceWith(actor, null);
    expect(await content(undefined, "clear")).toEqual({ total: 2, affected: 2 });
    expect(await storedConfig()).toBeNull();
    expect(await statuses()).toEqual([1, 1]);
  });
  it("preserves unrelated configuration, credential and usage fields", async () => {
    const before = await prisma.relayToken.findUniqueOrThrow({ where: { id: first } });
    await status();
    await content();
    const after = await prisma.relayToken.findUniqueOrThrow({ where: { id: first } });
    expect({
      ...after,
      status: before.status,
      contentSafetyConfig: before.contentSafetyConfig,
      updateTime: before.updateTime,
    }).toEqual(before);
  });
  it.each(["status", "safety"])("accepts an exact JSON-only %s grant", async (operation) => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant(
      operation === "status" ? "quyan:relay:SetTokenStatus" : "quyan:relay:SetTokenContentSafety",
      relayTokenArn(owner, actor, first),
      "Allow",
    );
    expect(await (operation === "status" ? status([first]) : content([first]))).toEqual({ total: 1, affected: 1 });
    expect(await statuses([second])).toEqual([1]);
  });
  it.each(["status", "safety"])(
    "rejects one denied target and leaves the entire %s batch unchanged",
    async (operation) => {
      await grant(
        operation === "status" ? "quyan:relay:SetTokenStatus" : "quyan:relay:SetTokenContentSafety",
        relayTokenArn(owner, actor, second),
      );
      await expect(operation === "status" ? status() : content()).rejects.toMatchObject({ statusCode: 403 });
      expect(await statuses()).toEqual([1, 1]);
      expect(await storedConfig()).toBeNull();
    },
  );
  it("permissionRemoves deny beats the legacy UPDATE allowance", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_TOKEN_UPDATE] } });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it.each(["missing", "alias", "peer", "foreign", "deleted"])(
    "rejects mixed %s targets without partial writes",
    async (kind) => {
      let bad =
        kind === "peer"
          ? peerToken
          : kind === "foreign"
            ? foreignToken
            : kind === "alias"
              ? second.toUpperCase()
              : kind === "deleted"
                ? second
                : "missing";
      if (kind === "deleted") await prisma.relayToken.update({ where: { id: second }, data: { status: -1 } });
      await expect(status([first, bad])).rejects.toMatchObject({ statusCode: 403 });
      expect(await statuses([first])).toEqual([1]);
    },
  );
  it("does not resurrect deleted tokens but permits disabled and expired targets", async () => {
    await prisma.relayToken.updateMany({
      where: { id: { in: [first, second] } },
      data: { status: 0, expiresAt: new Date(0) },
    });
    await status(undefined, true);
    expect(await statuses()).toEqual([1, 1]);
    await prisma.relayToken.update({ where: { id: second }, data: { status: -1 } });
    await expect(content()).rejects.toMatchObject({ statusCode: 403 });
    expect(await storedConfig()).toBeNull();
  });
  it.each([[], ["same", "same"], Array.from({ length: 201 }, (_, i) => "id" + i)].map((ids) => ({ ids })))(
    "rejects malformed or oversized selections %j",
    async ({ ids }) => {
      await expect(status(ids)).rejects.toMatchObject({ statusCode: 400 });
      expect(await statuses()).toEqual([1, 1]);
    },
  );
  it("account wildcard cannot qualify peer management", async () => {
    await grant("quyan:relay:*", "*", "Allow");
    await expect(status([peerToken], false, peer)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses([peerToken])).toEqual([1]);
  });
  it("management READ does not qualify write operations", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_TOKEN_UPDATE, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    await expect(content([foreignToken], "snapshot", foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("qualified managers must authorize target platform resources and use target safety settings", async () => {
    await manager();
    expect(await status([peerToken], false, peer)).toEqual({ total: 1, affected: 1 });
    expect(await content([foreignToken], "snapshot", foreign)).toEqual({ total: 1, affected: 1 });
    expect(ContentSafetyService.getInstance().getEffectivePolicy).toHaveBeenCalledExactlyOnceWith(foreign, null);
    expect(await statuses([peerToken])).toEqual([0]);
    expect(await storedConfig(foreignToken)).toEqual(fixturePolicy);
  });
  it.each(["admission", "user", "token"])("enforces managed %s denial", async (kind) => {
    await manager();
    await grant(
      kind === "admission" ? "quyan:relay:SetTokenStatus" : "quyan:relay:SetManagedTokenStatus",
      kind === "admission" ? "*" : kind === "user" ? platformUserArn(peer) : platformRelayTokenArn(peer, peerToken),
    );
    await expect(status([peerToken], false, peer)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses([peerToken])).toEqual([1]);
  });
  it.each(["actor", "owner", "group"])("rejects disabled %s authority", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rejects metadata changed before transaction lock acquisition", async () => {
    const repo = RelayTokenMutationRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayToken.update({ where: { id: second }, data: { name: "changed" } });
      return apply(...args);
    });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it.each(["status", "safety"])(
    "rolls back already executed %s SQL when the final decision is revoked",
    async (operation) => {
      const trace = traceNativeMutation(),
        repo = RelayTokenMutationRepository.getInstance(),
        snapshot = repo.snapshot.bind(repo);
      let observed = false;
      vi.spyOn(repo, "snapshot").mockImplementation(async (identity, kind, tx) => {
        const result = await snapshot(identity, kind, tx);
        if (tx && trace.writes.called && !observed) {
          observed = true;
          if (operation === "status")
            expect(
              (await tx.relayToken.findUniqueOrThrow({ where: { id: first }, select: { status: true } })).status,
            ).toBe(0);
          else
            expect(
              (await tx.relayToken.findUniqueOrThrow({ where: { id: first }, select: { contentSafetyConfig: true } }))
                .contentSafetyConfig,
            ).toEqual(fixturePolicy);
          vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
            input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
          );
        }
        return result;
      });
      await expect(operation === "status" ? status() : content()).rejects.toMatchObject({ statusCode: 403 });
      expect(observed).toBe(true);
      expect(await statuses()).toEqual([1, 1]);
      expect(await storedConfig()).toBeNull();
    },
  );
  it("requires persisted UPDATE OAuth scopes, not forged request READ grants", async () => {
    const req = await oauthRequest([Permission.RELAY_TOKEN_READ]);
    req.oauthAccessToken!.scopes = [Permission.RELAY_TOKEN_UPDATE];
    await expect(status(undefined, false, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("accepts OAuth UPDATE without READ/Reveal", async () => {
    const req = await oauthRequest();
    expect(await content(undefined, "snapshot", undefined, req)).toEqual({ total: 2, affected: 2 });
  });
  it.each(["key", "oauth", "group"])("rechecks %s authority at mutation entry", async (kind) => {
    const req = kind === "oauth" ? await oauthRequest() : request();
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-only-" + randomUUID() } });
      req.authContext!.subjectType = "access_key";
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    }
    const repo = RelayTokenMutationRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      if (kind === "key") await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
      else if (kind === "oauth")
        await prisma.oAuthAccessToken.update({ where: { id: req.oauthAccessToken!.id }, data: { status: 0 } });
      else await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return apply(...args);
    });
    await expect(status(undefined, false, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("shadow leaves native writes disabled and invokes the legacy writer exactly once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const legacy = vi.spyOn(RelayTokenRepository.getInstance(), "updateStatusByIdsForScope");
    const core = vi.spyOn(RelayTokenMutationRepository.getInstance(), "apply");
    expect(await status()).toEqual({ total: 2, affected: 2 });
    expect(core.mock.calls[0]![3]).toBe(false);
    expect(legacy).toHaveBeenCalledOnce();
    expect(await statuses()).toEqual([0, 0]);
  });
});
