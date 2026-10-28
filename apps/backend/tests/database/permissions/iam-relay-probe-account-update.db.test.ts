import { randomUUID } from "node:crypto";
import type { SaveRelayChannelProbeAccountRequest } from "@/api/dto/relay/relay-channel-probe.dto";
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
const input = () => ({
  name: prefix + "updated",
  loginWorkflow: {
    method: "POST" as const,
    url: "https://example.com/login",
    headers: { "x-fixture-secret": "fixture-workflow-secret" },
  },
  tokenPath: "data.token",
  fallbackTtlSeconds: 300,
  minLoginIntervalSeconds: 60,
  credentials: { username: "fixture-user", password: "fixture-password" },
});
const update = (id = accounts[0]!, body: SaveRelayChannelProbeAccountRequest = input()) =>
  service.save(body, id, request());
const originalMasterKey = env.relay.channelProbe.masterKey;
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:UpdateProbeAccount", Resource: resource },
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
  env.relay.channelProbe.masterKey = "fixture-probe-encryption-key".repeat(4);
  prefix = "probe-update-" + randomUUID();
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
  env.relay.channelProbe.masterKey = originalMasterKey;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannelProbeAccount.deleteMany({ where: { id: { in: accounts } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe account update authorization", () => {
  it("updates only the target and returns no credentials or login workflow", async () => {
    const redis = vi.spyOn(RedisService.getInstance(), "delete").mockResolvedValue(1);
    const result = await update();
    expect(result).toMatchObject({ id: accounts[0], name: input().name, hasCredentials: true, cached: false });
    expect(JSON.stringify(result)).not.toContain("fixture-password");
    expect(JSON.stringify(result)).not.toContain("fixture-workflow-secret");
    const target = await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: accounts[0] } });
    expect(target.encryptedCredentials).not.toContain("fixture-");
    expect(target.encryptedCredentials).not.toBe("fixture-encrypted-secret");
    expect((await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: accounts[1] } })).name).toBe(
      prefix + "A",
    );
    expect(redis).toHaveBeenCalledWith(expect.stringContaining(accounts[0]!));
  });
  it("retains original variables when new credentials are omitted", async () => {
    await update();
    const noCredentials = { ...input(), name: prefix + "preserved", credentials: undefined };
    await update(accounts[0], noCredentials);
    const stored = await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: accounts[0] } });
    const { createHash, createDecipheriv } = await import("node:crypto");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(env.relay.channelProbe.masterKey).digest(),
      Buffer.from(stored.credentialIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(stored.credentialAuthTag, "base64"));
    const plain = JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(stored.encryptedCredentials, "base64")), decipher.final()]).toString(
        "utf8",
      ),
    );
    expect(plain.variables).toEqual(input().credentials);
    expect(plain.workflow).toEqual(noCredentials.loginWorkflow);
  });
  it("explicit Deny prevents updates and leaves the cached session untouched", async () => {
    await policy("Deny", platformRelayProbeAccountArn(accounts[0]!));
    const redis = vi.spyOn(RedisService.getInstance(), "delete");
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: accounts[0] } })).name).toBe(
      prefix + "B",
    );
    expect(redis).not.toHaveBeenCalled();
  });
  it("cannot manufacture platform qualification from an account grant", async () => {
    await policy("Allow", "*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back persisted ciphertext when the final grant is revoked", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      transaction = prisma.$transaction.bind(prisma),
      written = vi.fn();
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const updateRow = tx.relayChannelProbeAccount.update.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "update").mockImplementation((args) => {
          written();
          return updateRow(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    let evaluations = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (args) => {
      const rows = await original(args);
      evaluations++;
      return evaluations >= 5 ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    const redis = vi.spyOn(RedisService.getInstance(), "delete");
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(written).toHaveBeenCalledOnce();
    expect(
      (await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: accounts[0] } })).encryptedCredentials,
    ).toBe("fixture-encrypted-secret");
    expect(redis).not.toHaveBeenCalled();
  });
  it("replaces credentials without reading an old encrypted value", async () => {
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
        const findRequired = tx.relayChannelProbeAccount.findUniqueOrThrow.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "findUniqueOrThrow").mockImplementation((args) => {
          reads.push(args);
          return findRequired(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await update();
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(
        (args) =>
          args.select &&
          !args.select.encryptedCredentials &&
          !args.select.credentialIv &&
          !args.select.credentialAuthTag,
      ),
    ).toBe(true);
  });
  it("rejects duplicate names with a safe conflict and no cache invalidation", async () => {
    const redis = vi.spyOn(RedisService.getInstance(), "delete");
    await expect(update(accounts[0], { ...input(), name: prefix + "A" })).rejects.toMatchObject({ statusCode: 409 });
    expect(redis).not.toHaveBeenCalled();
  });
  it("rejects missing targets and malformed configuration", async () => {
    await expect(update("missing-account")).rejects.toMatchObject({ statusCode: 404 });
    await expect(update(accounts[0], { ...input(), tokenPath: "" })).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["legacy", "shadow"] as const)("retains the original permission outcome in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", "*");
    expect(await update()).toMatchObject({ id: accounts[0], name: input().name });
  });
  it("keeps the shadow preview free of secret reads and writes", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const transaction = prisma.$transaction.bind(prisma),
      writes = vi.fn(),
      reads: Prisma.RelayChannelProbeAccountFindUniqueOrThrowArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const updateRow = tx.relayChannelProbeAccount.update.bind(tx.relayChannelProbeAccount),
          find = tx.relayChannelProbeAccount.findUniqueOrThrow.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "update").mockImplementation((args) => {
          writes();
          return updateRow(args);
        });
        vi.spyOn(tx.relayChannelProbeAccount, "findUniqueOrThrow").mockImplementation((args) => {
          reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await update();
    expect(writes).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });
});
