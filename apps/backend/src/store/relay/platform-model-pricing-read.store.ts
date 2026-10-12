import type { ModelPricing } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
export type ModelPricingReadTarget = Pick<ModelPricing, "id" | "status" | "model" | "createTime" | "updateTime">;
export interface PlatformModelPricingReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<ModelPricingReadTarget[]>;
  recheck(principal: IamPrincipal, targets: readonly ModelPricingReadTarget[]): Promise<ModelPricingReadTarget[]>;
  hydrate(principal: IamPrincipal, targets: readonly ModelPricingReadTarget[]): Promise<ModelPricing[]>;
}
