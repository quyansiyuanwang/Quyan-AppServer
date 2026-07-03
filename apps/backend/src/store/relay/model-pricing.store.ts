import type { ModelPricing, Prisma } from "@prisma/client";

export interface ModelPricingImportItem {
  model: string;
  inputPrice: number;
  outputPrice: number;
  provider?: string;
  cacheCreationMultiplier?: number;
  cacheReadMultiplier?: number;
}

export interface ModelPricingStore {
  listActiveOrderedByModel(): Promise<ModelPricing[]>;
  findActiveById(id: string): Promise<ModelPricing | null>;
  findActiveByModel(model: string): Promise<ModelPricing | null>;
  findByModel(model: string): Promise<ModelPricing | null>;
  create(data: Prisma.ModelPricingUncheckedCreateInput): Promise<ModelPricing>;
  updateById(id: string, data: Prisma.ModelPricingUncheckedUpdateInput): Promise<ModelPricing>;
  softDeleteById(id: string): Promise<ModelPricing>;
  importModels(models: ModelPricingImportItem[]): Promise<{ created: number; updated: number; total: number }>;
}
