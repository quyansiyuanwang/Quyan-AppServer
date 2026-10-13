import type { ModelPricing, RelayConfig } from "@prisma/client";
import type { ModelPricingItemDto, RelayConfigDto } from "@/api/dto/relay/relay-config.dto";
import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import { resolveModelId } from "@/util/model-resolution.util";
export function projectRelayModelRates(models: readonly ModelPricing[]): ModelPricingItemDto[] {
  return models.map((m) => ({
    model: m.model,
    modelId: resolveModelId(m),
    pricingType: m.pricingType as "token-based" | "per-request",
    inputPrice: Number(m.inputPrice),
    outputPrice: Number(m.outputPrice),
    fixedPrice: m.fixedPrice ? Number(m.fixedPrice) : undefined,
    cacheCreationMultiplier: Number(m.cacheCreationMultiplier),
    cacheReadMultiplier: Number(m.cacheReadMultiplier),
    supportedFormats: m.supportedFormats || undefined,
  }));
}
export function projectRelayConfiguration(
  config: RelayConfig | null,
  modelRates: ModelPricingItemDto[],
): RelayConfigDto {
  if (!config) return { id: "", ...DEFAULT_RELAY_CONFIG, modelRates };
  const mapping = config.monitorNameMapping;
  const validMapping =
    mapping &&
    typeof mapping === "object" &&
    !Array.isArray(mapping) &&
    Object.values(mapping).every((value) => typeof value === "string");
  return {
    id: config.id,
    globalMultiplier: Number(config.globalMultiplier),
    maxConcurrency: config.maxConcurrency,
    queueTimeout: config.queueTimeout,
    upstreamStreamTimeout: config.upstreamStreamTimeout,
    preflightBufferLimitBytes: config.preflightBufferLimitBytes ?? undefined,
    enableQueue: config.enableQueue,
    apiCatalogPoolVisibility: config.apiCatalogPoolVisibility === "anonymous-range" ? "anonymous-range" : "hidden",
    channelTopologyMode: config.channelTopologyMode === "strict-two-tier" ? "strict-two-tier" : "legacy",
    uptimeStatusUrl: config.uptimeStatusUrl || undefined,
    monitorNameMapping: validMapping ? (mapping as Record<string, string>) : null,
    showOnlyConfigured: config.showOnlyConfigured ?? undefined,
    uptimeTransformRules: config.uptimeTransformRules || undefined,
    uptimeStaticData: config.uptimeStaticData || undefined,
    modelRates,
  };
}
