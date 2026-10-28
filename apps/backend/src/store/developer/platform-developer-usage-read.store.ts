import type { DeveloperProductConfig, DeveloperProductQuotaUsage } from "@prisma/client";
import type { IamPrincipal, DeveloperProductCode } from "@quyan/shared";
import type { DeveloperAccountReadTarget, DeveloperAccountReadRow } from "./platform-developer-account-read.store";
export type DeveloperUsageLocator = { accountId: string; userId?: never } | { userId: string; accountId?: never };
export interface DeveloperUsageReadData {
  account: DeveloperAccountReadRow;
  config: Pick<
    DeveloperProductConfig,
    "id" | "status" | "productCode" | "defaultDailyQuota" | "overagePrice" | "updateTime"
  > | null;
  usages: Pick<
    DeveloperProductQuotaUsage,
    "id" | "status" | "entitlementId" | "usageDate" | "requestCount" | "updateTime"
  >[];
}
export interface PlatformDeveloperUsageReadStore {
  target(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    locator: DeveloperUsageLocator,
  ): Promise<DeveloperAccountReadTarget | null>;
  read(
    principal: IamPrincipal,
    target: DeveloperAccountReadTarget,
    dates: readonly Date[],
  ): Promise<DeveloperUsageReadData>;
}
