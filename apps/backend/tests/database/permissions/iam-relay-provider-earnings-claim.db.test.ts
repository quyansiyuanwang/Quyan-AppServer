import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProviderRevenueService } from "@/services/relay/relay-channel-provider-revenue.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayProviderArn, relayProviderEarningArn } from "@/iam/resources/relay-provider-resources";
import { balanceAccountArn } from "@/iam/resources/balance-resources";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = RelayChannelProviderRevenueService.getInstance();
let owner: string,
  actor: string,
  other: string,
  channels: string[],
  providers: string[],
  earnings: string[],
  prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const claim = () => service.claimOwnEarnings(actor, request());
async function policy(effect: "Allow" | "Deny", resources: string[]) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ClaimMyProviderEarnings", Resource: resources },
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
async function balance() {
  return prisma.balanceAccount.findUnique({ where: { userId: actor } });
}
async function unchanged() {
  const account = await balance();
  expect(Number(account?.balance)).toBe(10);
  expect(Number(account?.totalCommissionEarned)).toBe(0);
  expect(await prisma.relayChannelProviderSettlement.count({ where: { providerId: { in: providers } } })).toBe(0);
  expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(0);
  expect(
    await prisma.relayChannelProviderEarning.count({ where: { id: { in: earnings }, settlementId: { not: null } } }),
  ).toBe(0);
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "provider-claim-" + randomUUID();
  channels = [];
  providers = [];
  earnings = [];
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: accountOwnerId ? [Permission.RELAY_CHANNEL_PROVIDER_SETTLE] : [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  await prisma.balanceAccount.create({ data: { userId: actor, balance: 10 } });
  for (const index of [0, 1, 2]) {
    const channel = await prisma.relayChannel.create({
      data: { name: prefix + index, openaiUpstreamApiKey: "fixture-only-secret" },
    });
    channels.push(channel.id);
    const provider = await prisma.relayChannelProvider.create({
      data: {
        relayChannelId: channel.id,
        userId: index < 2 ? actor : other,
        commissionPercent: 25,
        settlementMode: "manual",
      },
    });
    providers.push(provider.id);
    earnings.push(
      (
        await prisma.relayChannelProviderEarning.create({
          data: {
            providerId: provider.id,
            relayUsageId: randomUUID(),
            grossAmount: index === 0 ? 8 : 28,
            commissionPercent: 25,
            commissionAmount: index === 0 ? 2 : 7,
          },
        })
      ).id,
    );
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.balanceTransaction.deleteMany({ where: { userId: { in: [actor, other] } } });
  await prisma.balanceAccount.deleteMany({ where: { userId: { in: [actor, other] } } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channels } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, other, owner] } } });
});
describe("atomic provider earnings claims", () => {
  it("credits every own manual provider once and preserves foreign earnings", async () => {
    expect(await claim()).toMatchObject({ settledAmount: 9, settlementId: expect.any(String) });
    expect(Number((await balance())?.balance)).toBe(19);
    expect(Number((await balance())?.totalCommissionEarned)).toBe(9);
    expect(await prisma.balanceTransaction.count({ where: { userId: actor, type: "channel_commission" } })).toBe(2);
    expect(
      (await prisma.relayChannelProviderEarning.findUnique({ where: { id: earnings[2] } }))?.settlementId,
    ).toBeNull();
    expect(await claim()).toEqual({ settledAmount: 0 });
    expect(Number((await balance())?.balance)).toBe(19);
  });
  it("checks every provider before any financial write", async () => {
    await policy("Deny", [relayProviderArn(owner, actor, providers[1]!)]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("checks every earning before any financial write", async () => {
    await policy("Deny", [relayProviderEarningArn(owner, actor, earnings[1]!)]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects a denied balance account", async () => {
    await policy("Deny", [balanceAccountArn(owner, actor)]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it.each(["acs:relay:*:OWNER:provider-settlement/ACTOR/*", "acs:balance:*:OWNER:transaction/ACTOR/*"])(
    "rolls back balance and every provider on a generated resource denial: %s",
    async (pattern) => {
      await policy("Deny", [pattern.replace("OWNER", owner).replace("ACTOR", actor)]);
      await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
      await unchanged();
    },
  );
  it("rolls back the first provider if the second generated ledger is denied", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let generated = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (
        input.resources.some((resource) => resource.includes(":transaction/")) &&
        input.resources.length === 1 &&
        ++generated === 2
      )
        return result.map((row) => ({ ...row, decision: "ExplicitDeny" as const }));
      return result;
    });
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rolls back even a first-time balance account on ledger denial", async () => {
    await prisma.balanceAccount.delete({ where: { userId: actor } });
    await policy("Deny", ["acs:balance:*:" + owner + ":transaction/" + actor + "/*"]);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    expect(await balance()).toBeNull();
    expect(await prisma.relayChannelProviderSettlement.count({ where: { providerId: { in: providers } } })).toBe(0);
  });
  it("creates the balance account only when the complete claim is authorized", async () => {
    await prisma.balanceAccount.delete({ where: { userId: actor } });
    expect(await claim()).toMatchObject({ settledAmount: 9 });
    expect(Number((await balance())?.balance)).toBe(9);
    expect(Number((await balance())?.totalCommissionEarned)).toBe(9);
  });
  it("supports a JSON-only grant covering the exact providers and earnings plus generated children", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy("Allow", [
      balanceAccountArn(owner, actor),
      ...providers.slice(0, 2).map((id) => relayProviderArn(owner, actor, id)),
      ...earnings.slice(0, 2).map((id) => relayProviderEarningArn(owner, actor, id)),
      "acs:relay:*:" + owner + ":provider-settlement/" + actor + "/*",
      "acs:balance:*:" + owner + ":transaction/" + actor + "/*",
    ]);
    expect(await claim()).toMatchObject({ settledAmount: 9 });
  });
  it("ignores disabled and automatic providers for manual claims", async () => {
    await prisma.relayChannelProvider.update({ where: { id: providers[0] }, data: { status: 0 } });
    await prisma.relayChannelProvider.update({ where: { id: providers[1] }, data: { settlementMode: "realtime" } });
    expect(await claim()).toEqual({ settledAmount: 0 });
    await unchanged();
  });
  it("rejects a disabled balance account or claimant", async () => {
    await prisma.balanceAccount.update({ where: { userId: actor }, data: { status: 0 } });
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("detects a corrupt balance write and rolls back the whole claim", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const update = tx.balanceAccount.update.bind(tx.balanceAccount);
        vi.spyOn(tx.balanceAccount, "update").mockImplementation((args) =>
          update({ ...args, data: { ...args.data, balance: 500 } }),
        );
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rechecks all source and generated decisions before commit", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return input.resources.length > 3 && input.resources.some((resource) => resource.includes(":transaction/"))
        ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : result;
    });
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it.each(["legacy", "shadow"] as const)(
    "retains legacy settlement behavior without native duplicate writes in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      await policy("Deny", ["acs:balance:*:" + owner + ":transaction/" + actor + "/*"]);
      expect(await claim()).toMatchObject({ settledAmount: 9 });
      expect(Number((await balance())?.balance)).toBe(19);
      expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(2);
    },
  );
  it("preserves scheduled settlement and advances its next settlement time", async () => {
    const now = new Date("2026-10-15T05:00:00.000Z");
    await prisma.relayChannelProvider.update({
      where: { id: providers[1] },
      data: {
        settlementMode: "interval",
        settlementIntervalDays: 2,
        nextSettlementAt: new Date(now.getTime() - 1000),
      },
    });
    await service.runScheduledSettlements(now);
    expect(Number((await balance())?.balance)).toBe(17);
    expect((await prisma.relayChannelProvider.findUnique({ where: { id: providers[1] } }))?.nextSettlementAt).toEqual(
      new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
    );
    expect(await claim()).toMatchObject({ settledAmount: 2 });
    expect(Number((await balance())?.balance)).toBe(19);
  });
  it("preserves automatic settlement through the shared writer", async () => {
    await prisma.relayChannelProvider.update({ where: { id: providers[0] }, data: { settlementMode: "realtime" } });
    await prisma.$transaction((tx) =>
      service.recordChargedUsage(tx, { relayUsageId: randomUUID(), relayChannelId: channels[0]!, grossAmount: 0.0012 }),
    );
    expect(Number((await balance())?.balance)).toBe(10.0003);
    expect(Number((await balance())?.totalCommissionEarned)).toBe(0.0003);
  });
});
