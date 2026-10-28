import { BalanceTransactionIamService } from "@/services/billing/balance-transaction-iam.service";
import { BalanceTransactionManagementRepository } from "@/store/billing/balance-transaction-management.repository";
import { balanceTransactionArn } from "@/iam/resources/balance-transaction-resources";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "balance-ledger-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
});
const principal = (accountOwnerId = owner): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId,
  subjectType: "sub_user",
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "balance-ledger-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
const action = "quyan:balance:ListUserTransactions",
  service = BalanceTransactionIamService.getInstance(),
  repository = BalanceTransactionManagementRepository.getInstance();
const row = (userId = peer, createTime = new Date()) =>
  prisma.balanceTransaction.create({
    data: {
      userId,
      createTime,
      type: "recharge",
      amount: 5,
      balanceBefore: 10,
      balanceAfter: 15,
      description: "fixture",
    },
  });
describe("managed ledger ownership, scopes and safe display data", () => {
  it("filters token names before pagination and never follows a foreign related usage", async () => {
    const token = await prisma.relayToken.create({
      data: { userId: peer, name: "chosen", token: "fixture-" + randomUUID(), upstreamApiKey: "fixture-secret-only" },
    });
    const foreignToken = await prisma.relayToken.create({
      data: { userId: foreign, name: "foreign-private", token: "fixture-" + randomUUID() },
    });
    const usage = await prisma.relayUsage.create({
      data: {
        relayTokenId: token.id,
        path: "/fixture",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
        totalOutputTime: 15,
      },
    });
    const foreignUsage = await prisma.relayUsage.create({
      data: {
        relayTokenId: foreignToken.id,
        path: "/fixture",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
      },
    });
    const first = await row(peer, new Date(Date.now() - 3000)),
      second = await row(peer, new Date(Date.now() - 2000)),
      mismatched = await row(peer, new Date(Date.now() - 1000));
    await prisma.balanceTransaction.update({ where: { id: first.id }, data: { relatedId: usage.id } });
    await prisma.balanceTransaction.update({ where: { id: second.id }, data: { relatedId: usage.id } });
    await prisma.balanceTransaction.update({ where: { id: mismatched.id }, data: { relatedId: foreignUsage.id } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: action,
        Resource: "acs:balance:*:" + owner + ":transaction/" + peer + "/*",
      },
    });
    const result = await service.list({ page: 2, pageSize: 1, tokenName: "chosen" }, request());
    expect(result.total).toBe(2);
    expect(result.records.map((r) => r.id)).toEqual([first.id]);
    expect(result.display.usageDataMap.get(usage.id)?.totalOutputTime).toBe(15);
    expect(result.display.tokenNameMap.has(foreignUsage.id)).toBe(false);
    expect(JSON.stringify([...result.display.tokenNameMap])).not.toContain("foreign-private");
    expect(JSON.stringify(result.records)).not.toContain("fixture-secret-only");
  });

  it("limits scan to active users in the current account and filters grants before counting", async () => {
    const selected = await row(),
      denied = await row(actor),
      outside = await row(foreign);
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: balanceTransactionArn(owner, peer, selected.id) },
    });
    const result = await service.list({ page: 1, pageSize: 20 }, request());
    expect(result.total).toBe(1);
    expect(result.records.map((r) => r.id)).toEqual([selected.id]);
    const targets = await repository.scan(principal(), {
      page: 1,
      pageSize: 20,
      startTime: new Date(Date.now() - 60000),
    });
    expect(targets.map((r) => r.id).sort()).toEqual([selected.id, denied.id].sort());
    expect(targets.some((r) => r.id === outside.id)).toBe(false);
    expect(targets.every((r) => !("amount" in r) && !("description" in r))).toBe(true);
  });
  it("does not let a wildcard grant cross accounts or reveal denied totals", async () => {
    await row(peer);
    await row(foreign);
    await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: action, Resource: "*" },
        { Effect: "Deny", Action: action, Resource: "acs:balance:*:" + owner + ":transaction/" + peer + "/*" },
      ],
    });
    const result = await service.list({ page: 1, pageSize: 20 }, request());
    expect(result.total).toBe(0);
    expect(result.records).toEqual([]);
    await expect(service.list({ page: 1, pageSize: 20, userId: foreign }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("supports exact transaction resource-group scopes and checks current membership", async () => {
    const selected = await row(),
      ignored = await row(actor),
      arn = balanceTransactionArn(owner, peer, selected.id),
      groups = RamResourceGroupRepository.getInstance();
    const group = await groups.create({ accountOwnerId: owner, name: "ledger-" + randomUUID() });
    await groups.addMember({
      accountOwnerId: owner,
      resourceGroupId: group.id,
      resourceArn: arn,
      service: "balance",
      resourceType: "transaction",
      resourceId: peer + "/" + selected.id,
    });
    const binding = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: "acs:balance:*:" + owner + ":transaction/*/*" },
    });
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { scopeType: "resource-group", scopeKey: "resource-group:" + group.id, scopeResourceId: group.id },
    });
    const result = await service.list({ page: 1, pageSize: 20 }, request());
    expect(result.records.map((r) => r.id)).toEqual([selected.id]);
    expect(result.records.some((r) => r.id === ignored.id)).toBe(false);
    expect(await groups.resourceExistsInAccount(arn, owner)).toBe(true);
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(arn, owner)).toBe(false);
    expect((await service.list({ page: 1, pageSize: 20 }, request())).total).toBe(0);
  });
  it("honors the retention window, account status and optimistic ledger snapshot", async () => {
    const recent = await row(),
      old = await row(peer, new Date(Date.now() - 40 * 86400000));
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: "*" } });
    expect((await service.list({ page: 1, pageSize: 20 }, request())).records.map((r) => r.id)).toEqual([recent.id]);
    const target = { id: recent.id, userId: peer, createTime: recent.createTime, updateTime: recent.updateTime };
    await prisma.balanceTransaction.update({
      where: { id: recent.id },
      data: { updateTime: new Date(Date.now() + 1000) },
    });
    expect(await repository.hydrate(principal(), [target])).toEqual([]);
    expect(await repository.current(principal(), [target])).toEqual([]);
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.list({ page: 1, pageSize: 20 }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(old.id).toBeTruthy();
  });
});
