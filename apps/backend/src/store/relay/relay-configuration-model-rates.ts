import type { Prisma } from "@prisma/client";
import type { RelayModelRateInput } from "./relay-config.store";
import {
  DEFAULT_CACHE_CREATION_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS,
} from "@/constant/pricing";
import { RECORD_STATUS } from "@/constant/status";
export async function writeRelayConfigurationModelRates(
  tx: Prisma.TransactionClient,
  rates: readonly RelayModelRateInput[],
  existing: readonly { id: string; model: string; status: number }[],
): Promise<string[]> {
  const affectedIds: string[] = [];
  const existingActiveMap = new Map(existing.filter((m) => m.status === RECORD_STATUS.ACTIVE).map((m) => [m.model, m]));
  const existingInactiveMap = new Map(
    existing.filter((m) => m.status !== RECORD_STATUS.ACTIVE).map((m) => [m.model, m]),
  );
  const incomingModels = new Set(rates.map((r) => r.model));

  for (const rate of rates) {
    const writeData = {
      pricingType: rate.pricingType,
      inputPrice: rate.inputPrice ?? 0,
      outputPrice: rate.outputPrice ?? 0,
      fixedPrice: rate.fixedPrice,
      provider: rate.modelId || rate.model,
      cacheCreationMultiplier: rate.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
      cacheReadMultiplier: rate.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER,
      supportedFormats: rate.supportedFormats || DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS,
    };

    const found = existingActiveMap.get(rate.model);
    if (found) {
      affectedIds.push(found.id);
      await tx.modelPricing.update({
        where: { id: found.id },
        data: writeData,
      });
    }

    const archived = existingInactiveMap.get(rate.model);
    if (!found && archived) {
      affectedIds.push(archived.id);
      await tx.modelPricing.update({
        where: { id: archived.id },
        data: {
          ...writeData,
          status: RECORD_STATUS.ACTIVE,
        },
      });
    }

    if (!found && !archived) {
      const created = await tx.modelPricing.create({
        data: {
          model: rate.model,
          ...writeData,
          status: RECORD_STATUS.ACTIVE,
        },
      });
      affectedIds.push(created.id);
    }
  }

  for (const [model, existing] of existingActiveMap)
    if (!incomingModels.has(model)) {
      affectedIds.push(existing.id);
      await tx.modelPricing.update({
        where: { id: existing.id },
        data: { status: RECORD_STATUS.DELETED },
      });
    }
  return affectedIds;
}
