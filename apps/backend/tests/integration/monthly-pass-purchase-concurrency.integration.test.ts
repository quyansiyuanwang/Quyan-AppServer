import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database";
import { MonthlyPassRepository } from "../../src/store/billing/monthly-pass.repository";
import { MANAGED_STATUS } from "../../src/constant/status";

const repository = MonthlyPassRepository.getInstance();
const fixtureIds: { userId?: string; groupId?: string; templateId?: string } = {};

describe("MonthlyPassRepository concurrent purchase", () => {
  afterEach(async () => {
    if (fixtureIds.userId) {
      await prisma.balanceTransaction.deleteMany({ where: { userId: fixtureIds.userId } });
      await prisma.userMonthlyPass.deleteMany({ where: { userId: fixtureIds.userId } });
      await prisma.balanceAccount.deleteMany({ where: { userId: fixtureIds.userId } });
      await prisma.user.deleteMany({ where: { id: fixtureIds.userId } });
    }
    if (fixtureIds.templateId) await prisma.monthlyPassTemplate.deleteMany({ where: { id: fixtureIds.templateId } });
    if (fixtureIds.groupId) await prisma.group.deleteMany({ where: { id: fixtureIds.groupId } });
    fixtureIds.userId = undefined;
    fixtureIds.groupId = undefined;
    fixtureIds.templateId = undefined;
  });

  it("serializes same-user purchases so only one charge and pass are committed", async () => {
    const suffix = randomUUID();
    const group = await prisma.group.create({
      data: {
        username: `monthly-pass-group-${suffix}`,
        permissions: [],
        level: 1,
      },
    });
    fixtureIds.groupId = group.id;

    const user = await prisma.user.create({
      data: {
        username: `monthly-pass-user-${suffix}`,
        password: "test-password-hash",
        groupId: group.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    fixtureIds.userId = user.id;

    const template = await prisma.monthlyPassTemplate.create({
      data: {
        name: `Concurrent Pass ${suffix}`,
        defaultQuota: 100,
        quotaUnit: "amount",
        discountedPrice: 10,
        rechargeRatio: 1,
        publishStatus: "published",
        publishedAt: new Date(),
        purchaseLimitPerUser: 1,
        purchaseLimitWindowDays: 30,
        allowBalanceRedemption: true,
      },
    });
    fixtureIds.templateId = template.id;

    await prisma.balanceAccount.create({
      data: { userId: user.id, balance: 20, totalUsed: 0 },
    });

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const windowStart = new Date(startAt.getTime() - 30 * 24 * 60 * 60 * 1000);
    const purchase = () =>
      repository.purchaseUserPass(
        {
          userId: user.id,
          templateId: template.id,
          startAt,
          endAt,
          totalQuota: 100,
          dailyQuota: null,
          quotaUnit: "amount",
          quotaWindowHours: null,
          usedQuota: 0,
          remainingQuota: 100,
          status: MANAGED_STATUS.ENABLED,
        },
        [],
        {
          userId: user.id,
          purchaseAmount: 10,
          templateName: template.name,
          templateId: template.id,
          limit: { maximum: 1, windowStart },
        },
      );

    const results = await Promise.allSettled([purchase(), purchase()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect(String((rejected as PromiseRejectedResult).reason?.message)).toContain("purchase limit exceeded");

    const [passCount, account, transactions] = await Promise.all([
      prisma.userMonthlyPass.count({ where: { userId: user.id, templateId: template.id } }),
      prisma.balanceAccount.findUniqueOrThrow({ where: { userId: user.id } }),
      prisma.balanceTransaction.findMany({
        where: { userId: user.id, relatedId: template.id, type: "monthly_pass_purchase" },
      }),
    ]);

    expect(passCount).toBe(1);
    expect(Number(account.balance)).toBe(10);
    expect(Number(account.totalUsed)).toBe(10);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0]!.amount)).toBe(-10);
    expect(Number(transactions[0]!.balanceBefore)).toBe(20);
    expect(Number(transactions[0]!.balanceAfter)).toBe(10);
    expect(transactions[0]!.model).toBe("monthly_pass");
  });
});
