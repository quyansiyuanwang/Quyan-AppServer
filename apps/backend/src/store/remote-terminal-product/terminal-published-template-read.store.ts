import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
/** Published offer fields. Publisher identity and platform management metadata are excluded. */
export const TERMINAL_PUBLISHED_TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  publishStatus: true,
  publishedAt: true,
  billingUnit: true,
  minimumPurchaseUnits: true,
  maximumPurchaseUnits: true,
  devicePrice: true,
  terminalPrice: true,
  deviceDailyPrice: true,
  terminalDailyPrice: true,
  currency: true,
  purchaseLimitPerUser: true,
  purchaseLimitWindowDays: true,
  minimumDeviceCount: true,
  minimumTerminalCount: true,
  maxDeviceCount: true,
  maxTerminalCount: true,
  status: true,
  createTime: true,
  updateTime: true,
} as const satisfies Prisma.RemoteTerminalProductTemplateSelect;
export type TerminalPublishedTemplate = Prisma.RemoteTerminalProductTemplateGetPayload<{
  select: typeof TERMINAL_PUBLISHED_TEMPLATE_SELECT;
}>;
export interface TerminalPublishedTemplateReadStore {
  list(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<TerminalPublishedTemplate[]>;
}
