import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
/** Published offer details are hydrated only after the user's template view has been authorized. */
export const MONTHLY_PASS_PUBLISHED_TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  publishStatus: true,
  publishedAt: true,
  originalPrice: true,
  discountPercent: true,
  discountedPrice: true,
  rechargeRatio: true,
  defaultQuota: true,
  dailyQuota: true,
  quotaUnit: true,
  quotaWindowHours: true,
  validityDays: true,
  purchaseLimitPerUser: true,
  purchaseLimitWindowDays: true,
  allowBalanceRedemption: true,
  allowedModels: true,
  allowedChannels: true,
  status: true,
  createTime: true,
  updateTime: true,
  quotaWindows: {
    orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }],
    select: { id: true, quotaLimit: true, quotaUnit: true, quotaWindowHours: true },
  },
} as const satisfies Prisma.MonthlyPassTemplateSelect;
export type MonthlyPassPublishedTemplate = Prisma.MonthlyPassTemplateGetPayload<{
  select: typeof MONTHLY_PASS_PUBLISHED_TEMPLATE_SELECT;
}>;
export interface MonthlyPassPublishedTemplateReadStore {
  list(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<MonthlyPassPublishedTemplate[]>;
}
