import type { Prisma, RelayConfig } from "@prisma/client";

export type RelayModelRateInput = {
  model: string;
  modelId?: string;
  pricingType: "token-based" | "per-request";
  inputPrice?: number;
  outputPrice?: number;
  fixedPrice?: number;
  cacheCreationMultiplier?: number;
  cacheReadMultiplier?: number;
  supportedFormats?: string;
};

export interface RelayConfigStore {
  findLatestActive(): Promise<RelayConfig | null>;
  create(data: Prisma.RelayConfigUncheckedCreateInput): Promise<RelayConfig>;
  updateConfigAndModelRates(
    configId: string,
    configData: Prisma.RelayConfigUncheckedUpdateInput,
    modelRates?: RelayModelRateInput[],
  ): Promise<void>;
}
