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
const list = () => service.list(request());
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ListProbeAccounts", Resource: resource },
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
  prefix = "probe-read-" + randomUUID();
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
describe("probe account metadata authorization", () => {
  it("retains name ordering and public configuration without exposing credential material", async () => {
    const result = await list();
    expect(result.map((row) => row.id)).toEqual([accounts[1], accounts[0]]);
    expect(result.every((row) => row.hasCredentials && row.nextLoginAt?.getTime() === 60000)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-encrypted-secret");
    expect(JSON.stringify(result)).not.toContain("fixture-iv");
  });
  it("excludes denied accounts and never reads their configuration credentials or session", async () => {
    await policy("Deny", platformRelayProbeAccountArn(accounts[0]!));
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelProbeAccountFindManyArgs[] = [],
      counts: Prisma.RelayChannelProbeAccountCountArgs[] = [],
      redis = vi.spyOn(RedisService.getInstance(), "get");
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannelProbeAccount.findMany.bind(tx.relayChannelProbeAccount),
          count = tx.relayChannelProbeAccount.count.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "findMany").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        vi.spyOn(tx.relayChannelProbeAccount, "count").mockImplementation((args) => {
          if (args) counts.push(args);
          return count(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    expect((await list()).map((row) => row.id)).toEqual([accounts[1]]);
    const detail = reads.find((args) => args.select?.name);
    expect(detail?.where?.id).toEqual({ in: [accounts[1]] });
    expect(
      reads.every(
        (args) =>
          args.select &&
          !args.select.encryptedCredentials &&
          !args.select.credentialIv &&
          !args.select.credentialAuthTag,
      ),
    ).toBe(true);
    expect(counts.map((args) => args.where?.id)).toEqual([accounts[1]]);
    expect(redis.mock.calls.some(([key]) => key.includes(accounts[0]!))).toBe(false);
  });
  it("returns an empty list for an all-resource deny", async () => {
    await policy("Deny", "*");
    expect(await list()).toEqual([]);
  });
  it("does not manufacture platform qualification from account grants", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reports the actual credential presence without selecting ciphertext", async () => {
    await prisma.relayChannelProbeAccount.update({ where: { id: accounts[1] }, data: { encryptedCredentials: "" } });
    expect((await list()).find((row) => row.id === accounts[1])?.hasCredentials).toBe(false);
  });
  it("fails closed when an account decision changes before response", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      count++;
      return count > 1 ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy visibility in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", platformRelayProbeAccountArn(accounts[0]!));
    expect((await list()).map((row) => row.id)).toEqual([accounts[1], accounts[0]]);
  });
});
