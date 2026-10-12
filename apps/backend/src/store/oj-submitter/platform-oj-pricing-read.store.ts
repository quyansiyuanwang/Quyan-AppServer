import type { OJModelPricing } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type OjPricingReadTarget = Pick<OJModelPricing, "id" | "status" | "model" | "createTime" | "updateTime">;
export interface PlatformOjPricingReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<OjPricingReadTarget[]>;
  target(principal: IamPrincipal, model: string): Promise<OjPricingReadTarget | null>;
  recheck(principal: IamPrincipal, targets: readonly OjPricingReadTarget[]): Promise<OjPricingReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly OjPricingReadTarget[]): Promise<OJModelPricing[]>;
}
