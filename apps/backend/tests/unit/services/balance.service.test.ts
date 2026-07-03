import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { BalanceService } from "../../../src/services/billing/balance.service";
import { BadRequestError, NotFoundError } from "../../../src/util/errors";

describe("BalanceService", () => {
  const balanceRepository = {
    findAccountByUserId: vi.fn(),
    findAccountsByUserIds: vi.fn(),
    recharge: vi.fn(),
    findTransactions: vi.fn(),
  };

  const userRepository = {
    findById: vi.fn(),
  };

  const BalanceServiceCtor = BalanceService as unknown as new (...args: any[]) => BalanceService;

  const service = new BalanceServiceCtor(balanceRepository, userRepository);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default zero balance account when account is missing", async () => {
    balanceRepository.findAccountByUserId.mockResolvedValue(null);

    const result = await service.getBalance("u-1");

    expect(result.userId).toBe("u-1");
    expect(Number(result.balance)).toBe(0);
    expect(Number(result.totalRecharged)).toBe(0);
    expect(Number(result.totalUsed)).toBe(0);
  });

  it("maps batch balances by userIds and keeps missing users as null", async () => {
    balanceRepository.findAccountsByUserIds.mockResolvedValue([
      { userId: "u-1", balance: new Decimal(10) },
      { userId: "u-3", balance: new Decimal(30) },
    ]);

    const result = await service.getBatchBalances(["u-1", "u-2", "u-3"]);

    expect(result).toHaveLength(3);
    expect(result[0]?.userId).toBe("u-1");
    expect(result[1]).toBeNull();
    expect(result[2]?.userId).toBe("u-3");
  });

  it("throws when recharge amount is zero", async () => {
    await expect(service.recharge("u-1", 0)).rejects.toThrow(BadRequestError);
  });

  it("throws when recharge target user does not exist", async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(service.recharge("u-1", 10)).rejects.toThrow(NotFoundError);
  });

  it("delegates recharge to repository with countAsStatistics flag", async () => {
    userRepository.findById.mockResolvedValue({ id: "u-1" });
    balanceRepository.recharge.mockResolvedValue({ userId: "u-1", balance: new Decimal(20) });

    await service.recharge("u-1", 20, "manual", true);

    expect(balanceRepository.recharge).toHaveBeenCalledWith({
      userId: "u-1",
      amount: 20,
      description: "manual",
      countAsStatistics: true,
    });
  });

  it("uses 30-day lower bound for transactions when startTime is too old", async () => {
    balanceRepository.findTransactions.mockResolvedValue({ total: 0, records: [] });

    await service.getTransactions("u-1", undefined, 1, 20, undefined, new Date("2000-01-01T00:00:00.000Z"));

    const where = balanceRepository.findTransactions.mock.calls[0][0];
    const gte = where.createTime.gte as Date;
    const lowerBound = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const upperBound = Date.now() - 29 * 24 * 60 * 60 * 1000;
    expect(gte.getTime()).toBeGreaterThanOrEqual(lowerBound);
    expect(gte.getTime()).toBeLessThanOrEqual(upperBound);
  });

  it("uses provided startTime when within retention window", async () => {
    const startTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    balanceRepository.findTransactions.mockResolvedValue({ total: 0, records: [] });

    await service.getTransactions("u-1", undefined, 1, 20, undefined, startTime);

    const where = balanceRepository.findTransactions.mock.calls[0][0];
    expect(where.createTime.gte).toEqual(startTime);
  });

  it("returns empty result when endTime is before effective start", async () => {
    const startTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const result = await service.getTransactions("u-1", undefined, 1, 20, undefined, startTime, endTime);

    expect(result).toEqual({
      total: 0,
      records: [],
      page: 1,
      pageSize: 20,
    });
    expect(balanceRepository.findTransactions).not.toHaveBeenCalled();
  });

  it("caps pageSize at 100 before querying repository", async () => {
    balanceRepository.findTransactions.mockResolvedValue({ total: 0, records: [] });

    await service.getTransactions("u-1", undefined, 1, 10000);

    expect(balanceRepository.findTransactions).toHaveBeenCalledWith(expect.any(Object), 1, 100);
  });

  it("returns balance statistics as numbers", async () => {
    balanceRepository.findAccountByUserId.mockResolvedValue({
      userId: "u-1",
      totalRecharged: new Decimal(123.45),
      totalUsed: new Decimal(67.89),
    });

    const stats = await service.getBalanceStatistics("u-1");

    expect(stats).toEqual({ total: 123.45, used: 67.89 });
  });
});
