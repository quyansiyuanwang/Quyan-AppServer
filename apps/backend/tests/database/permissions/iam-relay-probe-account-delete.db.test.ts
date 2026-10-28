import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeAccountService } from "@/services/relay/relay-channel-probe-account.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RedisService } from "@/services/infrastructure/redis.service";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = RelayChannelProbeAccountService.getInstance();
let owner: string, actor: string, groupId: string, accounts: string[], prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const remove = (id = accounts[0]!) => service.remove(id, request());
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:DeleteProbeAccount", Resource: resource },
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
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "probe-delete-" + randomUUID();
  accounts = [];
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture probe manager",
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  for (const name of ["B", "A"])
    accounts.push(
      (
        await prisma.relayChannelProbeAccount.create({
          data: {
            name: prefix + name,
            tokenPath: "data.token",
            fallbackTtlSeconds: 30,
            minLoginIntervalSeconds: 60,
            encryptedCredentials: "fixture-encrypted-secret",
            credentialIv: "fixture-iv",
            credentialAuthTag: "fixture-tag",
            lastLoginAttemptAt: new Date(0),
          },
        })
      ).id,
    );
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannelProbeAccount.deleteMany({ where: { id: { in: accounts } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe account deletion transaction", () => {
  it("deletes only the permitted target and invalidates its session", async () => {
    const redis = vi.spyOn(RedisService.getInstance(), "delete").mockResolvedValue(1);
    await remove();
    expect(await prisma.relayChannelProbeAccount.findUnique({ where: { id: accounts[0] } })).toBeNull();
    expect(await prisma.relayChannelProbeAccount.count({ where: { id: accounts[1] } })).toBe(1);
    expect(redis).toHaveBeenCalledWith(expect.stringContaining(accounts[0]!));
  });
  it("explicit deny preserves the account and cache despite the legacy platform grant", async () => {
    await policy("Deny", platformRelayProbeAccountArn(accounts[0]!));
    const redis = vi.spyOn(RedisService.getInstance(), "delete");
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeAccount.count({ where: { id: accounts[0] } })).toBe(1);
    expect(redis).not.toHaveBeenCalled();
  });
  it("refuses to delete an account that still has a bound target", async () => {
    const channel = await prisma.relayChannel.create({ data: { name: prefix + "bound", allowedFormats: "openai" } });
    try {
      const profile = await prisma.relayChannelProbeProfile.create({
        data: { relayChannelId: channel.id, probeModel: "fixture-model", probePayload: {}, workflow: [] },
      });
      await prisma.relayChannelProbeTargetConfig.create({
        data: { profileId: profile.id, targetChannelId: channel.id, accountId: accounts[0] },
      });
      await expect(remove()).rejects.toMatchObject({ statusCode: 409 });
      expect(await prisma.relayChannelProbeAccount.count({ where: { id: accounts[0] } })).toBe(1);
    } finally {
      await prisma.relayChannel.delete({ where: { id: channel.id } });
    }
  });
  it("cannot manufacture platform qualification from an account Allow", async () => {
    await policy("Allow", "*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back a deletion if the final resource decision is revoked", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      transaction = prisma.$transaction.bind(prisma),
      deleted = vi.fn();
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const remove = tx.relayChannelProbeAccount.deleteMany.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "deleteMany").mockImplementation((args) => {
          deleted();
          return remove(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    let evaluations = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      evaluations++;
      // Initial, locked identity and pre-write checks pass; post-write check denies.
      return evaluations >= 4 ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    const redis = vi.spyOn(RedisService.getInstance(), "delete");
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(evaluations).toBeGreaterThanOrEqual(4);
    expect(deleted).toHaveBeenCalledOnce();
    expect(await prisma.relayChannelProbeAccount.count({ where: { id: accounts[0] } })).toBe(1);
    expect(redis).not.toHaveBeenCalled();
  });
  it("reads only the identifier and deletes without selecting any encrypted fields", async () => {
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelProbeAccountFindUniqueArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannelProbeAccount.findUnique.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "findUnique").mockImplementation((args) => {
          reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await remove();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((args) => JSON.stringify(args.select) === JSON.stringify({ id: true }))).toBe(true);
  });
  it("returns a safe missing-target error after authorization", async () => {
    await expect(remove("missing-account")).rejects.toMatchObject({ statusCode: 404 });
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps legacy mutation behavior in %s without preview writes",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorizeMany.bind(iam);
      if (mode === "shadow")
        vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
          expect(await prisma.relayChannelProbeAccount.count({ where: { id: accounts[0] } })).toBe(1);
          return original(input);
        });
      await remove();
      expect(await prisma.relayChannelProbeAccount.count({ where: { id: accounts[0] } })).toBe(0);
    },
  );
});
