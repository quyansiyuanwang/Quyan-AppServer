import { prisma } from "@/config/database";
import type { OJModelPricing, Prisma } from "@prisma/client";
import type { OJModelPricingStore } from "./oj-model-pricing.store";
import { RECORD_STATUS } from "@/constant/status";

export class OJModelPricingRepository implements OJModelPricingStore {
  private static instance: OJModelPricingRepository;

  public static getInstance(): OJModelPricingRepository {
    if (!OJModelPricingRepository.instance) OJModelPricingRepository.instance = new OJModelPricingRepository();

    return OJModelPricingRepository.instance;
  }

  async listActive(): Promise<OJModelPricing[]> {
    return prisma.oJModelPricing.findMany({
      where: { status: RECORD_STATUS.ACTIVE },
      orderBy: { createTime: "desc" },
    });
  }

  async findByModel(model: string): Promise<OJModelPricing | null> {
    return prisma.oJModelPricing.findUnique({
      where: { model },
    });
  }

  async findActiveByModel(model: string): Promise<OJModelPricing | null> {
    return prisma.oJModelPricing.findFirst({
      where: { model, status: RECORD_STATUS.ACTIVE },
    });
  }

  async create(data: Prisma.OJModelPricingUncheckedCreateInput): Promise<OJModelPricing> {
    return prisma.oJModelPricing.create({ data });
  }

  async updateByModel(model: string, data: Prisma.OJModelPricingUncheckedUpdateInput): Promise<OJModelPricing> {
    return prisma.oJModelPricing.update({
      where: { model },
      data,
    });
  }

  async softDeleteByModel(model: string): Promise<OJModelPricing> {
    return this.updateByModel(model, { status: RECORD_STATUS.DELETED });
  }
}
