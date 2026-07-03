import { prisma } from "@/config/database";
import type { ModelPricing, Prisma } from "@prisma/client";
import type { ModelPricingImportItem, ModelPricingStore } from "./model-pricing.store";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import { RECORD_STATUS } from "@/constant/status";

export class ModelPricingRepository implements ModelPricingStore {
  private static instance: ModelPricingRepository;

  public static getInstance(): ModelPricingRepository {
    if (!ModelPricingRepository.instance) ModelPricingRepository.instance = new ModelPricingRepository();

    return ModelPricingRepository.instance;
  }

  async listActiveOrderedByModel(): Promise<ModelPricing[]> {
    return prisma.modelPricing.findMany({
      where: { status: RECORD_STATUS.ACTIVE },
      orderBy: { model: "asc" },
    });
  }

  async findActiveById(id: string): Promise<ModelPricing | null> {
    return prisma.modelPricing.findFirst({
      where: { id, status: RECORD_STATUS.ACTIVE },
    });
  }

  async findActiveByModel(model: string): Promise<ModelPricing | null> {
    return prisma.modelPricing.findFirst({
      where: { model, status: RECORD_STATUS.ACTIVE },
    });
  }

  async findByModel(model: string): Promise<ModelPricing | null> {
    return prisma.modelPricing.findUnique({
      where: { model },
    });
  }

  async create(data: Prisma.ModelPricingUncheckedCreateInput): Promise<ModelPricing> {
    return prisma.modelPricing.create({ data });
  }

  async updateById(id: string, data: Prisma.ModelPricingUncheckedUpdateInput): Promise<ModelPricing> {
    return prisma.modelPricing.update({
      where: { id },
      data,
    });
  }

  async softDeleteById(id: string): Promise<ModelPricing> {
    return this.updateById(id, { status: RECORD_STATUS.DELETED });
  }

  async importModels(models: ModelPricingImportItem[]): Promise<{ created: number; updated: number; total: number }> {
    let created = 0;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of models) {
        const existing = await tx.modelPricing.findUnique({ where: { model: item.model } });

        if (existing) {
          await tx.modelPricing.update({
            where: { id: existing.id },
            data: {
              inputPrice: item.inputPrice,
              outputPrice: item.outputPrice,
              provider: item.provider,
              cacheCreationMultiplier: item.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
              cacheReadMultiplier: item.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER,
              status: RECORD_STATUS.ACTIVE,
            },
          });
          updated++;
        } else {
          await tx.modelPricing.create({
            data: {
              model: item.model,
              inputPrice: item.inputPrice,
              outputPrice: item.outputPrice,
              provider: item.provider,
              cacheCreationMultiplier: item.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
              cacheReadMultiplier: item.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER,
              status: RECORD_STATUS.ACTIVE,
            },
          });
          created++;
        }
      }
    });

    return { created, updated, total: created + updated };
  }
}
