import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database";
import { DeveloperProductPlatformService } from "../../src/services/developer/developer-product-platform.service";
import { toDatabaseDate } from "../../src/util/database-date";

const fixtureIds: { groupId?: string; userId?: string; entitlementId?: string; configId?: string } = {};
const productCode = "ip_geolocation";

const context = () => ({
  entitlementId: fixtureIds.entitlementId!,
  accountOwnerId: fixtureIds.userId!,
  productCode,
  instanceId: "quota-test-instance",
  backingProjectId: "quota-test-project",
  actions: [],
});

describe("DeveloperProductPlatformService product quota persistence", () => {
  beforeAll(async () => {
    const suffix = randomUUID();
    const group = await prisma.group.create({
      data: { username: `product-quota-group-${suffix}`, permissions: [], level: 1 },
    });
    fixtureIds.groupId = group.id;

    const user = await prisma.user.create({
      data: {
        username: `product-quota-user-${suffix}`,
        password: "test-password-hash",
        groupId: group.id,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    fixtureIds.userId = user.id;

    const config = await prisma.developerProductConfig.upsert({
      where: { productCode },
      create: { productCode, enabled: true, defaultDailyQuota: 100, overagePrice: 0 },
      update: { enabled: true, defaultDailyQuota: 100, overagePrice: 0 },
    });
    fixtureIds.configId = config.id;

    const entitlement = await prisma.developerProductEntitlement.create({
      data: {
        accountOwnerId: user.id,
        productCode,
        dailyFreeQuota: 100,
        issuedByUserId: user.id,
      },
    });
    fixtureIds.entitlementId = entitlement.id;
  });

  afterAll(async () => {
    if (fixtureIds.entitlementId)
      await prisma.developerProductQuotaUsage.deleteMany({ where: { entitlementId: fixtureIds.entitlementId } });
    if (fixtureIds.entitlementId)
      await prisma.developerProductEntitlement.deleteMany({ where: { id: fixtureIds.entitlementId } });
    if (fixtureIds.configId) await prisma.developerProductConfig.deleteMany({ where: { id: fixtureIds.configId } });
    if (fixtureIds.userId) await prisma.user.deleteMany({ where: { id: fixtureIds.userId } });
    if (fixtureIds.groupId) await prisma.group.deleteMany({ where: { id: fixtureIds.groupId } });
  });

  it("increments an existing daily usage row written by the prior local-midnight code", async () => {
    const legacyUsageDate = new Date();
    legacyUsageDate.setHours(0, 0, 0, 0);
    const usageDate = toDatabaseDate();
    await prisma.developerProductQuotaUsage.create({
      data: { entitlementId: fixtureIds.entitlementId!, usageDate: legacyUsageDate, requestCount: 4 },
    });

    const receipt = await (DeveloperProductPlatformService.getInstance() as any).consumeQuota(context());
    const usage = await prisma.developerProductQuotaUsage.findUniqueOrThrow({
      where: { entitlementId_usageDate: { entitlementId: fixtureIds.entitlementId!, usageDate } },
    });

    expect(receipt.usageId).toBe(usage.id);
    expect(usage.requestCount).toBe(5);
  });

  it("stores concurrent first requests in one daily usage row", async () => {
    await prisma.developerProductQuotaUsage.deleteMany({ where: { entitlementId: fixtureIds.entitlementId! } });
    const usageDate = toDatabaseDate();
    const calls = Array.from({ length: 12 }, () =>
      (DeveloperProductPlatformService.getInstance() as any).consumeQuota(context()),
    );

    await expect(Promise.all(calls)).resolves.toHaveLength(12);

    const usages = await prisma.developerProductQuotaUsage.findMany({
      where: { entitlementId: fixtureIds.entitlementId!, usageDate },
    });
    expect(usages).toHaveLength(1);
    expect(usages[0]!.requestCount).toBe(12);
  });
});
