import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenDeleteRepository } from "@/store/relay/relay-token-delete.repository";
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
const remove = (ids = [first, second], targetUserId?: string, req = request()) =>
  service().batchDeleteTokens({ ids, targetUserId }, actor, req);
const removeOne = (id = first, targetUserId?: string, req = request()) =>
  service().revokeToken(id, actor, req, targetUserId);
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
    data: { permissions: [Permission.RELAY_TOKEN_DELETE, Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE] },
  });
async function oauthRequest(scopes: string[] = [Permission.RELAY_TOKEN_DELETE]) {
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
  prefix = "token-delete-" + randomUUID();
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
        name: "Deletion fixture",
        permissions: [Permission.RELAY_TOKEN_DELETE],
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
describe("atomic resource-scoped token deletion", () => {
  it("deletes own tokens without granting any read/reveal permission or hydrating secrets", async () => {
    const trace = traceNativeMutation(),
      rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations");
    expect(await remove()).toEqual({ total: 2, affected: 2 });
    expect(await statuses()).toEqual([-1, -1]);
    expect(rich).not.toHaveBeenCalled();
    expect(trace.writes.called).toBe(true);
    expect(trace.selects.length).toBeGreaterThan(0);
    for (const select of trace.selects)
      expect(select).toEqual({ id: true, userId: true, status: true, updateTime: true });
  });
  it("single delete uses the same native mutation, and never calls a legacy GET afterward", async () => {
    const publicRead = vi.spyOn(RelayTokenService.prototype, "getToken");
    await removeOne();
    expect(await statuses()).toEqual([-1, 1]);
    expect(publicRead).not.toHaveBeenCalled();
  });
  it("supports an exact JSON-only deletion grant instead of requiring global legacy DELETE", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant("quyan:relay:DeleteToken", relayTokenArn(owner, actor, first), "Allow");
    await removeOne();
    await expect(removeOne(second)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([-1, 1]);
  });
  it("an explicit Deny of one selected resource prevents every write", async () => {
    await grant("quyan:relay:DeleteToken", relayTokenArn(owner, actor, second));
    const trace = traceNativeMutation();
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(trace.writes.called).toBe(false);
    expect(await statuses()).toEqual([1, 1]);
  });
  it("permissionRemoves is an explicit deletion Deny even for JSON Allow", async () => {
    await grant("quyan:relay:DeleteToken", "*", "Allow");
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_TOKEN_DELETE] } });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it.each(["missing", "alias", "peer", "deleted"])(
    "rejects an entire mixed batch containing a %s target",
    async (kind) => {
      let id =
        kind === "missing"
          ? "fixture-missing"
          : kind === "alias"
            ? second.toUpperCase()
            : kind === "peer"
              ? peerToken
              : second;
      if (kind === "deleted") await prisma.relayToken.update({ where: { id: second }, data: { status: -1 } });
      await expect(remove([first, id])).rejects.toMatchObject({ statusCode: 403 });
      expect((await statuses([first]))[0]).toBe(1);
    },
  );
  it("allows deletion of disabled or expired tokens but never resurrects deleted ones", async () => {
    await prisma.relayToken.update({ where: { id: first }, data: { status: 0, expiresAt: new Date(0) } });
    await removeOne();
    await expect(removeOne()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([-1, 1]);
  });
  it.each(
    [[], ["../id"], ["duplicate", "duplicate"], Array.from({ length: 201 }, (_, i) => "id-" + i)].map((ids) => ({
      ids,
    })),
  )("rejects invalid or oversized selections $ids", async ({ ids }) => {
    await expect(remove(ids)).rejects.toMatchObject({ statusCode: 400 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("keeps same-account peers behind the management ceiling", async () => {
    await grant("quyan:relay:*", "*", "Allow");
    await expect(remove([peerToken], peer)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not accept management READ qualification as management UPDATE", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_TOKEN_DELETE, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    await grant("quyan:relay:DeleteManagedToken", "*", "Allow");
    await expect(remove([foreignToken], foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses exact platform user/token grants for management of another account", async () => {
    await manager();
    expect(await remove([foreignToken], foreign)).toEqual({ total: 1, affected: 1 });
    expect(await statuses([foreignToken])).toEqual([-1]);
  });
  it("supports single-target owner inference without letting that create management qualification", async () => {
    await expect(removeOne(foreignToken)).rejects.toMatchObject({ statusCode: 403 });
    await manager();
    await removeOne(foreignToken);
    expect(await statuses([foreignToken])).toEqual([-1]);
  });
  it.each(["admission", "user", "token"])("denies management deletion when its %s resource is denied", async (kind) => {
    await manager();
    await grant(
      kind === "admission" ? "quyan:relay:DeleteToken" : "quyan:relay:DeleteManagedToken",
      kind === "admission"
        ? "*"
        : kind === "user"
          ? platformUserArn(foreign)
          : platformRelayTokenArn(foreign, foreignToken),
    );
    await expect(remove([foreignToken], foreign)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses([foreignToken])).toEqual([1]);
  });
  it("rejects mismatched supplied owners and case aliases even for platform managers", async () => {
    await manager();
    await expect(removeOne(first, peer)).rejects.toMatchObject({ statusCode: 403 });
    await expect(removeOne(first.toUpperCase())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["actor", "owner", "group"])("rejects a disabled %s before writing", async (kind) => {
    if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    else await prisma.user.update({ where: { id: kind === "actor" ? actor : owner }, data: { status: 0 } });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rechecks target metadata under the transaction locks", async () => {
    const repository = RelayTokenDeleteRepository.getInstance(),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (...args) => {
      await prisma.relayToken.update({ where: { id: second }, data: { name: "changed-before-lock" } });
      return original(...args);
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rechecks actor/group changes while entering the mutation boundary", async () => {
    const repository = RelayTokenDeleteRepository.getInstance(),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (...args) => {
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return original(...args);
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rolls back an already executed batch UPDATE when the final IAM decision is revoked", async () => {
    const { writes } = traceNativeMutation(),
      repository = RelayTokenDeleteRepository.getInstance(),
      capture = repository.snapshot.bind(repository);
    let sawDeleted = false;
    vi.spyOn(repository, "snapshot").mockImplementation(async (identity, tx) => {
      const result = await capture(identity, tx);
      if (tx && writes.called) {
        const rows = await tx.relayToken.findMany({ where: { id: { in: [first, second] } }, select: { status: true } });
        sawDeleted = rows.every((row) => row.status === -1);
      }
      return result;
    });
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      return writes.called ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(sawDeleted).toBe(true);
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rolls back the executed UPDATE if authenticated request identity changes", async () => {
    const req = request(),
      { writes } = traceNativeMutation(),
      repository = RelayTokenDeleteRepository.getInstance(),
      capture = repository.snapshot.bind(repository);
    vi.spyOn(repository, "snapshot").mockImplementation(async (...args) => {
      if (writes.called) req.authContext!.accountOwnerId = foreign;
      return capture(...args);
    });
    await expect(remove(undefined, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(writes.called).toBe(true);
    expect(await statuses()).toEqual([1, 1]);
  });
  it("checks persisted OAuth DELETE scope rather than READ or forged request scopes", async () => {
    const req = await oauthRequest([Permission.RELAY_TOKEN_READ]);
    req.oauthAccessToken!.scopes = [Permission.RELAY_TOKEN_DELETE];
    await expect(remove(undefined, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("OAuth DELETE scope is sufficient for own deletion without READ", async () => {
    const req = await oauthRequest();
    expect(await remove(undefined, undefined, req)).toEqual({ total: 2, affected: 2 });
  });
  it("OAuth management requires UPDATE scope on both token and app", async () => {
    await manager();
    const req = await oauthRequest();
    await expect(remove([foreignToken], foreign, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["token", "application", "expiry"])(
    "rechecks OAuth %s revocation before transaction writes",
    async (kind) => {
      const req = await oauthRequest(),
        repository = RelayTokenDeleteRepository.getInstance(),
        original = repository.remove.bind(repository);
      vi.spyOn(repository, "remove").mockImplementation(async (...args) => {
        if (kind === "application")
          await prisma.oAuthClient.update({ where: { id: req.oauthAccessToken!.oauthClientId }, data: { scopes: [] } });
        else
          await prisma.oAuthAccessToken.update({
            where: { id: req.oauthAccessToken!.id },
            data: kind === "expiry" ? { expiresAt: new Date(0) } : { revokedAt: new Date() },
          });
        return original(...args);
      });
      await expect(remove(undefined, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(await statuses()).toEqual([1, 1]);
    },
  );
  it("does not mistake OAuth last-used counters for changed authorization", async () => {
    const req = await oauthRequest(),
      repository = RelayTokenDeleteRepository.getInstance(),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (...args) => {
      await prisma.oAuthAccessToken.update({
        where: { id: req.oauthAccessToken!.id },
        data: { lastUsedAt: new Date() },
      });
      return original(...args);
    });
    expect(await remove(undefined, undefined, req)).toEqual({ total: 2, affected: 2 });
  });
  it.each(["revoked", "foreign", "expired"])("fails closed for an AccessKey that is %s", async (kind) => {
    const key = await prisma.accessKey.create({
      data: {
        userId: kind === "foreign" ? peer : actor,
        key: "fixture-only-" + randomUUID(),
        expiresAt: kind === "expired" ? new Date(0) : null,
        status: kind === "revoked" ? 0 : 1,
      },
    });
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    await expect(remove(undefined, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rechecks AccessKey revision after waiting for the mutation boundary", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-only-" + randomUUID() } }),
      req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    const repository = RelayTokenDeleteRepository.getInstance(),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (...args) => {
      await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
      return original(...args);
    });
    await expect(remove(undefined, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("uses assumed-role policies and current sessions, not the user's DELETE grant", async () => {
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
    await expect(removeOne(first, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:relay:DeleteToken", relayTokenArn(owner, actor, first), "Allow", { type: "role", id: role.id });
    await removeOne(first, undefined, req);
    await grant("quyan:relay:DeleteToken", relayTokenArn(owner, actor, second), "Allow", { type: "role", id: role.id });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(removeOne(second, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not delete parent composition configuration or expose member secrets", async () => {
    await prisma.relayTokenMemberConfig.create({ data: { parentTokenId: second, tokenId: first, priority: 0 } });
    await removeOne();
    expect(await prisma.relayTokenMemberConfig.count({ where: { parentTokenId: second, tokenId: first } })).toBe(1);
    expect(await statuses()).toEqual([-1, 1]);
  });
  it("shadow performs no native write and executes legacy deletion only once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const native = vi.spyOn(RelayTokenDeleteRepository.getInstance(), "remove"),
      legacy = vi.spyOn(RelayTokenRepository.getInstance(), "deleteByIdsForScope");
    const trace = traceNativeMutation();
    expect(await remove()).toEqual({ total: 2, affected: 2 });
    expect(trace.writes.called).toBe(false);
    expect(native.mock.calls[0]![2]).toBe(false);
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("legacy avoids the native transaction and preserves its old guard", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const native = vi.spyOn(RelayTokenDeleteRepository.getInstance(), "remove");
    await removeOne();
    expect(native).not.toHaveBeenCalled();
  });
  it("requires trusted request identity in enforce mode", async () => {
    await expect(service().batchDeleteTokens({ ids: [first] }, actor)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
  it("rechecks a row changed by the holder of its SQL lock before applying deletion", async () => {
    let ready!: () => void, start!: () => void;
    const locked = new Promise<void>((resolve) => {
        ready = resolve;
      }),
      started = new Promise<void>((resolve) => {
        start = resolve;
      });
    const original = prisma.$transaction.bind(prisma);
    const holder = original(async (tx) => {
      await tx.$queryRaw`SELECT id FROM relay_tokens WHERE id=${second} FOR UPDATE`;
      ready();
      await started;
      await tx.relayToken.update({ where: { id: second }, data: { name: "changed-under-lock" } });
    });
    await locked;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      original(async (tx) => {
        const raw = tx.$queryRaw.bind(tx);
        vi.spyOn(tx, "$queryRaw").mockImplementation((...args) => {
          const query = args[0];
          if ("sql" in query && query.sql.includes("FROM relay_tokens")) start();
          return raw(...args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const deletion = remove().then(
      () => ({ statusCode: 0 }),
      (error) => error as { statusCode: number },
    );
    try {
      await holder;
      expect(await deletion).toMatchObject({ statusCode: 403 });
      expect(await statuses()).toEqual([1, 1]);
    } finally {
      start();
      await holder.catch(() => {});
    }
  });
  it("rechecks a role session revoked at the transaction boundary", async () => {
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
    await grant("quyan:relay:DeleteToken", "*", "Allow", { type: "role", id: role.id });
    const repository = RelayTokenDeleteRepository.getInstance(),
      original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (...args) => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return original(...args);
    });
    await expect(remove(undefined, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await statuses()).toEqual([1, 1]);
  });
});
