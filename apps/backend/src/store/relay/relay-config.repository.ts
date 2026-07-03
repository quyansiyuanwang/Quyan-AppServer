import { prisma } from "@/config/database";
import type { Prisma, RelayConfig } from "@prisma/client";
import type { RelayConfigStore, RelayModelRateInput } from "./relay-config.store";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import { RECORD_STATUS } from "@/constant/status";

export type { RelayModelRateInput } from "./relay-config.store";

export class RelayConfigRepository implements RelayConfigStore {
  private static instance: RelayConfigRepository;

  public static getInstance(): RelayConfigRepository {
    if (!RelayConfigRepository.instance) RelayConfigRepository.instance = new RelayConfigRepository();

    return RelayConfigRepository.instance;
  }

  async findLatestActive(): Promise<RelayConfig | null> {
    return prisma.relayConfig.findFirst({
      where: { status: RECORD_STATUS.ACTIVE },
      orderBy: { updateTime: "desc" },
    });
  }

  async create(data: Prisma.RelayConfigUncheckedCreateInput): Promise<RelayConfig> {
    return prisma.relayConfig.create({ data });
  }

  async updateConfigAndModelRates(
    configId: string,
    configData: Prisma.RelayConfigUncheckedUpdateInput,
    modelRates?: RelayModelRateInput[],
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.relayConfig.update({
        where: { id: configId },
        data: configData,
      });

      if (modelRates === undefined) return;

      const existingModels = await tx.modelPricing.findMany();
      const existingActiveMap = new Map(
        existingModels.filter((m) => m.status === RECORD_STATUS.ACTIVE).map((m) => [m.model, m]),
      );
      const existingInactiveMap = new Map(
        existingModels.filter((m) => m.status !== RECORD_STATUS.ACTIVE).map((m) => [m.model, m]),
      );
      const incomingModels = new Set(modelRates.map((r) => r.model));

      for (const rate of modelRates) {
        const writeData = {
          pricingType: rate.pricingType,
          inputPrice: rate.inputPrice ?? 0,
          outputPrice: rate.outputPrice ?? 0,
          fixedPrice: rate.fixedPrice,
          provider: rate.modelId || rate.model,
          cacheCreationMultiplier: rate.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
          cacheReadMultiplier: rate.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER,
          supportedFormats: rate.supportedFormats || "all",
        };

        const found = existingActiveMap.get(rate.model);
        if (found)
          await tx.modelPricing.update({
            where: { id: found.id },
            data: writeData,
          });

        const archived = existingInactiveMap.get(rate.model);
        if (!found && archived)
          await tx.modelPricing.update({
            where: { id: archived.id },
            data: {
              ...writeData,
              status: RECORD_STATUS.ACTIVE,
            },
          });

        if (!found && !archived)
          await tx.modelPricing.create({
            data: {
              model: rate.model,
              ...writeData,
              status: RECORD_STATUS.ACTIVE,
            },
          });
      }

      for (const [model, existing] of existingActiveMap)
        if (!incomingModels.has(model))
          await tx.modelPricing.update({
            where: { id: existing.id },
            data: { status: RECORD_STATUS.DELETED },
          });
    });
  }
}
