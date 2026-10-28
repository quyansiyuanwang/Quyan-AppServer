import { BalanceRepository } from "@/store/billing/balance.repository";
import { IamAccountUserMutationService } from "@/services/users/iam-account-user-mutation.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { onlineUserArn } from "@/iam/resources/online-session-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, peer: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "balance-recharge-" + randomUUID(),
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
      name: "balance-recharge-" + randomUUID(),
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
const action = "quyan:balance:RechargeUserBalance";
const mutation = IamAccountUserMutationService.getInstance(),
  balances = BalanceRepository.getInstance();
const grant = () =>
  bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: onlineUserArn(owner, peer) } });
async function recharge(amount = 5, countAsStatistics = true) {
  const iamGuard = await mutation.prepare(action, peer, request());
  return balances.recharge({ userId: peer, amount, description: "fixture", countAsStatistics, iamGuard });
}
describe("transactional resource authorization for managed recharge", () => {
  it("rejects a role session revoked between authorization and the money transaction", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "recharge-role-" + randomUUID() },
    });
    const binding = await grant();
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext = { ...req.authContext!, assumedRoleId: role.id, roleSessionId: session.id };
    const iamGuard = await mutation.prepare(action, peer, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      balances.recharge({ userId: peer, amount: 5, countAsStatistics: true, iamGuard }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccount.findUnique({ where: { userId: peer } })).toBeNull();
  });
  it("serializes concurrent authorized adjustments without losing balances or ledger rows", async () => {
    await grant();
    const first = await mutation.prepare(action, peer, request()),
      second = await mutation.prepare(action, peer, request());
    await Promise.all([
      balances.recharge({ userId: peer, amount: 7.25, countAsStatistics: true, iamGuard: first }),
      balances.recharge({ userId: peer, amount: 2.75, countAsStatistics: true, iamGuard: second }),
    ]);
    const account = (await prisma.balanceAccount.findUnique({ where: { userId: peer } }))!;
    expect(Number(account.balance)).toBe(10);
    expect(Number(account.totalRecharged)).toBe(10);
    expect(await prisma.balanceTransaction.count({ where: { userId: peer } })).toBe(2);
  });

  it("preserves Decimal balances, positive recharge statistics and negative use statistics", async () => {
    await grant();
    expect(Number((await recharge(12.5)).balance)).toBe(12.5);
    const result = await recharge(-2.25);
    expect(Number(result.balance)).toBe(10.25);
    expect(Number(result.totalRecharged)).toBe(12.5);
    expect(Number(result.totalUsed)).toBe(2.25);
    expect(await prisma.balanceTransaction.count({ where: { userId: peer } })).toBe(2);
  });
  it("refuses a cross-account target even with a wildcard policy", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: "*" } });
    await expect(mutation.prepare(action, foreign, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccount.findUnique({ where: { userId: foreign } })).toBeNull();
  });
  it("explicit Deny prevents account creation and transaction rows", async () => {
    await grant();
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: onlineUserArn(owner, peer) } });
    await expect(recharge()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccount.findUnique({ where: { userId: peer } })).toBeNull();
    expect(await prisma.balanceTransaction.count({ where: { userId: peer } })).toBe(0);
  });
  it.each(["actor", "owner", "target"])("rejects a stale %s user revision inside the transaction", async (kind) => {
    await grant();
    const iamGuard = await mutation.prepare(action, peer, request()),
      id = kind === "actor" ? actor : kind === "owner" ? owner : peer;
    await prisma.user.update({ where: { id }, data: { updateTime: new Date(Date.now() + 2000) } });
    await expect(
      balances.recharge({ userId: peer, amount: 5, countAsStatistics: true, iamGuard }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccount.findUnique({ where: { userId: peer } })).toBeNull();
  });
  it("refuses revoked policy authorization after preparation", async () => {
    const binding = await grant(),
      iamGuard = await mutation.prepare(action, peer, request());
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(
      balances.recharge({ userId: peer, amount: 5, countAsStatistics: true, iamGuard }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccount.findUnique({ where: { userId: peer } })).toBeNull();
  });
  it("rolls back balance changes, counters and ledger rows when the final authorization check fails", async () => {
    await grant();
    await recharge(20);
    const iamGuard = await mutation.prepare(action, peer, request()),
      recheck = iamGuard.recheck;
    let checks = 0;
    iamGuard.recheck = async () => {
      if (++checks === 2) throw iamAccountDenied();
      await recheck();
    };
    await expect(
      balances.recharge({ userId: peer, amount: -7, countAsStatistics: true, iamGuard }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const account = (await prisma.balanceAccount.findUnique({ where: { userId: peer } }))!;
    expect(Number(account.balance)).toBe(20);
    expect(Number(account.totalUsed)).toBe(0);
    expect(await prisma.balanceTransaction.count({ where: { userId: peer } })).toBe(1);
  });
  it("keeps disabled balance accounts unchanged", async () => {
    await grant();
    await prisma.balanceAccount.create({ data: { userId: peer, balance: 20, status: 0 } });
    await expect(recharge()).rejects.toMatchObject({ statusCode: 403 });
    expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: peer } }))!.balance)).toBe(20);
    expect(await prisma.balanceTransaction.count({ where: { userId: peer } })).toBe(0);
  });
});
