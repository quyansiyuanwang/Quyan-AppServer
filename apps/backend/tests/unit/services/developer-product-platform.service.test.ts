import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    developerProductEntitlement: { findUnique: vi.fn() },
    developerProductConfig: { findUnique: vi.fn() },
    developerProductQuotaUsage: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    balanceAccount: { findUnique: vi.fn(), updateMany: vi.fn() },
    balanceTransaction: { create: vi.fn() },
  },
}));

vi.mock("../../../src/config/database", () => ({ prisma: mocks.prisma }));

import { DeveloperProductPlatformService } from "../../../src/services/developer/developer-product-platform.service";

describe("DeveloperProductPlatformService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (DeveloperProductPlatformService as any).instance = undefined;
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(mocks.prisma));
  });

  it("retries quota creation in a new transaction after a first-use race", async () => {
    mocks.prisma.developerProductEntitlement.findUnique.mockResolvedValue({
      id: "entitlement-1",
      accountOwnerId: "user-1",
      dailyFreeQuota: null,
      overageEnabled: false,
    });
    mocks.prisma.developerProductConfig.findUnique.mockResolvedValue({ overagePrice: 0, defaultDailyQuota: 0 });
    mocks.prisma.developerProductQuotaUsage.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.prisma.developerProductQuotaUsage.create.mockRejectedValueOnce({ code: "P2002" });
    mocks.prisma.developerProductQuotaUsage.findUnique.mockResolvedValueOnce({ id: "usage-1", requestCount: 1 });

    const receipt = await (DeveloperProductPlatformService.getInstance() as any).consumeQuota({
      entitlementId: "entitlement-1",
      accountOwnerId: "user-1",
      productCode: "ip_geolocation",
      instanceId: "instance-1",
      backingProjectId: "project-1",
      actions: [],
    });

    expect(receipt).toEqual({
      usageId: "usage-1",
      entitlementId: "entitlement-1",
      accountOwnerId: "user-1",
      chargeAmount: 0,
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.developerProductQuotaUsage.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.developerProductQuotaUsage.updateMany).toHaveBeenCalledTimes(2);
  });

  it("refunds an overage when its quota record was deleted concurrently", async () => {
    mocks.prisma.developerProductQuotaUsage.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.balanceAccount.findUnique.mockResolvedValueOnce({ balance: 4 }).mockResolvedValueOnce({ balance: 5 });
    mocks.prisma.balanceAccount.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      (DeveloperProductPlatformService.getInstance() as any).refundQuota({
        usageId: "usage-1",
        entitlementId: "entitlement-1",
        accountOwnerId: "user-1",
        chargeAmount: 1,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.prisma.developerProductQuotaUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "usage-1" } }),
    );
    expect(mocks.prisma.balanceAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
    expect(mocks.prisma.balanceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balanceAfter: 5 }) }),
    );
  });
});
