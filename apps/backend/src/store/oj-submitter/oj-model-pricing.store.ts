import type { OJModelPricing, Prisma } from "@prisma/client";

export interface OJModelPricingStore {
  listActive(): Promise<OJModelPricing[]>;
  findByModel(model: string): Promise<OJModelPricing | null>;
  findActiveByModel(model: string): Promise<OJModelPricing | null>;
  create(data: Prisma.OJModelPricingUncheckedCreateInput): Promise<OJModelPricing>;
  updateByModel(model: string, data: Prisma.OJModelPricingUncheckedUpdateInput): Promise<OJModelPricing>;
  softDeleteByModel(model: string): Promise<OJModelPricing>;
}
