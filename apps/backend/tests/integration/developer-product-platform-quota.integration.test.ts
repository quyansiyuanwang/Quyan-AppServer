import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/config/database";
import { DeveloperProjectService } from "../../src/services/developer/developer-project.service";
import { DeveloperProductPlatformService } from "../../src/services/developer/developer-product-platform.service";
import { toDatabaseDate, toLegacyDatabaseDate, localDayStartForDatabaseDate } from "../../src/util/database-date";

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
    vi.stubEnv("TZ", "Asia/Shanghai");
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
    vi.unstubAllEnvs();
  });

  it("increments an existing daily usage row written by the prior local-midnight code", async () => {
    const legacyUsageDate = new Date();
    legacyUsageDate.setHours(0, 0, 0, 0);
    const usageDate = toDatabaseDate();
    await prisma.developerProductQuotaUsage.create({
      data: { entitlementId: fixtureIds.entitlementId!, usageDate: legacyUsageDate, requestCount: 4 },
    });

    expect(await DeveloperProductPlatformService.getInstance().getUsage(fixtureIds.entitlementId!)).toMatchObject({
      requestCount: 4,
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
  it("does not read or migrate yesterday's normalized quota into today", async () => {
    await prisma.developerProductQuotaUsage.deleteMany({ where: { entitlementId: fixtureIds.entitlementId! } });
    const usageDate = toDatabaseDate();
    const legacyDate = toLegacyDatabaseDate();
    expect(legacyDate.getTime()).not.toBe(usageDate.getTime());
    const yesterdayEnd = new Date(localDayStartForDatabaseDate(usageDate).getTime() - 1);
    const yesterday = await prisma.developerProductQuotaUsage.create({
      data: {
        entitlementId: fixtureIds.entitlementId!,
        usageDate: legacyDate,
        requestCount: 100,
        createTime: yesterdayEnd,
        updateTime: yesterdayEnd,
      },
    });
    await prisma.developerProductConfig.update({ where: { productCode }, data: { overagePrice: 1 } });
    const service = DeveloperProductPlatformService.getInstance();
    expect(await service.getUsage(fixtureIds.entitlementId!)).toMatchObject({ requestCount: 0, remainingFree: 100 });
    const receipt = await (service as any).consumeQuota(context());
    const today = await prisma.developerProductQuotaUsage.findUniqueOrThrow({
      where: {
        entitlementId_usageDate: { entitlementId: fixtureIds.entitlementId!, usageDate },
      },
    });
    expect(today.id).not.toBe(yesterday.id);
    expect(receipt.usageId).toBe(today.id);
    expect(today.requestCount).toBe(1);
    expect(await prisma.developerProductQuotaUsage.findUniqueOrThrow({ where: { id: yesterday.id } })).toMatchObject({
      usageDate: legacyDate,
      requestCount: 100,
      updateTime: yesterdayEnd,
    });
    await prisma.developerProductConfig.update({ where: { productCode }, data: { overagePrice: 0 } });
  });
  it.each([false, true])("handles project quota legacy eligibility for current-day writes=%s", async (currentDay) => {
    const project = await prisma.developerProject.create({
      data: {
        userId: fixtureIds.userId!,
        name: `quota-day-fixture-${randomUUID()}`,
        slug: `quota-day-fixture-${randomUUID()}`,
        dailyFreeQuota: 100,
      },
    });
    try {
      const usageDate = toDatabaseDate(),
        legacyDate = toLegacyDatabaseDate();
      expect(legacyDate.getTime()).not.toBe(usageDate.getTime());
      const updateTime = currentDay ? new Date() : new Date(localDayStartForDatabaseDate(usageDate).getTime() - 1);
      const before = await prisma.developerQuotaUsage.create({
        data: {
          projectId: project.id,
          service: "ip",
          usageDate: legacyDate,
          requestCount: currentDay ? 4 : 100,
          updateTime,
        },
      });
      const service = DeveloperProjectService.getInstance();
      const summary = await service.getQuotaSummary(project.id, fixtureIds.userId!);
      expect(summary.usages.find((row) => row.service === "ip")).toMatchObject({ requestCount: currentDay ? 4 : 0 });
      await (service as any).consumeQuota(project.id, "ip");
      const today = await prisma.developerQuotaUsage.findUniqueOrThrow({
        where: {
          projectId_service_usageDate: { projectId: project.id, service: "ip", usageDate },
        },
      });
      expect(today.requestCount).toBe(currentDay ? 5 : 1);
      if (currentDay) expect(today.id).toBe(before.id);
      else
        expect(await prisma.developerQuotaUsage.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
          requestCount: 100,
          usageDate: legacyDate,
          updateTime,
        });
    } finally {
      await prisma.developerProject.delete({ where: { id: project.id } });
    }
  });
});
