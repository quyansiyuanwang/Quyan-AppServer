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
const list = (page = 1, pageSize = 20) => service.listOwnEarnings(actor, page, pageSize, request());
async function policy(effect: "Allow" | "Deny", resources: string[]) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ListMyProviderEarnings", Resource: resources },
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
  prefix = "provider-earnings-" + randomUUID();
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
          permissionAdds: accountOwnerId ? [Permission.RELAY_CHANNEL_PROVIDER_READ] : [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
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
  }
  const settlement = await prisma.relayChannelProviderSettlement.create({
    data: { providerId: providers[0]!, amount: 3, settlementMode: "manual" },
  });
  for (const [index, amount] of [2, 3, 7, 99].entries()) {
    earnings.push(
      (
        await prisma.relayChannelProviderEarning.create({
          data: {
            providerId: providers[index < 2 ? 0 : index === 2 ? 1 : 2]!,
            relayUsageId: randomUUID(),
            grossAmount: amount * 4,
            commissionPercent: 25,
            commissionAmount: amount,
            createTime: new Date(Date.UTC(2026, 9, index + 1)),
            ...(index === 1 ? { settlementId: settlement.id, settledAt: new Date() } : {}),
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
  await prisma.relayChannel.deleteMany({ where: { id: { in: channels } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, other, owner] } } });
});
describe("provider earnings resource authorization", () => {
  it("isolates the user before computing totals and pagination", async () => {
    expect(await list(1, 1)).toMatchObject({
      total: 3,
      pendingAmount: 9,
      settledAmount: 3,
      records: [{ id: earnings[2] }],
    });
    expect(await list(3, 1)).toMatchObject({ total: 3, records: [{ id: earnings[0] }] });
    expect(JSON.stringify(await list())).not.toContain("fixture-only-secret");
  });
  it("excludes a denied earning from details count and every aggregate", async () => {
    await policy("Deny", [relayProviderEarningArn(owner, actor, earnings[2]!)]);
    expect(await list(1, 1)).toMatchObject({
      total: 2,
      pendingAmount: 2,
      settledAmount: 3,
      records: [{ id: earnings[1] }],
    });
  });
  it("excludes every contribution from a denied provider", async () => {
    await policy("Deny", [relayProviderArn(owner, actor, providers[0]!)]);
    expect(await list()).toMatchObject({
      total: 1,
      pendingAmount: 7,
      settledAmount: 0,
      records: [{ id: earnings[2] }],
    });
  });
  it("supports JSON-only grants scoped to one provider and one earning", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy("Allow", [
      relayProviderArn(owner, actor, providers[0]!),
      relayProviderEarningArn(owner, actor, earnings[1]!),
    ]);
    expect(await list()).toMatchObject({
      total: 1,
      pendingAmount: 0,
      settledAmount: 3,
      records: [{ id: earnings[1] }],
    });
  });
  it("requires both provider and earning grants", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy("Allow", [relayProviderEarningArn(owner, actor, earnings[0]!)]);
    expect(await list()).toMatchObject({ total: 0, pendingAmount: 0, settledAmount: 0, records: [] });
  });
  it("retains history from disabled providers", async () => {
    await prisma.relayChannelProvider.updateMany({ where: { userId: actor }, data: { status: 0 } });
    expect(await list()).toMatchObject({ total: 3, pendingAmount: 9, settledAmount: 3 });
  });
  it("excludes removed earnings", async () => {
    await prisma.relayChannelProviderEarning.update({ where: { id: earnings[0] }, data: { status: 0 } });
    expect(await list()).toMatchObject({ total: 2, pendingAmount: 7, settledAmount: 3 });
  });
  it("never reads denied amounts or channel details and uses safe selects", async () => {
    await policy("Deny", [relayProviderArn(owner, actor, providers[0]!)]);
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelProviderEarningFindManyArgs[] = [],
      details: Prisma.RelayChannelProviderEarningFindFirstArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannelProviderEarning.findMany.bind(tx.relayChannelProviderEarning),
          first = tx.relayChannelProviderEarning.findFirst.bind(tx.relayChannelProviderEarning);
        vi.spyOn(tx.relayChannelProviderEarning, "findMany").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        vi.spyOn(tx.relayChannelProviderEarning, "findFirst").mockImplementation((args) => {
          if (args) details.push(args);
          return first(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await list();
    const amounts = reads.filter((args) => args.select?.commissionAmount);
    expect(amounts).toHaveLength(1);
    expect(amounts[0]!.where?.id).toEqual({ in: [earnings[2]] });
    expect(details).toHaveLength(1);
    expect(details[0]!.where?.id).toBe(earnings[2]);
    expect(details[0]!.select?.provider).toEqual({
      select: { userId: true, relayChannel: { select: { id: true, name: true } } },
    });
  });
  it("rechecks all decisions including excluded resources before returning", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      count++;
      return count > 1 ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a disabled actor and forged account", async () => {
    const req = request();
    req.authContext!.accountOwnerId = other;
    await expect(service.listOwnEarnings(actor, 1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains legacy responses in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", [relayProviderArn(owner, actor, providers[0]!)]);
    expect(await list()).toMatchObject({ total: 3, pendingAmount: 9, settledAmount: 3 });
  });
});
