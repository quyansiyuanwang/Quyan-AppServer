import { Prisma } from "@prisma/client";
import type { UpdateRelayConfigRequest } from "@/api/dto/relay/relay-config.dto";
import type { RelayModelRateInput } from "@/store/relay/relay-config.store";
const MAX_MODEL_FIELD_LENGTH = 200;
export function isRelayConfigurationModelName(model: unknown): model is string {
  return (
    typeof model === "string" && model.length > 0 && model.trim() === model && model.length <= MAX_MODEL_FIELD_LENGTH
  );
}
/** Keep legacy and IAM writes on the same normalization and JSON/null conversion. */
export function prepareRelayConfigurationUpdate(data: UpdateRelayConfigRequest) {
  let normalizedModelRates: RelayModelRateInput[] | undefined;
  if (data.modelRates !== undefined)
    normalizedModelRates = data.modelRates.map((rate) => {
      const modelName = rate.model.trim();
      if (!modelName) throw new Error("model is required and cannot be empty");
      if (modelName.length > MAX_MODEL_FIELD_LENGTH)
        throw new Error(`model length must be <= ${MAX_MODEL_FIELD_LENGTH}`);

      const trimmedModelId = rate.modelId?.trim();
      const resolvedModelId = trimmedModelId && trimmedModelId.length > 0 ? trimmedModelId : modelName;
      if (!resolvedModelId.length) throw new Error("modelId is required and cannot be empty after trim");
      if (resolvedModelId.length > MAX_MODEL_FIELD_LENGTH)
        throw new Error(`modelId length must be <= ${MAX_MODEL_FIELD_LENGTH}`);

      const pricingType = rate.pricingType || "token-based";
      if (pricingType !== "token-based" && pricingType !== "per-request")
        throw new Error(`Invalid pricingType '${pricingType}' for model ${modelName}`);

      if (pricingType === "per-request") {
        if (rate.fixedPrice == null || rate.fixedPrice < 0)
          throw new Error(`fixedPrice is required and must be >= 0 for per-request model ${modelName}`);
      } else {
        if (rate.inputPrice == null || rate.inputPrice < 0)
          throw new Error(`inputPrice must be >= 0 for token-based model ${modelName}`);

        if (rate.outputPrice == null || rate.outputPrice < 0)
          throw new Error(`outputPrice must be >= 0 for token-based model ${modelName}`);
      }

      return {
        model: modelName,
        modelId: resolvedModelId,
        pricingType,
        inputPrice: rate.inputPrice,
        outputPrice: rate.outputPrice,
        fixedPrice: rate.fixedPrice,
        cacheCreationMultiplier: rate.cacheCreationMultiplier,
        cacheReadMultiplier: rate.cacheReadMultiplier,
        supportedFormats: rate.supportedFormats,
      };
    });

  const configData: Prisma.RelayConfigUncheckedCreateInput = {
    globalMultiplier: data.globalMultiplier,
    maxConcurrency: data.maxConcurrency,
    queueTimeout: data.queueTimeout,
    upstreamStreamTimeout: data.upstreamStreamTimeout,
    preflightBufferLimitBytes: data.preflightBufferLimitBytes,
    enableQueue: data.enableQueue,
    apiCatalogPoolVisibility: data.apiCatalogPoolVisibility,
    channelTopologyMode: data.channelTopologyMode,
    uptimeStatusUrl: data.uptimeStatusUrl,
    monitorNameMapping:
      data.monitorNameMapping === null
        ? Prisma.DbNull
        : data.monitorNameMapping === undefined
          ? undefined
          : (data.monitorNameMapping as Prisma.InputJsonValue),
    showOnlyConfigured: data.showOnlyConfigured,
    uptimeTransformRules: data.uptimeTransformRules,
    uptimeStaticData: data.uptimeStaticData,
  };
  return { configData, modelRates: normalizedModelRates };
}
