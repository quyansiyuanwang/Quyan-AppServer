import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { applyBalanceAccountMutation } from "../../../../src/store/billing/balance-account-mutation";

describe("balance account mutation", () => {
  const account = {
    id: "account-1",
    status: 1,
    createTime: new Date(),
    updateTime: new Date(),
    userId: "user-1",
    balance: new Decimal("12.5000"),
    totalRecharged: new Decimal("10.0000"),
    totalUsed: new Decimal("2.5000"),
    totalCommissionEarned: new Decimal("5.0000"),
  };
  const tx = {
    $queryRaw: vi.fn(),
    balanceAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.balanceAccount.findUnique.mockResolvedValue(account);
    tx.balanceAccount.update.mockImplementation(async ({ data }: any) => ({
      ...account,
      balance: account.balance.plus(data.balance?.increment || data.balance || 0),
      totalUsed: account.totalUsed.plus(data.totalUsed?.increment || 0),
    }));
  });

  it("applies an adjustment to the actual balance without rebuilding from statistics", async () => {
    const result = await applyBalanceAccountMutation(tx, {
      userId: "user-1",
      balanceDelta: new Decimal("1.2500"),
      totalRechargedDelta: new Decimal("1.2500"),
    });

    expect(result?.balanceBefore.toString()).toBe("12.5");
    expect(result?.balanceAfter.toString()).toBe("13.75");
    expect(tx.balanceAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { increment: new Decimal("1.25") },
          totalRecharged: { increment: new Decimal("1.25") },
        }),
      }),
    );
  });

  it("returns null instead of allowing a protected debit below zero", async () => {
    const result = await applyBalanceAccountMutation(tx, {
      userId: "user-1",
      balanceDelta: new Decimal("-13"),
      minimumBalance: 0,
    });

    expect(result).toBeNull();
    expect(tx.balanceAccount.update).not.toHaveBeenCalled();
  });
});
