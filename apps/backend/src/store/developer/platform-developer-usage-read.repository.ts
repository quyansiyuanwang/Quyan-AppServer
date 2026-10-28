import { prisma } from "@/config/database";
import { Permission, isDeveloperProductCode, type DeveloperProductCode, type IamPrincipal } from "@quyan/shared";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { isDeveloperAccountRecordId } from "@/iam/resources/platform-developer-account-resources";
import { PlatformDeveloperAccountReadRepository } from "./platform-developer-account-read.repository";
import type { DeveloperAccountReadTarget } from "./platform-developer-account-read.store";
import type { PlatformDeveloperUsageReadStore, DeveloperUsageLocator } from "./platform-developer-usage-read.store";
const ownerMetadata = { id: true, status: true, userType: true, accountOwnerId: true, updateTime: true } as const;
export class PlatformDeveloperUsageReadRepository implements PlatformDeveloperUsageReadStore {
  private static instance: PlatformDeveloperUsageReadRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new PlatformDeveloperUsageReadRepository());
  }
  async target(principal: IamPrincipal, product: DeveloperProductCode, locator: DeveloperUsageLocator) {
    await platformManagementGroupSnapshot(principal, Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE);
    if (
      !isDeveloperProductCode(product) ||
      !!locator.accountId === !!locator.userId ||
      !isDeveloperAccountRecordId(locator.accountId ?? locator.userId)
    )
      throw iamAccountDenied();
    return prisma.developerProductEntitlement.findFirst({
      where: {
        productCode: product,
        status: 1,
        accountOwner: { status: 1, userType: "root" },
        ...(locator.accountId ? { id: locator.accountId } : { accountOwnerId: locator.userId }),
      },
      select: {
        id: true,
        status: true,
        productCode: true,
        accountOwnerId: true,
        createTime: true,
        updateTime: true,
        accountOwner: { select: ownerMetadata },
      },
    });
  }
  async read(principal: IamPrincipal, target: DeveloperAccountReadTarget, dates: readonly Date[]) {
    if (!dates.length || dates.length > 2 || dates.some((d) => !(d instanceof Date) || !Number.isFinite(d.getTime())))
      throw iamAccountDenied();
    const rows = await PlatformDeveloperAccountReadRepository.getInstance().hydrate(principal, [target]);
    if (rows.length !== 1) throw iamAccountDenied();
    const [config, usages] = await Promise.all([
      prisma.developerProductConfig.findUnique({
        where: { productCode: target.productCode },
        select: {
          id: true,
          status: true,
          productCode: true,
          defaultDailyQuota: true,
          overagePrice: true,
          updateTime: true,
        },
      }),
      prisma.developerProductQuotaUsage.findMany({
        where: { entitlementId: target.id, status: 1, usageDate: { in: [...dates] } },
        select: { id: true, status: true, entitlementId: true, usageDate: true, requestCount: true, updateTime: true },
        orderBy: { usageDate: "desc" },
      }),
    ]);
    return { account: rows[0], config, usages };
  }
}
