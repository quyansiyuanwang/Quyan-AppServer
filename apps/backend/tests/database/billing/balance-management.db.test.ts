import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BALANCE_OVERDRAFT_RULE, Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { BalanceManagementService } from "@/services/billing/balance-management.service";
import { BalanceManagementIamService, managedBalanceArn } from "@/services/billing/balance-management-iam.service";
import { BalanceManagementRepository } from "@/store/billing/balance-management.repository";
import { BalanceOverdraftRepository } from "@/store/billing/balance-overdraft.repository";
import { applyBalanceAccountMutation } from "@/store/billing/balance-account-mutation";
import { BalanceTransferRepository } from "@/store/billing/balance-transfer.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const previousMode = env.security.iamAuthorizationMode;
const service = BalanceManagementService.getInstance();
let actor: string, target: string, second: string, groupId: string;
const permissions = [
  Permission.BALANCE_MANAGEMENT_READ,
  Permission.BALANCE_ACCOUNT_ADJUST,
  Permission.BALANCE_OVERDRAFT_MANAGE,
];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: actor },
    headers: {},
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const group = await prisma.group.create({
    data: {
      username: "overdraft-fixture-" + randomUUID(),
      name: "Overdraft fixture manager",
      accountOwnerId: null,
      permissions,
    },
  });
  groupId = group.id;
  const user = async (group?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "overdraft-fixture-" + randomUUID(),
          password: "fixture-only",
          groupId: group,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  actor = await user(groupId);
  target = await user();
  second = await user();
  for (const userId of [target, second])
    await prisma.balanceAccount.create({ data: { userId, balance: 10, totalRecharged: 100, totalUsed: 90 } });
});
afterEach(() => {
  env.security.iamAuthorizationMode = previousMode;
  vi.restoreAllMocks();
});
const correction = () => ({
  userId: target,
  operationId: randomUUID(),
  reason: "Fixture correction",
  totalRecharged: { mode: "set" as const, value: 200, expected: 100 },
});
async function deny(resource: string, action: string) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: actor,
    name: "overdraft-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: actor },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: actor,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: actor,
    },
  });
}
describe("platform account correction and overdraft persistence", () => {
  it("corrects only recharge, records zero-change ledger and audit, and deduplicates retries", async () => {
    const body = correction();
    const first = await service.adjust(body, request());
    const secondResult = await service.adjust(body, request());
    expect(secondResult).toEqual(first);
    const account = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } });
    expect(Number(account.balance)).toBe(10);
    expect(Number(account.totalRecharged)).toBe(200);
    expect(Number(account.totalUsed)).toBe(90);
    expect(await prisma.balanceAccountAdjustment.count({ where: { userId: target } })).toBe(1);
    const ledger = await prisma.balanceTransaction.findMany({ where: { userId: target } });
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0]!.amount)).toBe(0);
    expect(
      await prisma.businessLog.count({ where: { targetUserId: target, operationType: "BALANCE_ACCOUNT_ADJUST" } }),
    ).toBe(1);
  });
  it("rejects stale targets and negative statistics without any ledger", async () => {
    await prisma.balanceAccount.update({ where: { userId: target }, data: { totalRecharged: 101 } });
    await expect(service.adjust(correction(), request())).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service.adjust({ ...correction(), totalRecharged: { mode: "delta", value: -102 } }, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.balanceTransaction.count({ where: { userId: target } })).toBe(0);
  });
  it("refuses reuse of an operation ID with different data", async () => {
    const body = correction();
    await service.adjust(body, request());
    await expect(service.adjust({ ...body, reason: "different" }, request())).rejects.toMatchObject({
      statusCode: 409,
    });
  });
  it("serializes delta corrections with another balance writer", async () => {
    await Promise.all([
      service.adjust(
        { userId: target, operationId: randomUUID(), reason: "Fixture delta", balance: { mode: "delta", value: 5 } },
        request(),
      ),
      prisma.$transaction((tx) => applyBalanceAccountMutation(tx, { userId: target, balanceDelta: -2 })),
    ]);
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } })).balance)).toBe(13);
  });
  it("rolls back the whole batch when one policy version is stale", async () => {
    const defaults = await service.defaults(request());
    await expect(
      service.saveUsers(
        {
          targets: [
            { userId: target, version: 0 },
            { userId: second, version: 1 },
          ],
          defaultVersion: defaults.version,
          rule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "fixed", fixedAmount: 20 },
        },
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } })).overdraftRule).toBeNull();
  });
  it("applies defaults dynamically, allows category overrides and independent reset", async () => {
    const defaults = await service.defaults(request());
    const updated = await service.saveDefaults(
      {
        version: defaults.version,
        rule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "percent", percent: 10 },
        categories: ["relay"],
      },
      request(),
    );
    const before = await service.preview({ userIds: [target] }, request());
    expect(before[0]!.overdraftLimit).toBe(10);
    await service.saveUsers(
      { targets: [{ userId: target, version: 0 }], defaultVersion: updated.version, categories: ["chat"] },
      request(),
    );
    const after = await service.preview({ userIds: [target] }, request());
    expect(after[0]!.ruleInherited).toBe(true);
    expect(after[0]!.categoriesInherited).toBe(false);
    await service.saveUsers(
      { targets: [{ userId: target, version: 1 }], defaultVersion: updated.version, categories: null },
      request(),
    );
    expect((await service.preview({ userIds: [target] }, request()))[0]!.categories).toEqual(["relay"]);
    await service.adjust(correction(), request());
    expect((await service.preview({ userIds: [target] }, request()))[0]!.overdraftLimit).toBe(20);
  });
  it("uses one shared credit balance and never allows gift withdrawal against credit", async () => {
    await prisma.balanceAccount.update({
      where: { userId: target },
      data: {
        balance: 0,
        overdraftRule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "fixed", fixedAmount: 10 },
        overdraftCategories: ["monthly_pass", "terminal"],
      },
    });
    const debit = (category: "monthly_pass" | "terminal", amount: number) =>
      prisma.$transaction((tx) =>
        applyBalanceAccountMutation(tx, { userId: target, balanceDelta: -amount, overdraftCategory: category }),
      );
    expect(await debit("monthly_pass", 6)).not.toBeNull();
    expect(await debit("terminal", 5)).toBeNull();
    expect(await debit("terminal", 4)).not.toBeNull();
    await expect(
      BalanceTransferRepository.getInstance().createGiftCode({
        senderId: target,
        code: randomUUID(),
        amount: 1,
        feeAmount: 0,
        feePercent: 0,
        cancelFeeRefundPercent: 0,
        totalDebit: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("fails closed for a formula that becomes invalid after statistics change", async () => {
    await prisma.balanceAccount.update({
      where: { userId: target },
      data: {
        totalRecharged: 100,
        overdraftRule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "formula", formula: "100 / (totalRecharged - 100)" },
      },
    });
    const result = await BalanceOverdraftRepository.getInstance().resolve(
      await prisma.balanceAccount.findUnique({ where: { userId: target } }),
    );
    expect(result.calculationError).toBe(true);
    expect(result.limit.toNumber()).toBe(0);
  });
  it("enforces explicit resource denial, missing context, and global-group ceiling", async () => {
    await deny(managedBalanceArn(target), "quyan:balance:AdjustAccount");
    await expect(service.adjust(correction(), request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.defaults({ headers: {} } as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: actor } });
    await expect(service.defaults(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("filters denied users before pagination and totals", async () => {
    await deny(managedBalanceArn(target), "quyan:balance:ListManagedAccounts");
    const result = await service.list({ userId: target }, request());
    expect(result.total).toBe(0);
    expect(result.records).toEqual([]);
  });
  it("rejects permission revocation and rolls back audit or final-check failures", async () => {
    const guard = await BalanceManagementIamService.getInstance().prepare("AdjustAccount", request(), [target]);
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await expect(
      BalanceManagementRepository.getInstance().adjust(correction(), guard, {
        requestId: "fixture-revoked",
        ipAddress: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccountAdjustment.count({ where: { userId: target } })).toBe(0);
  });
  it("previews statistic and credit changes without writing anything", async () => {
    await prisma.balanceAccount.update({
      where: { userId: target },
      data: { overdraftRule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "percent", percent: 10 } },
    });
    const trial = await service.previewAdjustment(correction(), request());
    expect(trial.before.totalRecharged).toBe(100);
    expect(trial.after.totalRecharged).toBe(200);
    expect(trial.before.overdraftLimit).toBe(10);
    expect(trial.after.overdraftLimit).toBe(20);
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } })).totalRecharged)).toBe(
      100,
    );
    expect(await prisma.balanceAccountAdjustment.count({ where: { userId: target } })).toBe(0);
  });
  it("rolls back money, correction records and ledgers when audit fails", async () => {
    vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockRejectedValueOnce(
      new Error("Fixture audit unavailable"),
    );
    await expect(service.adjust(correction(), request())).rejects.toThrow("Fixture audit unavailable");
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } })).totalRecharged)).toBe(
      100,
    );
    expect(await prisma.balanceAccountAdjustment.count({ where: { userId: target } })).toBe(0);
    expect(await prisma.balanceTransaction.count({ where: { userId: target } })).toBe(0);
  });
  it("rolls back the completed mutation if the final authorization recheck fails", async () => {
    const guard = await BalanceManagementIamService.getInstance().prepare("AdjustAccount", request(), [target]);
    const real = guard.recheck;
    let calls = 0;
    guard.recheck = async (tx) => {
      if (++calls === 2) throw iamAccountDenied();
      await real(tx);
    };
    await expect(
      BalanceManagementRepository.getInstance().adjust(correction(), guard, {
        requestId: "fixture-final-recheck",
        ipAddress: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } })).totalRecharged)).toBe(
      100,
    );
    expect(await prisma.balanceTransaction.count({ where: { userId: target } })).toBe(0);
  });
  it("separates correction, read and policy permissions", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.BALANCE_MANAGEMENT_READ] } });
    await expect(service.defaults(request())).resolves.toBeDefined();
    await expect(service.adjust(correction(), request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.previewAdjustment(correction(), request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.preview({ userIds: [target] }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects restoring an inherited formula that fails for one target", async () => {
    const defaults = await service.defaults(request());
    const saved = await service.saveDefaults(
      {
        ...defaults,
        rule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "formula", formula: "100 / (totalRecharged - 100)" },
      },
      request(),
    );
    await prisma.balanceAccount.update({
      where: { userId: target },
      data: { overdraftRule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "fixed", fixedAmount: 5 } },
    });
    await expect(
      service.saveUsers(
        { targets: [{ userId: target, version: 0 }], defaultVersion: saved.version, rule: null },
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: target } })).overdraftVersion).toBe(0);
  });
  it("keeps other carpool reservations inside the shared credit limit", async () => {
    await prisma.balanceAccount.update({
      where: { userId: target },
      data: {
        balance: 0,
        overdraftRule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "fixed", fixedAmount: 10 },
        overdraftCategories: ["monthly_pass", "carpool"],
      },
    });
    const monthly = await prisma.monthlyPassTemplate.create({
      data: { name: "Overdraft reservation fixture", defaultQuota: 100 },
    });
    const template = await prisma.carpoolPackageTemplate.create({
      data: {
        name: "Overdraft reservation fixture",
        salePrice: 10,
        upstreamCost: 5,
        maxMembers: 2,
        monthlyPassTemplateId: monthly.id,
        snapshotQuota: 100,
        snapshotValidityDays: 30,
      },
    });
    const order = await prisma.carpoolOrder.create({
      data: {
        ownerUserId: target,
        packageTemplateId: template.id,
        monthlyPassTemplateId: monthly.id,
        packageName: template.name,
        salePrice: 10,
        upstreamCost: 5,
        maxMembers: 2,
        totalQuota: 100,
        validityDays: 30,
        members: { create: { userId: target, role: "owner" } },
      },
      include: { members: true },
    });
    const reserved = await prisma.balanceReservation.create({
      data: { userId: target, orderId: order.id, memberId: order.members[0]!.id, amount: 6 },
    });
    const purchase = (amount: number) =>
      prisma.$transaction((tx) =>
        applyBalanceAccountMutation(tx, { userId: target, balanceDelta: -amount, overdraftCategory: "monthly_pass" }),
      );
    expect(await purchase(5)).toBeNull();
    expect((await purchase(4))?.balanceAfter.toNumber()).toBe(-4);
    const submitted = await prisma.$transaction((tx) =>
      applyBalanceAccountMutation(tx, {
        userId: target,
        balanceDelta: -6,
        overdraftCategory: "carpool",
        excludeReservationId: reserved.id,
      }),
    );
    expect(submitted?.balanceAfter.toNumber()).toBe(-10);
  });
});
