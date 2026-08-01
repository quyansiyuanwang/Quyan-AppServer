import type { ModelPricingItemDto, RelayConfigDto, UpdateRelayConfigRequest } from "@/api/dto/relay/relay-config.dto";
import { Prisma } from "@prisma/client";
import { NotFoundError } from "@/util/errors";
import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import { RelayConfigRepository, RelayModelRateInput } from "@/store/relay/relay-config.repository";
import type { ModelPricingStore } from "@/store/relay/model-pricing.store";
import type { RelayConfigStore } from "@/store/relay/relay-config.store";
import { resolveModelId } from "@/util/model-resolution.util";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { RECORD_STATUS } from "@/constant/status";
import type { Request } from "express";

const MAX_MODEL_FIELD_LENGTH = 200;

const isMonitorNameMapping = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
};

const toMonitorNameMapping = (value: unknown): Record<string, string> | null => {
  return isMonitorNameMapping(value) ? value : null;
};

const summarizeRelayConfigChanges = (data: UpdateRelayConfigRequest) => ({
  globalMultiplier: data.globalMultiplier,
  maxConcurrency: data.maxConcurrency,
  queueTimeout: data.queueTimeout,
  upstreamStreamTimeout: data.upstreamStreamTimeout,
  enableQueue: data.enableQueue,
  apiCatalogPoolVisibility: data.apiCatalogPoolVisibility,
  uptimeStatusUrl: data.uptimeStatusUrl,
  monitorNameMapping: data.monitorNameMapping,
  showOnlyConfigured: data.showOnlyConfigured,
  uptimeTransformRules: data.uptimeTransformRules,
  uptimeStaticData: data.uptimeStaticData,
  modelRates:
    data.modelRates === undefined
      ? undefined
      : {
          count: data.modelRates.length,
          models: data.modelRates.slice(0, 20).map((rate) => ({
            model: rate.model,
            modelId: rate.modelId,
            pricingType: rate.pricingType,
          })),
          truncated: data.modelRates.length > 20,
        },
});

export class RelayConfigService {
  private static instance: RelayConfigService;

  private constructor(
    private readonly modelPricingRepository: ModelPricingStore = ModelPricingRepository.getInstance(),
    private readonly relayConfigRepository: RelayConfigStore = RelayConfigRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new RelayConfigService();
    return this.instance;
  }

  private async fetchModelRates(): Promise<ModelPricingItemDto[]> {
    const models = await this.modelPricingRepository.listActiveOrderedByModel();
    return models.map((m) => ({
      model: m.model,
      modelId: resolveModelId(m),
      pricingType: m.pricingType as "token-based" | "per-request" | undefined,
      inputPrice: Number(m.inputPrice),
      outputPrice: Number(m.outputPrice),
      fixedPrice: m.fixedPrice ? Number(m.fixedPrice) : undefined,
      cacheCreationMultiplier: Number(m.cacheCreationMultiplier),
      cacheReadMultiplier: Number(m.cacheReadMultiplier),
      supportedFormats: m.supportedFormats || undefined,
    }));
  }

  private defaultRelayConfigDto(modelRates: any[]): RelayConfigDto {
    return { id: "", ...DEFAULT_RELAY_CONFIG, modelRates };
  }

  async getRelayConfig(): Promise<RelayConfigDto> {
    let config: any;
    try {
      config = await this.relayConfigRepository.findLatestActive();
    } catch {
      const modelRates = await this.fetchModelRates().catch(() => []);
      return this.defaultRelayConfigDto(modelRates);
    }

    const modelRates = await this.fetchModelRates();

    if (!config) {
      const defaultConfig = await this.relayConfigRepository.create({
        ...DEFAULT_RELAY_CONFIG,
        status: RECORD_STATUS.ACTIVE,
      });
      return {
        id: defaultConfig.id,
        globalMultiplier: Number(defaultConfig.globalMultiplier),
        maxConcurrency: defaultConfig.maxConcurrency,
        queueTimeout: defaultConfig.queueTimeout,
        upstreamStreamTimeout: defaultConfig.upstreamStreamTimeout,
        enableQueue: defaultConfig.enableQueue,
        apiCatalogPoolVisibility:
          defaultConfig.apiCatalogPoolVisibility === "anonymous-range" ? "anonymous-range" : "hidden",
        uptimeStatusUrl: defaultConfig.uptimeStatusUrl || undefined,
        monitorNameMapping: toMonitorNameMapping(defaultConfig.monitorNameMapping),
        showOnlyConfigured: defaultConfig.showOnlyConfigured ?? undefined,
        uptimeTransformRules: defaultConfig.uptimeTransformRules || undefined,
        uptimeStaticData: defaultConfig.uptimeStaticData || undefined,
        modelRates,
      };
    }

    return {
      id: config.id,
      globalMultiplier: Number(config.globalMultiplier),
      maxConcurrency: config.maxConcurrency,
      queueTimeout: config.queueTimeout,
      upstreamStreamTimeout: config.upstreamStreamTimeout,
      enableQueue: config.enableQueue,
      apiCatalogPoolVisibility:
        config.apiCatalogPoolVisibility === "anonymous-range" ? "anonymous-range" : "hidden",
      uptimeStatusUrl: config.uptimeStatusUrl || undefined,
      monitorNameMapping: toMonitorNameMapping(config.monitorNameMapping),
      showOnlyConfigured: config.showOnlyConfigured ?? undefined,
      uptimeTransformRules: config.uptimeTransformRules || undefined,
      uptimeStaticData: config.uptimeStaticData || undefined,
      modelRates,
    };
  }

  async updateRelayConfig(
    data: UpdateRelayConfigRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayConfigDto> {
    let existing: any;
    try {
      existing = await this.relayConfigRepository.findLatestActive();
    } catch {
      throw new NotFoundError("Relay config not found (database schema out of sync, run migrations)");
    }

    if (!existing) throw new NotFoundError("Relay config not found");

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

    await this.relayConfigRepository.updateConfigAndModelRates(
      existing.id,
      {
        globalMultiplier: data.globalMultiplier,
        maxConcurrency: data.maxConcurrency,
        queueTimeout: data.queueTimeout,
        upstreamStreamTimeout: data.upstreamStreamTimeout,
        enableQueue: data.enableQueue,
        apiCatalogPoolVisibility: data.apiCatalogPoolVisibility,
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
      },
      normalizedModelRates,
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CONFIG_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: existing.id,
      targetResourceType: "RELAY_CONFIG",
      description: "更新了中转配置",
      changes: maskSensitiveData(summarizeRelayConfigChanges(data)),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.getRelayConfig();
  }
}
