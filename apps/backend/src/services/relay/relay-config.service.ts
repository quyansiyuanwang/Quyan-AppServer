import { assertRelayConfigurationTopology } from "@/util/relay-configuration-topology";
import { prepareRelayConfigurationUpdate } from "@/util/relay-configuration-update";
import { projectRelayConfiguration, projectRelayModelRates } from "./relay-configuration-projection";
import type { ModelPricingItemDto, RelayConfigDto, UpdateRelayConfigRequest } from "@/api/dto/relay/relay-config.dto";
import { NotFoundError } from "@/util/errors";
import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import { RelayConfigRepository } from "@/store/relay/relay-config.repository";
import type { ModelPricingStore } from "@/store/relay/model-pricing.store";
import type { RelayConfigStore } from "@/store/relay/relay-config.store";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { RECORD_STATUS } from "@/constant/status";
import type { Request } from "express";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";

const summarizeRelayConfigChanges = (data: UpdateRelayConfigRequest) => ({
  globalMultiplier: data.globalMultiplier,
  maxConcurrency: data.maxConcurrency,
  queueTimeout: data.queueTimeout,
  upstreamStreamTimeout: data.upstreamStreamTimeout,
  preflightBufferLimitBytes: data.preflightBufferLimitBytes,
  enableQueue: data.enableQueue,
  apiCatalogPoolVisibility: data.apiCatalogPoolVisibility,
  channelTopologyMode: data.channelTopologyMode,
  uptimeStatusConfigured: data.uptimeStatusUrl === undefined ? undefined : Boolean(data.uptimeStatusUrl),
  monitorNameMappingCount:
    data.monitorNameMapping === undefined ? undefined : Object.keys(data.monitorNameMapping ?? {}).length,
  showOnlyConfigured: data.showOnlyConfigured,
  uptimeTransformRulesProvided: data.uptimeTransformRules === undefined ? undefined : true,
  uptimeStaticDataProvided: data.uptimeStaticData === undefined ? undefined : true,
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

  /** Strict mode is an explicit migration gate, never a best-effort conversion. */
  private async assertStrictTwoTierTopology(): Promise<void> {
    const channels = await RelayChannelRepository.getInstance().listVisible();
    assertRelayConfigurationTopology(channels);
  }

  private async fetchModelRates(): Promise<ModelPricingItemDto[]> {
    const models = await this.modelPricingRepository.listActiveOrderedByModel();
    return projectRelayModelRates(models);
  }

  async getRelayConfig(): Promise<RelayConfigDto> {
    let config;
    try {
      config = await this.relayConfigRepository.findLatestActive();
    } catch {
      return projectRelayConfiguration(null, await this.fetchModelRates().catch(() => []));
    }
    const modelRates = await this.fetchModelRates();
    if (!config)
      config = await this.relayConfigRepository.create({ ...DEFAULT_RELAY_CONFIG, status: RECORD_STATUS.ACTIVE });
    return projectRelayConfiguration(config, modelRates);
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
      throw new NotFoundError("Relay config not found (database schema out of sync, run migrations)", undefined, {
        messageKey: "relay.configSchemaOutOfSync",
      });
    }

    if (!existing) throw new NotFoundError("Relay config not found", undefined, { messageKey: "relay.configNotFound" });

    if (data.channelTopologyMode === "strict-two-tier" && existing.channelTopologyMode !== "strict-two-tier")
      await this.assertStrictTwoTierTopology();

    const prepared = prepareRelayConfigurationUpdate(data);
    await this.relayConfigRepository.updateConfigAndModelRates(existing.id, prepared.configData, prepared.modelRates);
    await this.logConfigurationUpdate(data, actorUserId, existing.id, request);
    return this.getRelayConfig();
  }

  async logConfigurationUpdate(
    data: UpdateRelayConfigRequest,
    actorUserId: string,
    configId: string,
    request?: Request,
  ): Promise<void> {
    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CONFIG_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: configId,
      targetResourceType: "RELAY_CONFIG",
      description: "更新了中转配置",
      changes: maskSensitiveData(summarizeRelayConfigChanges(data)),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }
}
