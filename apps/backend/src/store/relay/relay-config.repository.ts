import { writeRelayConfigurationModelRates } from "./relay-configuration-model-rates";
import { prisma } from "@/config/database";
import type { Prisma, RelayConfig } from "@prisma/client";
import type { RelayConfigStore, RelayModelRateInput } from "./relay-config.store";
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
      await writeRelayConfigurationModelRates(tx, modelRates, existingModels);
    });
  }
}
