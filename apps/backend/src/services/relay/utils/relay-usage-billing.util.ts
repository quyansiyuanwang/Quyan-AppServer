import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import type { SelectedRateConfig } from "../types/relay-proxy.types";

export interface RelayCostParams {
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  rateConfig: SelectedRateConfig | number | null | undefined;
  globalMultiplier: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cacheCreationMultiplier?: number;
  cacheReadMultiplier?: number;
}

export interface RelayCostResult {
  cost: number;
  inputCost: number;
  outputCost: number;
  inputRate: number;
  outputRate: number;
  multiplier: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export const calculateRelayCost = (params: RelayCostParams): RelayCostResult => {
  const {
    requestTokens,
    responseTokens,
    totalTokens,
    rateConfig,
    globalMultiplier,
    cacheCreationTokens = 0,
    cacheReadTokens = 0,
    cacheCreationMultiplier = DEFAULT_CACHE_CREATION_MULTIPLIER,
    cacheReadMultiplier = DEFAULT_CACHE_READ_MULTIPLIER,
  } = params;

  if (rateConfig && typeof rateConfig === "object" && rateConfig.pricingType === "per-request") {
    if (!rateConfig.fixedPrice) throw new Error("fixedPrice is required for per-request pricing model");
    const cost = Math.max(0, Math.ceil(Number(rateConfig.fixedPrice) * globalMultiplier * 10000) / 10000);
    return {
      cost,
      inputCost: cost,
      outputCost: 0,
      inputRate: 0,
      outputRate: 0,
      multiplier: globalMultiplier,
      cacheCreationTokens,
      cacheReadTokens,
    };
  }

  if (rateConfig && typeof rateConfig === "object" && ("input" in rateConfig || "output" in rateConfig)) {
    if (rateConfig.input == null || rateConfig.output == null)
      throw new Error("input and output rates are required for token-based pricing model");
    const inputRate = Number(rateConfig.input);
    const outputRate = Number(rateConfig.output);
    const inputCost =
      requestTokens * inputRate +
      cacheCreationTokens * inputRate * cacheCreationMultiplier +
      cacheReadTokens * inputRate * cacheReadMultiplier;
    const outputCost = responseTokens * outputRate;
    const rawCost = (inputCost + outputCost) * globalMultiplier;
    if (!Number.isFinite(rawCost))
      return {
        cost: 0,
        inputCost: 0,
        outputCost: 0,
        inputRate,
        outputRate,
        multiplier: globalMultiplier,
        cacheCreationTokens,
        cacheReadTokens,
      };
    return {
      cost: Math.max(0, Math.ceil(rawCost * 10000) / 10000),
      inputCost,
      outputCost,
      inputRate,
      outputRate,
      multiplier: globalMultiplier,
      cacheCreationTokens,
      cacheReadTokens,
    };
  }

  const rate = Number(rateConfig) || 0.000001;
  const cost = Math.ceil((totalTokens || 0) * rate * globalMultiplier * 10000) / 10000;
  return {
    cost,
    inputCost: cost,
    outputCost: 0,
    inputRate: rate,
    outputRate: 0,
    multiplier: globalMultiplier,
    cacheCreationTokens,
    cacheReadTokens,
  };
};
