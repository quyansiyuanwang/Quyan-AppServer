import { randomUUID } from "node:crypto";
import type { SaveRelayChannelProbeAccountRequest } from "@/api/dto/relay/relay-channel-probe.dto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeAccountService } from "@/services/relay/relay-channel-probe-account.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import {
  platformRelayProbeAccountArn,
  platformRelayProbeAccountControlArn,
} from "@/iam/resources/platform-relay-probe-resources";
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
const create = (body: SaveRelayChannelProbeAccountRequest = input()) => service.save(body, undefined, request());
const originalMasterKey = env.relay.channelProbe.masterKey;
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:CreateProbeAccount", Resource: resource },
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
  prefix = "probe-create-" + randomUUID();
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
  await prisma.relayChannelProbeAccount.deleteMany({
    where: { OR: [{ id: { in: accounts } }, { name: { startsWith: prefix } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe account creation authorization", () => {
  it("creates a CUID resource with encrypted credentials and a public response", async () => {
    const result = await create();
    expect(result).toMatchObject({ name: input().name, hasCredentials: true, cached: false });
    expect(result.id).toMatch(/^[a-z][a-z0-9]{23}$/);
    expect(JSON.stringify(result)).not.toContain("fixture-password");
    expect(JSON.stringify(result)).not.toContain("fixture-workflow-secret");
    const row = await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.encryptedCredentials).not.toContain("fixture-");
    expect(await prisma.relayChannelProbeAccount.count({ where: { name: input().name } })).toBe(1);
  });
  it.each(["control", "created"])("refuses a deny on the %s resource before writing any credentials", async (scope) => {
    await policy(
      "Deny",
      scope === "control" ? platformRelayProbeAccountControlArn() : "acs:platform:*:platform:relay-probe-account/*",
    );
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeAccount.count({ where: { name: input().name } })).toBe(0);
  });
  it("keeps platform qualification independent from account policy grants", async () => {
    await policy("Allow", "*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back an inserted resource after a final resource deny", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      transaction = prisma.$transaction.bind(prisma),
      inserted = vi.fn();
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const insert = tx.relayChannelProbeAccount.create.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "create").mockImplementation((args) => {
          inserted();
          return insert(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    let evaluations = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (args) => {
      const rows = await original(args);
      evaluations++;
      return evaluations >= 4 ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(inserted).toHaveBeenCalledOnce();
    expect(await prisma.relayChannelProbeAccount.count({ where: { name: input().name } })).toBe(0);
  });
  it("checks the same reserved ARN in shadow before legacy creates that ID", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      transaction = prisma.$transaction.bind(prisma),
      writes = vi.fn(),
      resources: string[][] = [];
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (args) => {
      resources.push([...args.resources]);
      return original(args);
    });
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const insert = tx.relayChannelProbeAccount.create.bind(tx.relayChannelProbeAccount);
        vi.spyOn(tx.relayChannelProbeAccount, "create").mockImplementation((args) => {
          writes();
          return insert(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const result = await create();
    expect(writes).not.toHaveBeenCalled();
    expect(resources.length).toBeGreaterThan(1);
    expect(
      resources.every(
        (batch) =>
          batch.includes(platformRelayProbeAccountArn(result.id)) &&
          batch.includes(platformRelayProbeAccountControlArn()),
      ),
    ).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)("preserves the legacy creation outcome in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", "*");
    expect(await create()).toMatchObject({ name: input().name, hasCredentials: true });
  });
  it("reports missing credentials and duplicate names safely", async () => {
    await expect(create({ ...input(), credentials: undefined })).rejects.toMatchObject({ statusCode: 400 });
    await create();
    await expect(create()).rejects.toMatchObject({ statusCode: 409 });
  });
});
