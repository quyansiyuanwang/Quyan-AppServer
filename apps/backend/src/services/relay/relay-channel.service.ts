import type {
  BatchDeleteRelayChannelsRequest,
  BatchRelayChannelsResultDto,
  BatchSetRelayChannelStatusRequest,
  BatchUpdateRelayChannelsRequest,
  BatchUpdateRelayChannelsResponse,
  BatchUpdateRelayChannelHealthConfigRequest,
  CreateRelayChannelRequest,
  DuplicateRelayChannelRequest,
  ExportRelayChannelsRequest,
  ImportRelayChannelsRequest,
  ImportRelayChannelsResponse,
  RelayChannelDto,
  RelayCatalogOptionDto,
  RelayRoutingCatalogOptionDto,
  RelayCatalogModelPriceRangeDto,
  RelayChannelOptionDto,
  RelayChannelExportItemDto,
  RelayChannelExportResponse,
  RelayChannelManagementListItemDto,
  RelayChannelTopologyAuditDto,
  RelayChannelImportItemDto,
  RelayChannelAllowedModelsMode,
  RelayAutomaticProxyPoolOptionDto,
  RelayAutomaticPoolHealthDto,
  RelayAutomaticPoolHealthMemberDto,
  RelayChannelHealthDto,
  RelayChannelHealthOverviewDto,
  RelayChannelHealthOverviewItemDto,
  RelayChannelHealthTrackingMode,
  RelayPoolPricingMemberOptionDto,
  RelayPoolPricingOptionDto,
  ContextLengthMultiplierRule,
  TimePeriodMultiplierRule,
  UpdateRelayChannelRequest,
  UpdateRelayChannelHealthConfigRequest,
  RelayChannelMemberDto,
  RelayChannelRoutingConfigDto,
  RelayChannelRoutingStrategy,
  RelayChannelType,
  RelayChannelVisibilityConfigDto,
  RelayChannelVisibilityMode,
} from "@/api/dto/relay/relay-channel.dto";
import type { PaginatedResponse } from "@/api/dto/common/common.dto";
import type { ModelPricingDto } from "@/api/dto/relay/model-pricing.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import {
  RELAY_CHANNEL_STATUS,
  VISIBLE_RELAY_CHANNEL_STATUSES,
  type RelayChannelStatus,
} from "@/constant/relay-channel";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import type { RelayChannelStore } from "@/store/relay/relay-channel.store";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import type { RamRoleStore } from "@/store/users/ram-role.store";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@/constant/permission";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/util/errors";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { Prisma, type RelayChannel } from "@prisma/client";
import { formatRelayRequestFormats } from "@appserver/shared";
import type { Request } from "express";
import { ModelPricingService } from "./model-pricing.service";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { RelayChannelHealthService, type RelayChannelHealthSnapshot } from "./relay-channel-health.service";
import { RelayConfigService } from "./relay-config.service";

const COPY_SUFFIX = "（副本）";
const MAX_CHANNEL_NAME_LENGTH = 100;
const POOLED_ALLOWED_MODE_VALUES = new Set(["all", "manual", "auto"] as const);
const isPoolType = (type: RelayChannelType): boolean => type === "pooled" || type === "automatic-proxy-pool";
const isUpstreamChannelType = (type: RelayChannelType): boolean => type === "standalone" || type === "pooled-member";

interface ValidatedRelayChannelData {
  name: string;
  channelType: RelayChannelType;
  routingStrategy: RelayChannelRoutingStrategy;
  routingConfig?: RelayChannelRoutingConfigDto | null;
  visibilityMode: RelayChannelVisibilityMode;
  visibilityConfig?: RelayChannelVisibilityConfigDto | null;
  poolMembers?: RelayChannelMemberDto[] | null;
  pooledParentId?: string | null;
  pooledPriority: number;
  pooledWeight: number;
  pooledMemberEnabled: boolean;
  openaiUpstreamUrl?: string;
  openaiUpstreamApiKey?: string;
  anthropicUpstreamUrl?: string;
  anthropicUpstreamApiKey?: string;
  geminiUpstreamUrl?: string;
  geminiUpstreamApiKey?: string;
  multiplier: number;
  allowedFormats: string;
  allowedModels?: string | null;
  addUserIdentifier: boolean;
  inputTokensIncludeCacheRead: boolean;
  modelMapping?: Record<string, string> | null;
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
  contextLengthMultipliers?: ContextLengthMultiplierRule[] | null;
}

const DEFAULT_CHANNEL_TYPE: RelayChannelType = "standalone";
const DEFAULT_ROUTING_STRATEGY: RelayChannelRoutingStrategy = "priority";
const DEFAULT_VISIBILITY_MODE: RelayChannelVisibilityMode = "public";
const DEFAULT_AUTOMATIC_POOL_RANKING_MODE = "price-first" as const;

type RelayChannelWithMembers = RelayChannel & {
  poolMembers?: Array<{
    memberChannelId: string;
    priority: number;
    weight: Prisma.Decimal | number;
    enabled: boolean;
    memberChannel?: RelayChannel | null;
  }>;
};

export class RelayChannelService {
  private static instance: RelayChannelService;

  private constructor(
    private readonly relayChannelRepository: RelayChannelStore = RelayChannelRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly ramRoleRepository: RamRoleStore = RamRoleRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
    private readonly modelPricingService: ModelPricingService = ModelPricingService.getInstance(),
    private readonly relayPoolResolver: RelayPoolResolverService = RelayPoolResolverService.getInstance(),
    private readonly relayChannelHealthService: RelayChannelHealthService = RelayChannelHealthService.getInstance(),
    private readonly relayConfigService: RelayConfigService = RelayConfigService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new RelayChannelService();
    return this.instance;
  }

  async listChannels(actorUserId: string, includeDisabled = false): Promise<RelayChannelDto[]> {
    const channels = includeDisabled
      ? await this.relayChannelRepository.listVisible()
      : await this.relayChannelRepository.listActive();
    const visibleChannels = await this.filterAccessibleChannels(channels, actorUserId);
    const modelCatalog = await this.modelPricingService.getModelPricing();
    return Promise.all(visibleChannels.map((channel) => this.toDto(channel, modelCatalog, includeDisabled)));
  }

  /**
   * Resolves the sole direct pooled parent that may be named in this user's billing history.
   * Private and hidden pools are intentionally never returned, including to administrators.
   */
  async resolveUniqueAccessibleDirectPooledParent(
    memberChannelId: string,
    actorUserId: string,
  ): Promise<RelayChannel | null> {
    const candidates = (
      await this.relayChannelRepository.listActiveDirectPooledParentsByMemberChannelId(memberChannelId)
    ).filter((channel) => {
      const visibilityMode =
        (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE;
      return visibilityMode === "public" || visibilityMode === "whitelist";
    });
    const accessResults = await Promise.all(
      candidates.map((channel) => this.canUserAccessChannel(channel, actorUserId, false)),
    );
    const accessibleCandidates = candidates.filter((_, index) => accessResults[index]);
    return accessibleCandidates.length === 1 ? accessibleCandidates[0]! : null;
  }

  async listManagementChannels(
    actorUserId: string,
    query: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      channelType?: RelayChannelType;
      enabled?: boolean;
    },
  ): Promise<PaginatedResponse<RelayChannelManagementListItemDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.RelayChannelWhereInput = {
      status:
        query.enabled === undefined
          ? { in: VISIBLE_RELAY_CHANNEL_STATUSES }
          : query.enabled
            ? RELAY_CHANNEL_STATUS.ENABLED
            : RELAY_CHANNEL_STATUS.DISABLED,
    };

    if (query.keyword?.trim()) where.name = { contains: query.keyword.trim() };
    if (query.channelType) where.channelType = query.channelType;

    const visibilityWhere = await this.buildManagementVisibilityWhere(actorUserId);
    if (visibilityWhere) where.AND = [visibilityWhere];

    const { records, total } = await this.relayChannelRepository.listManagementPage({
      where,
      page,
      pageSize,
    });

    return {
      items: records.map((channel) => ({
        id: channel.id,
        name: channel.name,
        enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
        channelType: (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE,
        routingStrategy:
          (channel.routingStrategy as RelayChannelRoutingStrategy | undefined) ?? DEFAULT_ROUTING_STRATEGY,
        visibilityMode: (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE,
        poolMemberCount:
          ((channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE) === "pooled"
            ? channel._count.pooledChildren
            : channel._count.poolMembers,
        multiplier: Number(channel.multiplier),
        updateTime: channel.updateTime,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listChannelOptions(
    actorUserId: string,
    targetUserId?: string,
    listOptions: { excludePooled?: boolean } = {},
  ): Promise<RelayChannelOptionDto[]> {
    const effectiveUserId = await this.resolveOptionsUserId(actorUserId, targetUserId);
    const canViewPoolMetadata = await this.permissionService.hasPermission(
      actorUserId,
      Permission.RELAY_CHANNEL_POOL_METADATA_READ,
    );
    const activeChannels = await this.relayChannelRepository.listActive();
    const accessibleChannels = await this.filterAccessibleChannels(activeChannels, effectiveUserId);
    const activeChannelsById = new Map(activeChannels.map((channel) => [channel.id, channel]));
    const channels = accessibleChannels.filter((channel) => {
      const channelType = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
      return (
        (channel.visibilityMode as RelayChannelVisibilityMode | undefined) !== "hidden" &&
        !(listOptions.excludePooled === true && channelType === "pooled")
      );
    });
    const modelCatalog = await this.modelPricingService.getModelPricing();
    const resolverContext = await this.relayPoolResolver.preloadContext(modelCatalog);
    const now = new Date();
    const options = await Promise.all(
      channels.map(async (channel) => {
        const resolvedCapabilities = await this.relayPoolResolver.resolveChannelCapabilities(
          channel.id,
          resolverContext,
        );
        const modelCapabilities = new Map<string, RelayChannelOptionDto["modelCapabilities"][number]>();
        for (const capability of resolvedCapabilities) {
          const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
          const existing = modelCapabilities.get(key);
          if (existing) {
            existing.supportedRequestFormats = [
              ...new Set([...existing.supportedRequestFormats, ...capability.supportedRequestFormats]),
            ];
          } else {
            modelCapabilities.set(key, {
              catalogModelName: capability.catalogModelName,
              requestModelId: capability.requestModelId,
              supportedRequestFormats: [...capability.supportedRequestFormats],
            });
          }
        }

        const channelType = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
        const option: RelayChannelOptionDto = {
          id: channel.id,
          name: channel.name,
          enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
          ...(canViewPoolMetadata ? { channelType } : {}),
          multiplier: Number(channel.multiplier),
          contextLengthMultipliers: channel.contextLengthMultipliers as unknown as
            | ContextLengthMultiplierRule[]
            | undefined,
          allowedFormats: isPoolType(channelType)
            ? formatRelayRequestFormats([
                ...new Set([...modelCapabilities.values()].flatMap((item) => item.supportedRequestFormats)),
              ])
            : channel.allowedFormats,
          modelCapabilities: [...modelCapabilities.values()].sort(
            (left, right) =>
              left.catalogModelName.localeCompare(right.catalogModelName) ||
              left.requestModelId.localeCompare(right.requestModelId),
          ),
        };

        if (canViewPoolMetadata && channelType === "automatic-proxy-pool") {
          option.automaticProxyPool = this.toAutomaticProxyPoolOption(
            channel as RelayChannelWithMembers,
            resolvedCapabilities,
            now,
          );
        }
        if (canViewPoolMetadata && isPoolType(channelType)) {
          option.poolPricing = this.toPoolPricingOption(resolvedCapabilities, activeChannelsById, now);
        }

        return option;
      }),
    );

    return options.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getTopologyAudit(actorUserId: string): Promise<RelayChannelTopologyAuditDto> {
    const [config, channels] = await Promise.all([
      this.relayConfigService.getRelayConfig(),
      this.relayChannelRepository.listVisible(),
    ]);
    const visible = await this.filterAccessibleChannels(channels, actorUserId);
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const issues: RelayChannelTopologyAuditDto["issues"] = [];
    for (const channel of visible) {
      const type = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
      const members = (channel as RelayChannelWithMembers).poolMembers ?? [];
      if (type === "pooled" && members.length)
        issues.push({
          code: "legacy_pool_members",
          channelId: channel.id,
          channelName: channel.name,
          message: "Uses legacy pool members",
        });
      if (type === "pooled-member") {
        const parent = channel.pooledParentId ? byId.get(channel.pooledParentId) : undefined;
        if (!parent || parent.channelType !== "pooled")
          issues.push({
            code: "invalid_pooled_parent",
            channelId: channel.id,
            channelName: channel.name,
            message: "Missing valid logical pooled parent",
          });
      }
      if (type === "automatic-proxy-pool")
        for (const member of members) {
          const target = byId.get(member.memberChannelId);
          if (!target || target.channelType !== "pooled")
            issues.push({
              code: "automatic_pool_physical_member",
              channelId: channel.id,
              channelName: channel.name,
              message: "Automatic pool contains a non-logical member",
            });
        }
    }
    return { mode: config.channelTopologyMode, canEnableStrict: issues.length === 0, issues };
  }

  /**
   * User-facing routing selection is deliberately separate from the management
   * options endpoint. Physical pooled members must never be enumerable here,
   * while automatic-pool membership remains visible as logical pooled routes so
   * a token owner can make an informed blocking decision.
   */
  async listRoutingCatalogOptions(actorUserId: string, targetUserId?: string): Promise<RelayRoutingCatalogOptionDto[]> {
    const effectiveUserId = await this.resolveOptionsUserId(actorUserId, targetUserId);
    const [activeChannels, modelCatalog] = await Promise.all([
      this.relayChannelRepository.listActive(),
      this.modelPricingService.getModelPricing(),
    ]);
    const accessible = await this.filterAccessibleChannels(activeChannels, effectiveUserId);
    const resolverContext = await this.relayPoolResolver.preloadContext(modelCatalog);
    const now = new Date();

    const selectable = accessible.filter((channel) => {
      const type = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
      return (
        (channel.visibilityMode as RelayChannelVisibilityMode | undefined) !== "hidden" &&
        (type === "standalone" || type === "pooled" || type === "automatic-proxy-pool")
      );
    });

    const options = await Promise.all(
      selectable.map(async (channel) => {
        const channelType = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
        const routingChannelType = channelType as RelayRoutingCatalogOptionDto["channelType"];
        const capabilities = await this.relayPoolResolver.resolveChannelCapabilities(channel.id, resolverContext);
        const modelCapabilities = new Map<string, RelayRoutingCatalogOptionDto["modelCapabilities"][number]>();
        for (const capability of capabilities) {
          const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
          const existing = modelCapabilities.get(key);
          if (existing) {
            existing.supportedRequestFormats = [
              ...new Set([...existing.supportedRequestFormats, ...capability.supportedRequestFormats]),
            ];
          } else {
            modelCapabilities.set(key, {
              catalogModelName: capability.catalogModelName,
              requestModelId: capability.requestModelId,
              supportedRequestFormats: [...capability.supportedRequestFormats],
            });
          }
        }
        return {
          id: channel.id,
          name: channel.name,
          enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
          channelType: routingChannelType,
          multiplier: Number(channel.multiplier),
          contextLengthMultipliers: channel.contextLengthMultipliers as unknown as
            | ContextLengthMultiplierRule[]
            | undefined,
          allowedFormats: formatRelayRequestFormats([
            ...new Set([...modelCapabilities.values()].flatMap((item) => item.supportedRequestFormats)),
          ]),
          modelCapabilities: [...modelCapabilities.values()].sort(
            (left, right) =>
              left.catalogModelName.localeCompare(right.catalogModelName) ||
              left.requestModelId.localeCompare(right.requestModelId),
          ),
          ...(channelType === "automatic-proxy-pool"
            ? {
                automaticProxyPool: this.toAutomaticProxyPoolOption(
                  channel as RelayChannelWithMembers,
                  capabilities,
                  now,
                ),
              }
            : {}),
        } satisfies RelayRoutingCatalogOptionDto;
      }),
    );
    return options.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * API documentation projection. Variable-priced logical channels are published without their
   * pool identity, members, or routing details; consumers only receive per-model price ranges.
   */
  async listCatalogOptions(actorUserId: string): Promise<RelayCatalogOptionDto[]> {
    const [relayConfig, activeChannels, modelCatalog] = await Promise.all([
      this.relayConfigService.getRelayConfig(),
      this.relayChannelRepository.listActive(),
      this.modelPricingService.getModelPricing(),
    ]);
    const accessibleChannels = await this.filterAccessibleChannels(activeChannels, actorUserId);
    const activeChannelsById = new Map(activeChannels.map((channel) => [channel.id, channel]));
    const now = new Date();
    const resolverContext = await this.relayPoolResolver.preloadContext(modelCatalog);
    const publishedPoolMemberIds = new Set<string>();
    if (relayConfig.apiCatalogPoolVisibility === "anonymous-range") {
      const publishedPoolRoots = accessibleChannels.filter((channel) => {
        const type = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
        return isPoolType(type) && (channel.visibilityMode as RelayChannelVisibilityMode | undefined) !== "hidden";
      });

      const visitPool = (channelId: string) => {
        const channel = activeChannelsById.get(channelId) as RelayChannelWithMembers | undefined;
        if (!channel) return;

        for (const member of channel.poolMembers ?? []) {
          if (publishedPoolMemberIds.has(member.memberChannelId)) continue;
          publishedPoolMemberIds.add(member.memberChannelId);
          const memberType =
            (activeChannelsById.get(member.memberChannelId)?.channelType as RelayChannelType | undefined) ??
            DEFAULT_CHANNEL_TYPE;
          if (isPoolType(memberType)) visitPool(member.memberChannelId);
        }
      };

      for (const root of publishedPoolRoots) visitPool(root.id);
    }

    const channels = accessibleChannels.filter((channel) => {
      const type = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
      return (
        (channel.visibilityMode as RelayChannelVisibilityMode | undefined) !== "hidden" &&
        (relayConfig.apiCatalogPoolVisibility === "anonymous-range" || !isPoolType(type)) &&
        !publishedPoolMemberIds.has(channel.id)
      );
    });

    const options = await Promise.all(
      channels.map(async (channel) => {
        const channelType = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
        const resolvedCapabilities = await this.relayPoolResolver.resolveChannelCapabilities(
          channel.id,
          resolverContext,
        );
        const modelCapabilities = this.toCatalogModelCapabilities(resolvedCapabilities);

        if (channelType === "automatic-proxy-pool") {
          return {
            id: channel.id,
            name: channel.name,
            enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
            allowedFormats: formatRelayRequestFormats([
              ...new Set(modelCapabilities.flatMap((item) => item.supportedRequestFormats)),
            ]),
            modelCapabilities,
            pricingMode: "range" as const,
            modelPriceRanges: this.toCatalogModelPriceRanges(resolvedCapabilities, activeChannelsById, now),
            pricingEffectiveAt: now,
            priceMayVary: true,
          } satisfies RelayCatalogOptionDto;
        }

        return {
          id: channel.id,
          name: channel.name,
          enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
          allowedFormats:
            channelType === "pooled"
              ? formatRelayRequestFormats([
                  ...new Set(modelCapabilities.flatMap((item) => item.supportedRequestFormats)),
                ])
              : channel.allowedFormats,
          modelCapabilities,
          pricingMode: "fixed" as const,
          multiplier:
            Number(channel.multiplier) *
            computeMultiplierForTime(
              (channel.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
              now,
            ),
          contextLengthMultipliers: channel.contextLengthMultipliers as unknown as
            | ContextLengthMultiplierRule[]
            | undefined,
          pricingEffectiveAt: now,
          priceMayVary: false,
        } satisfies RelayCatalogOptionDto;
      }),
    );

    return options.sort((left, right) => left.name.localeCompare(right.name));
  }

  private toCatalogModelCapabilities(
    resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
  ): RelayCatalogOptionDto["modelCapabilities"] {
    const capabilities = new Map<string, RelayCatalogOptionDto["modelCapabilities"][number]>();
    for (const capability of resolvedCapabilities) {
      const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
      const existing = capabilities.get(key);
      if (existing) {
        existing.supportedRequestFormats = [
          ...new Set([...existing.supportedRequestFormats, ...capability.supportedRequestFormats]),
        ];
      } else {
        capabilities.set(key, {
          catalogModelName: capability.catalogModelName,
          requestModelId: capability.requestModelId,
          supportedRequestFormats: [...capability.supportedRequestFormats],
        });
      }
    }
    return [...capabilities.values()].sort(
      (left, right) =>
        left.catalogModelName.localeCompare(right.catalogModelName) ||
        left.requestModelId.localeCompare(right.requestModelId),
    );
  }

  private toCatalogModelPriceRanges(
    resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
    activeChannelsById: ReadonlyMap<string, RelayChannel>,
    now: Date,
  ): RelayCatalogModelPriceRangeDto[] {
    const ranges = new Map<string, RelayCatalogModelPriceRangeDto>();

    for (const capability of resolvedCapabilities) {
      const leaf = activeChannelsById.get(capability.leafChannelId);
      if (!leaf || leaf.status !== RELAY_CHANNEL_STATUS.ENABLED) continue;

      const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
      const multipliers = this.getCatalogContextMultipliers(leaf, now);
      if (multipliers.length === 0) continue;

      const minMultiplier = Math.min(...multipliers);
      const maxMultiplier = Math.max(...multipliers);
      const existing = ranges.get(key);
      if (existing) {
        existing.minMultiplier = Math.min(existing.minMultiplier, minMultiplier);
        existing.maxMultiplier = Math.max(existing.maxMultiplier, maxMultiplier);
      } else {
        ranges.set(key, {
          catalogModelName: capability.catalogModelName,
          requestModelId: capability.requestModelId,
          minMultiplier,
          maxMultiplier,
        });
      }
    }

    return [...ranges.values()].sort(
      (left, right) =>
        left.catalogModelName.localeCompare(right.catalogModelName) ||
        left.requestModelId.localeCompare(right.requestModelId),
    );
  }

  private getCatalogContextMultipliers(channel: RelayChannel, now: Date): number[] {
    const baseMultiplier =
      Number(channel.multiplier) *
      computeMultiplierForTime(
        (channel.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
        now,
      );
    const rules = (channel.contextLengthMultipliers as ContextLengthMultiplierRule[] | null | undefined) ?? [];
    const contextMultipliers = rules.filter((rule) => rule.enabled).map((rule) => Number(rule.multiplier));
    if (!contextMultipliers.includes(1)) contextMultipliers.push(1);
    return contextMultipliers.filter(Number.isFinite).map((multiplier) => baseMultiplier * multiplier);
  }

  private toAutomaticProxyPoolOption(
    channel: RelayChannelWithMembers,
    resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
    now: Date,
  ): RelayAutomaticProxyPoolOptionDto {
    const capabilitiesByLeafChannelId = this.groupCapabilitiesByLeafChannelId(resolvedCapabilities);

    const routingConfig = (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined) ?? undefined;
    const { allowedModelsMode: _allowedModelsMode, ...safeRoutingConfig } = routingConfig ?? {};

    return {
      routingStrategy: (channel.routingStrategy as RelayChannelRoutingStrategy | undefined) ?? DEFAULT_ROUTING_STRATEGY,
      routingConfig: Object.keys(safeRoutingConfig).length > 0 ? safeRoutingConfig : undefined,
      members: (channel.poolMembers ?? [])
        .filter((member) => member.enabled !== false && member.memberChannel?.status === RELAY_CHANNEL_STATUS.ENABLED)
        .map((member) => {
          const memberChannel = member.memberChannel;
          const timePeriodMultiplier = memberChannel
            ? computeMultiplierForTime(
                (memberChannel.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
                now,
              )
            : 1;
          const multiplier = memberChannel ? Number(memberChannel.multiplier) : 1;
          const modelCapabilities = (capabilitiesByLeafChannelId.get(member.memberChannelId) ?? []).map(
            (capability) => ({
              ...capability,
              supportedRequestFormats: [...capability.supportedRequestFormats],
            }),
          );

          return {
            id: member.memberChannelId,
            name: memberChannel?.name ?? member.memberChannelId,
            enabled: true,
            priority: member.priority,
            weight: Number(member.weight),
            multiplier,
            timePeriodMultiplier,
            effectiveMultiplier: multiplier * timePeriodMultiplier,
            contextLengthMultipliers: memberChannel?.contextLengthMultipliers as
              | ContextLengthMultiplierRule[]
              | undefined,
            allowedFormats: memberChannel?.allowedFormats ?? "none",
            modelCapabilities,
          };
        })
        .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    };
  }

  private toPoolPricingOption(
    resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
    activeChannelsById: ReadonlyMap<string, RelayChannel>,
    now: Date,
  ): RelayPoolPricingOptionDto {
    const capabilitiesByLeafChannelId = this.groupCapabilitiesByLeafChannelId(resolvedCapabilities);
    const members: RelayPoolPricingMemberOptionDto[] = [];

    for (const [channelId, modelCapabilities] of capabilitiesByLeafChannelId) {
      const channel = activeChannelsById.get(channelId);
      if (!channel) continue;
      const multiplier = Number(channel.multiplier);
      const timePeriodMultiplier = computeMultiplierForTime(
        (channel.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
        now,
      );
      members.push({
        id: channel.id,
        name: channel.name,
        enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
        multiplier,
        timePeriodMultiplier,
        effectiveMultiplier: multiplier * timePeriodMultiplier,
        contextLengthMultipliers: channel.contextLengthMultipliers as unknown as
          | ContextLengthMultiplierRule[]
          | undefined,
        modelCapabilities: modelCapabilities.map((capability) => ({
          ...capability,
          supportedRequestFormats: [...capability.supportedRequestFormats],
        })),
      });
    }

    return {
      members: members.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    };
  }

  private groupCapabilitiesByLeafChannelId(
    resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
  ): Map<string, RelayChannelOptionDto["modelCapabilities"]> {
    const capabilitiesByLeafChannelId = new Map<string, RelayChannelOptionDto["modelCapabilities"]>();

    for (const capability of resolvedCapabilities) {
      const capabilities = capabilitiesByLeafChannelId.get(capability.leafChannelId) ?? [];
      const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
      const existing = capabilities.find((item) => `${item.catalogModelName}\u0000${item.requestModelId}` === key);
      if (existing) {
        existing.supportedRequestFormats = [
          ...new Set([...existing.supportedRequestFormats, ...capability.supportedRequestFormats]),
        ];
      } else {
        capabilities.push({
          catalogModelName: capability.catalogModelName,
          requestModelId: capability.requestModelId,
          supportedRequestFormats: [...capability.supportedRequestFormats],
        });
      }
      capabilitiesByLeafChannelId.set(capability.leafChannelId, capabilities);
    }

    return capabilitiesByLeafChannelId;
  }

  private async resolveOptionsUserId(actorUserId: string, targetUserId?: string): Promise<string> {
    const normalizedTargetUserId = String(targetUserId || "").trim();
    if (!normalizedTargetUserId || normalizedTargetUserId === actorUserId) return actorUserId;

    const canManageOthers = await this.permissionService.hasPermission(
      actorUserId,
      Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    );
    if (!canManageOthers) throw new NotFoundError("Relay channel options not found");

    return normalizedTargetUserId;
  }

  async getChannel(id: string, actorUserId: string): Promise<RelayChannelDto> {
    const channel = await this.relayChannelRepository.findVisibleById(id);
    if (!channel) throw new NotFoundError("Relay channel not found");
    await this.assertChannelAccessible(channel, actorUserId);
    return this.toDto(channel);
  }

  async getChannelHealth(
    id: string,
    actorUserId: string,
  ): Promise<RelayChannelHealthDto | RelayAutomaticPoolHealthDto> {
    const channel = await this.assertChannelAccessibleById(id, actorUserId);
    const channelType = (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE;
    if (channelType !== "standalone") {
      const canViewPoolMetadata = await this.permissionService.hasPermission(
        actorUserId,
        Permission.RELAY_CHANNEL_POOL_METADATA_READ,
      );
      if (!canViewPoolMetadata) throw new NotFoundError("Relay channel not found");
    }
    if (channelType !== "automatic-proxy-pool") {
      const snapshot = await this.relayChannelHealthService.getHealth(channel.id);
      return this.toHealthDto(channel, snapshot);
    }

    const now = new Date();
    const poolMembers = (channel as RelayChannelWithMembers).poolMembers ?? [];
    const rankingMode =
      (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)?.rankingMode === "stability-first"
        ? "stability-first"
        : DEFAULT_AUTOMATIC_POOL_RANKING_MODE;
    const dynamicMemberRankingEnabled =
      (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)?.dynamicMemberRankingEnabled !== false;
    const rankedMembers = await this.relayChannelHealthService.rankMembers(
      poolMembers.map((member) => {
        const memberChannel = member.memberChannel;
        const effectivePrice =
          Number(memberChannel?.multiplier ?? 1) *
          computeMultiplierForTime(
            (memberChannel?.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
            now,
          );
        return {
          id: member.memberChannelId,
          name: memberChannel?.name ?? member.memberChannelId,
          enabled: member.enabled !== false && memberChannel?.status === RELAY_CHANNEL_STATUS.ENABLED,
          priority: member.priority,
          weight: Number(member.weight),
          effectivePrice,
          ...this.getHealthTrackingConfig(memberChannel),
        };
      }),
      rankingMode,
      now,
      {
        healthScoreThreshold: (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
          ?.healthScoreThreshold,
        latencyThresholdMs: (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
          ?.latencyThresholdMs,
        circuitBreakerThreshold: (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
          ?.circuitBreakerThreshold,
      },
    );
    const window = rankedMembers[0]?.health ?? (await this.relayChannelHealthService.getHealth(channel.id, now));
    const displayedMembers = dynamicMemberRankingEnabled
      ? rankedMembers
      : [...rankedMembers].sort(
          (left, right) =>
            left.priority - right.priority || left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        );
    const members: RelayAutomaticPoolHealthMemberDto[] = displayedMembers.map((member, index) => ({
      ...member.health,
      name: member.name,
      enabled: member.enabled,
      priority: member.priority,
      weight: member.weight,
      effectivePrice: member.effectivePrice,
      score: member.score,
      rank: index + 1,
      eligible: member.eligible,
      exclusionReasons: member.exclusionReasons,
      trackingMode: member.healthTrackingMode ?? "automatic",
      source: member.source,
      manualAvailability:
        member.healthTrackingMode === "manual" ? this.toOptionalFiniteNumber(member.manualAvailability) : undefined,
      manualLatencyMs:
        member.healthTrackingMode === "manual" ? this.toOptionalFiniteNumber(member.manualLatencyMs) : undefined,
    }));

    return {
      channelId: channel.id,
      name: channel.name,
      rankingMode,
      dynamicMemberRankingEnabled,
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      members,
    };
  }

  async getChannelHealthOverview(actorUserId: string): Promise<RelayChannelHealthOverviewDto> {
    const channels = await this.filterAccessibleChannels(await this.relayChannelRepository.listVisible(), actorUserId);
    const standaloneChannels = channels.filter((channel) => channel.channelType === "standalone");
    const healthMap = await this.relayChannelHealthService.getHealthMap(
      standaloneChannels.map((channel) => channel.id),
    );
    const items: RelayChannelHealthOverviewItemDto[] = standaloneChannels
      .map((channel) => ({
        ...this.toHealthDto(channel, healthMap.get(channel.id)),
        name: channel.name,
        enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
        channelType: "standalone" as const,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.channelId.localeCompare(right.channelId));

    return { windowMinutes: RelayChannelHealthService.constants.windowMinutes, channels: items };
  }

  async getAutomaticPoolHealths(actorUserId: string): Promise<RelayAutomaticPoolHealthDto[]> {
    const canViewPoolMetadata = await this.permissionService.hasPermission(
      actorUserId,
      Permission.RELAY_CHANNEL_POOL_METADATA_READ,
    );
    if (!canViewPoolMetadata) throw new ForbiddenError("Relay pool metadata access is required");

    const channels = await this.filterAccessibleChannels(await this.relayChannelRepository.listVisible(), actorUserId);
    const pools = channels.filter(
      (channel) =>
        ((channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE) === "automatic-proxy-pool",
    );
    const healths = await Promise.all(pools.map((channel) => this.getChannelHealth(channel.id, actorUserId)));
    return healths.filter((health): health is RelayAutomaticPoolHealthDto => "members" in health);
  }

  async updateChannelHealthConfig(
    id: string,
    data: UpdateRelayChannelHealthConfigRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayChannelHealthDto> {
    const channel = await this.assertChannelAccessibleById(id, actorUserId);
    if (channel.channelType !== "standalone")
      throw new BadRequestError("Health tracking can only be configured for standalone channels");

    const routingConfig = (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined) ?? {};
    const nextConfig: RelayChannelRoutingConfigDto = {
      ...routingConfig,
      healthTrackingMode: data.healthTrackingMode,
      manualAvailability: data.healthTrackingMode === "manual" ? Number(data.manualAvailability) : null,
      manualLatencyMs: data.healthTrackingMode === "manual" ? Number(data.manualLatencyMs) : null,
    };
    const updated = await this.relayChannelRepository.updateById(id, {
      routingConfig: nextConfig as Prisma.InputJsonValue,
    });
    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: updated.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `更新了中转渠道 '${updated.name}' 的健康追踪设置`,
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return this.toHealthDto(updated, await this.relayChannelHealthService.getHealth(updated.id));
  }

  async batchUpdateChannelHealthConfig(
    data: BatchUpdateRelayChannelHealthConfigRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<BatchRelayChannelsResultDto> {
    const channels = await Promise.all(data.ids.map((id) => this.assertChannelAccessibleById(id, actorUserId)));
    if (channels.some((channel) => channel.channelType !== "standalone"))
      throw new BadRequestError("Health tracking can only be configured for standalone channels");

    const updated = await this.relayChannelRepository.withTransaction((tx) =>
      Promise.all(
        channels.map((channel) => {
          const routingConfig = (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined) ?? {};
          const nextConfig: RelayChannelRoutingConfigDto = {
            ...routingConfig,
            healthTrackingMode: data.healthTrackingMode,
            manualAvailability: data.healthTrackingMode === "manual" ? Number(data.manualAvailability) : null,
            manualLatencyMs: data.healthTrackingMode === "manual" ? Number(data.manualLatencyMs) : null,
          };
          return this.relayChannelRepository.updateById(
            channel.id,
            {
              routingConfig: nextConfig as Prisma.InputJsonValue,
            },
            tx,
          );
        }),
      ),
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `批量更新了 ${updated.length} 个中转渠道的健康追踪设置`,
      metadata: { ids: data.ids, healthTrackingMode: data.healthTrackingMode },
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return { total: data.ids.length, affected: updated.length };
  }

  async clearChannelHealth(id: string, actorUserId: string, request?: Request): Promise<void> {
    const channel = await this.assertChannelAccessibleById(id, actorUserId);
    if (channel.channelType !== "standalone")
      throw new BadRequestError("Health statistics only exist for standalone channels");
    const cleared = await this.relayChannelHealthService.clearHealth(channel.id);
    if (!cleared) throw new BadRequestError("Channel health storage is temporarily unavailable");
    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: channel.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `清空了中转渠道 '${channel.name}' 的健康统计`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async batchClearChannelHealth(
    ids: string[],
    actorUserId: string,
    request?: Request,
  ): Promise<BatchRelayChannelsResultDto> {
    const channels = await Promise.all(ids.map((id) => this.assertChannelAccessibleById(id, actorUserId)));
    if (channels.some((channel) => channel.channelType !== "standalone"))
      throw new BadRequestError("Health statistics only exist for standalone channels");
    const results = await Promise.all(
      channels.map((channel) => this.relayChannelHealthService.clearHealth(channel.id)),
    );
    if (results.some((cleared) => !cleared))
      throw new BadRequestError("Channel health storage is temporarily unavailable");

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `批量清空了 ${channels.length} 个中转渠道的健康统计`,
      metadata: { ids },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
    return { total: ids.length, affected: channels.length };
  }

  async assertChannelAccessibleById(id: string, actorUserId: string): Promise<RelayChannel> {
    const channel = await this.relayChannelRepository.findVisibleById(id);
    if (!channel) throw new NotFoundError("Relay channel not found");

    await this.assertChannelAccessible(channel, actorUserId);
    return channel;
  }

  async assertChannelBusinessSelectableById(id: string, actorUserId: string): Promise<RelayChannel> {
    const channel = await this.assertChannelAccessibleById(id, actorUserId);
    if ((channel.visibilityMode as RelayChannelVisibilityMode | undefined) === "hidden")
      throw new BadRequestError("Hidden relay channels can only be used as pooled channel members");
    if (channel.channelType === "automatic-proxy-pool")
      throw new BadRequestError("Automatic proxy pools can only be selected through token automatic routing mode");

    return channel;
  }

  async exportChannels(
    body: ExportRelayChannelsRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayChannelExportResponse> {
    let channels: RelayChannel[];
    if (body.ids?.length) {
      channels = await this.getOrderedChannelsByIds(body.ids, body.includeDisabled === true);
      for (const channel of channels) await this.assertChannelAccessible(channel, actorUserId);
    } else {
      const candidates =
        body.includeDisabled === true
          ? await this.relayChannelRepository.listVisible()
          : await this.relayChannelRepository.listActive();
      channels = await this.filterAccessibleChannels(candidates, actorUserId);
    }

    // Whether the user selected roots or exported the full list, make every pool export
    // self-contained. This also pulls disabled members referenced by an active pool.
    channels = await this.expandPoolExportDependencies(channels);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_EXPORT,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `导出了 ${channels.length} 个中转渠道`,
      metadata: {
        ids: body.ids,
        includeDisabled: body.includeDisabled === true,
        total: channels.length,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      channels: channels.map((channel) => this.toExportItemDto(channel)),
    };
  }

  private async expandPoolExportDependencies(roots: RelayChannel[]): Promise<RelayChannel[]> {
    const result = [...roots];
    const knownIds = new Set(result.map((channel) => channel.id));
    let cursor = 0;

    while (cursor < result.length) {
      const channel = result[cursor++];
      const members = (channel as RelayChannelWithMembers).poolMembers ?? [];
      const missingIds = members.map((member) => member.memberChannelId).filter((id) => !knownIds.has(id));
      if (missingIds.length === 0) continue;

      const dependencies = await this.relayChannelRepository.listVisibleByIds([...new Set(missingIds)]);
      if (dependencies.length !== new Set(missingIds).size)
        throw new BadRequestError("One or more pooled channel members were not found");

      for (const dependency of dependencies) {
        if (knownIds.has(dependency.id)) continue;
        knownIds.add(dependency.id);
        result.push(dependency);
      }
    }

    return result;
  }

  /**
   * Validate that allowedModels array doesn't contain multiple models with the same model ID
   */
  private async validateNoDuplicateModelIds(modelNames: string[]): Promise<void> {
    if (!modelNames || modelNames.length === 0) return;

    // Import here to avoid circular dependency
    const { ModelPricingService } = await import("./model-pricing.service");
    const modelPricingService = ModelPricingService.getInstance();
    const { resolveModelId } = await import("@/util/model-resolution.util");

    const allModels = await modelPricingService.getModelPricing();

    // Build a map of model name -> model ID
    const modelNameToId = new Map<string, string>();
    for (const model of allModels) {
      const modelName = (model.model || "").trim();
      const modelId = resolveModelId(model).trim();
      if (modelName && modelId) modelNameToId.set(modelName, modelId);
    }

    // Check for duplicate model IDs
    const seenModelIds = new Set<string>();
    const duplicates: Array<{ modelName: string; modelId: string }> = [];

    for (const modelName of modelNames) {
      const normalizedName = String(modelName || "").trim();
      if (!normalizedName) continue;

      const modelId = modelNameToId.get(normalizedName);
      if (!modelId) continue; // Unknown model, skip validation

      if (seenModelIds.has(modelId)) duplicates.push({ modelName: normalizedName, modelId });
      else seenModelIds.add(modelId);
    }

    if (duplicates.length > 0) {
      const duplicateInfo = duplicates.map((d) => `"${d.modelName}" (ID: ${d.modelId})`).join(", ");
      throw new BadRequestError(
        `allowedModels contains models with duplicate model IDs: ${duplicateInfo}. Each model ID should only appear once.`,
      );
    }
  }

  private async assertVisibleNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.relayChannelRepository.findVisibleByName(name);
    if (existing && existing.id !== excludeId) throw new ConflictError(`Relay channel name '${name}' already exists`);
  }

  private buildCopyName(baseName: string, reservedNames: Set<string>): string {
    for (let index = 1; index < 10000; index += 1) {
      const suffix = index === 1 ? COPY_SUFFIX : `（副本${index}）`;
      const trimmedBaseName = baseName.slice(0, Math.max(1, MAX_CHANNEL_NAME_LENGTH - suffix.length)).trim();
      const candidate = `${trimmedBaseName}${suffix}`;

      if (!reservedNames.has(candidate)) {
        reservedNames.add(candidate);
        return candidate;
      }
    }

    throw new BadRequestError("Unable to generate a unique relay channel name");
  }

  private async getVisibleNameSet(tx?: Parameters<RelayChannelStore["listVisible"]>[0]): Promise<Set<string>> {
    const channels = await this.relayChannelRepository.listVisible(tx);
    return new Set(channels.map((channel) => channel.name));
  }

  private async canBypassVisibility(actorUserId: string): Promise<boolean> {
    return this.permissionService.hasAnyPermission(actorUserId, [
      Permission.RELAY_CHANNEL_CREATE,
      Permission.RELAY_CHANNEL_UPDATE,
      Permission.RELAY_CHANNEL_DELETE,
    ]);
  }

  private async buildManagementVisibilityWhere(
    actorUserId: string,
  ): Promise<Prisma.RelayChannelWhereInput | undefined> {
    if (await this.canBypassVisibility(actorUserId)) return undefined;

    const user = await this.userRepository.findByIdWithGroup(actorUserId);
    const roleBindings = user
      ? await this.ramRoleRepository.listRoleBindingsForUser(actorUserId, user.groupId ?? null)
      : [];
    const roleIds = roleBindings.map((binding) => binding.roleId);
    const whitelistConditions: Prisma.RelayChannelWhereInput[] = [
      {
        visibilityMode: "whitelist",
        visibilityConfig: { path: "$.userIds", array_contains: actorUserId },
      },
    ];

    if (user?.groupId) {
      whitelistConditions.push({
        visibilityMode: "whitelist",
        visibilityConfig: { path: "$.groupIds", array_contains: user.groupId },
      });
    }

    for (const roleId of roleIds) {
      whitelistConditions.push({
        visibilityMode: "whitelist",
        visibilityConfig: { path: "$.roleIds", array_contains: roleId },
      });
    }

    return {
      OR: [{ visibilityMode: "public" }, ...whitelistConditions],
    };
  }

  private normalizeVisibilityConfig(
    visibilityConfig?: RelayChannelVisibilityConfigDto | null,
  ): Required<RelayChannelVisibilityConfigDto> {
    return {
      userIds: Array.isArray(visibilityConfig?.userIds) ? visibilityConfig.userIds.filter(Boolean) : [],
      groupIds: Array.isArray(visibilityConfig?.groupIds) ? visibilityConfig.groupIds.filter(Boolean) : [],
      roleIds: Array.isArray(visibilityConfig?.roleIds) ? visibilityConfig.roleIds.filter(Boolean) : [],
    };
  }

  private async canUserAccessChannel(
    channel: RelayChannel,
    actorUserId: string,
    allowManagementBypass = true,
  ): Promise<boolean> {
    if (allowManagementBypass && (await this.canBypassVisibility(actorUserId))) return true;

    const visibilityMode =
      (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE;
    if (visibilityMode === "public") return true;
    if (visibilityMode === "private") return false;
    if (visibilityMode === "hidden") return false;

    const { userIds, groupIds, roleIds } = this.normalizeVisibilityConfig(
      channel.visibilityConfig as RelayChannelVisibilityConfigDto | null | undefined,
    );

    if (userIds.includes(actorUserId)) return true;

    const user = await this.userRepository.findByIdWithGroup(actorUserId);
    if (!user) return false;

    if (user.groupId && groupIds.includes(user.groupId)) return true;

    if (roleIds.length === 0) return false;

    const roleBindings = await this.ramRoleRepository.listRoleBindingsForUser(actorUserId, user.groupId ?? null);
    return roleBindings.some((binding) => roleIds.includes(binding.roleId));
  }

  private async filterAccessibleChannels(channels: RelayChannel[], actorUserId: string): Promise<RelayChannel[]> {
    const accessResults = await Promise.all(channels.map((channel) => this.canUserAccessChannel(channel, actorUserId)));
    return channels.filter((_, index) => accessResults[index]);
  }

  private async assertChannelAccessible(channel: RelayChannel, actorUserId: string): Promise<void> {
    const canAccess = await this.canUserAccessChannel(channel, actorUserId);
    if (!canAccess) throw new NotFoundError("Relay channel not found");
  }

  private async getOrderedChannelsByIds(ids: string[], includeDisabled: boolean): Promise<RelayChannel[]> {
    const uniqueIds = [...new Set(ids)];
    const channels = includeDisabled
      ? await this.relayChannelRepository.listVisibleByIds(uniqueIds)
      : await this.relayChannelRepository.listActiveByIds(uniqueIds);

    if (channels.length !== uniqueIds.length) throw new NotFoundError("One or more relay channels were not found");

    const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
    return uniqueIds.map((id) => channelMap.get(id)!).filter(Boolean);
  }

  private normalizeAllowedFormats(value: string): { normalized: string; formats: string[] } {
    if (value === "both") throw new BadRequestError("allowedFormats 'both' is deprecated, use 'all' instead");
    if (value === "all") return { normalized: "all", formats: ["openai", "anthropic", "gemini"] };

    const formats = value
      .split(",")
      .map((format) => format.trim())
      .filter(Boolean);

    if (formats.length === 0) throw new BadRequestError("allowedFormats cannot be empty");

    const validFormats = new Set(["openai", "anthropic", "gemini"]);
    for (const format of formats)
      if (!validFormats.has(format))
        throw new BadRequestError(
          `Invalid format '${format}' in allowedFormats. Must be 'openai', 'anthropic', 'gemini', or 'all'`,
        );

    return { normalized: [...new Set(formats)].join(","), formats: [...new Set(formats)] };
  }

  private normalizeRelayChannelMembers(
    members?: RelayChannelMemberDto[] | null,
  ): RelayChannelMemberDto[] | null | undefined {
    if (members === undefined) return undefined;
    if (members === null) return null;
    const seen = new Set<string>();
    return members
      .map((member) => ({
        ...member,
        memberChannelId: member.memberChannelId.trim(),
        priority: Number(member.priority),
        weight: member.weight === undefined ? undefined : Number(member.weight),
        enabled: member.enabled !== false,
      }))
      .filter((member) => {
        if (!member.memberChannelId) return false;
        if (seen.has(member.memberChannelId)) return false;
        seen.add(member.memberChannelId);
        return true;
      })
      .sort((a, b) => a.priority - b.priority);
  }

  private normalizeRoutingConfig(
    routingConfig: RelayChannelRoutingConfigDto | null | undefined,
    channelType: RelayChannelType,
  ): RelayChannelRoutingConfigDto | null | undefined {
    if (routingConfig === undefined) return undefined;
    if (routingConfig === null) return null;

    const normalized: RelayChannelRoutingConfigDto = { ...routingConfig };

    const hasHealthTrackingConfig =
      Object.prototype.hasOwnProperty.call(normalized, "healthTrackingMode") ||
      Object.prototype.hasOwnProperty.call(normalized, "manualAvailability") ||
      Object.prototype.hasOwnProperty.call(normalized, "manualLatencyMs");
    if (channelType !== "standalone" && hasHealthTrackingConfig) {
      // Channel forms retain routing config while changing type. Health state has no meaning on pools,
      // so remove it rather than preventing a valid standalone-to-pool conversion.
      delete normalized.healthTrackingMode;
      delete normalized.manualAvailability;
      delete normalized.manualLatencyMs;
    }

    if (channelType === "standalone") {
      const mode = normalized.healthTrackingMode ?? "automatic";
      if (mode !== "automatic" && mode !== "manual" && mode !== "disabled")
        throw new BadRequestError(`Invalid healthTrackingMode '${String(mode)}'`);
      normalized.healthTrackingMode = mode;
      if (mode === "manual") {
        const availability = Number(normalized.manualAvailability);
        const latencyMs = Number(normalized.manualLatencyMs);
        if (!Number.isFinite(availability) || availability < 0 || availability > 1)
          throw new BadRequestError("manualAvailability must be between 0 and 1 for manual health tracking");
        if (!Number.isFinite(latencyMs) || latencyMs < 0)
          throw new BadRequestError("manualLatencyMs must be >= 0 for manual health tracking");
        normalized.manualAvailability = availability;
        normalized.manualLatencyMs = Math.floor(latencyMs);
      } else {
        normalized.manualAvailability = null;
        normalized.manualLatencyMs = null;
      }
    }

    if (channelType !== "automatic-proxy-pool") delete normalized.dynamicMemberRankingEnabled;
    else if (Object.prototype.hasOwnProperty.call(normalized, "dynamicMemberRankingEnabled")) {
      normalized.dynamicMemberRankingEnabled = normalized.dynamicMemberRankingEnabled !== false;
    }

    if (Object.prototype.hasOwnProperty.call(normalized, "healthScoreThreshold")) {
      normalized.healthScoreThreshold =
        normalized.healthScoreThreshold === null ? null : Number(normalized.healthScoreThreshold);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, "latencyThresholdMs")) {
      normalized.latencyThresholdMs =
        normalized.latencyThresholdMs === null ? null : Number(normalized.latencyThresholdMs);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, "circuitBreakerThreshold")) {
      normalized.circuitBreakerThreshold =
        normalized.circuitBreakerThreshold === null ? null : Number(normalized.circuitBreakerThreshold);
    }

    const rawAllowedModelsMode =
      typeof normalized.allowedModelsMode === "string" ? normalized.allowedModelsMode.trim() : undefined;
    if (rawAllowedModelsMode && !POOLED_ALLOWED_MODE_VALUES.has(rawAllowedModelsMode as "all" | "manual" | "auto"))
      throw new BadRequestError(`Invalid allowedModelsMode '${rawAllowedModelsMode}'`);

    if (channelType !== "automatic-proxy-pool") delete normalized.rankingMode;
    else normalized.rankingMode = normalized.rankingMode ?? DEFAULT_AUTOMATIC_POOL_RANKING_MODE;

    if (!isPoolType(channelType)) {
      delete normalized.allowedModelsMode;
      return normalized;
    }

    if (rawAllowedModelsMode) normalized.allowedModelsMode = rawAllowedModelsMode as RelayChannelAllowedModelsMode;
    return normalized;
  }

  private getHealthTrackingConfig(channel?: RelayChannel | null): {
    healthTrackingMode: RelayChannelHealthTrackingMode;
    manualAvailability?: number;
    manualLatencyMs?: number;
  } {
    const routingConfig = channel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined;
    const trackingMode: RelayChannelHealthTrackingMode =
      routingConfig?.healthTrackingMode === "manual" || routingConfig?.healthTrackingMode === "disabled"
        ? routingConfig.healthTrackingMode
        : "automatic";
    return {
      healthTrackingMode: trackingMode,
      manualAvailability:
        trackingMode === "manual" ? this.toOptionalFiniteNumber(routingConfig?.manualAvailability) : undefined,
      manualLatencyMs:
        trackingMode === "manual" ? this.toOptionalFiniteNumber(routingConfig?.manualLatencyMs) : undefined,
    };
  }

  private toOptionalFiniteNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  private toHealthDto(channel: RelayChannel, snapshot?: RelayChannelHealthSnapshot): RelayChannelHealthDto {
    const health = snapshot ?? {
      channelId: channel.id,
      windowStartAt: new Date(),
      windowEndAt: new Date(),
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      availability: 1,
      averageLatencyMs: 0,
      status2xxCount: 0,
      status3xxCount: 0,
      status4xxCount: 0,
      status5xxCount: 0,
      statusOtherCount: 0,
    };
    const tracking = this.getHealthTrackingConfig(channel);
    if (tracking.healthTrackingMode === "manual") {
      return {
        ...health,
        availability: tracking.manualAvailability ?? 0.5,
        averageLatencyMs: tracking.manualLatencyMs ?? 0,
        trackingMode: "manual",
        source: "manual",
        manualAvailability: tracking.manualAvailability,
        manualLatencyMs: tracking.manualLatencyMs,
      };
    }
    if (tracking.healthTrackingMode === "disabled") {
      return { ...health, trackingMode: "disabled", source: "disabled" };
    }
    return { ...health, trackingMode: "automatic", source: "redis" };
  }

  private assertNoSelfReference(channelId: string | undefined, members?: RelayChannelMemberDto[] | null): void {
    if (!channelId || !members) return;
    if (members.some((member) => member.memberChannelId === channelId)) {
      throw new BadRequestError("pooled channel cannot include itself as a member");
    }
  }

  private async assertPoolMembersExist(
    members: RelayChannelMemberDto[],
    tx?: Parameters<RelayChannelStore["replaceMembersByChannelId"]>[2],
  ): Promise<void> {
    const memberChannelIds = [...new Set(members.map((member) => member.memberChannelId))];
    const channels = await this.relayChannelRepository.listVisibleByIds(memberChannelIds, tx);

    if (channels.length !== memberChannelIds.length) {
      throw new BadRequestError("One or more pooled channel members were not found");
    }
  }

  private async assertPooledMemberParent(
    channelId: string | undefined,
    data: Pick<ValidatedRelayChannelData, "channelType" | "pooledParentId">,
    _tx?: Parameters<RelayChannelStore["replaceMembersByChannelId"]>[2],
  ): Promise<void> {
    if (data.channelType !== "pooled-member") return;
    if (!data.pooledParentId) throw new BadRequestError("pooled-member channels require a pooled parent");
    if (data.pooledParentId === channelId) throw new BadRequestError("pooled-member channel cannot be its own parent");
    const parent = await this.relayChannelRepository.findVisibleById(data.pooledParentId);
    if (!parent || parent.channelType !== "pooled")
      throw new BadRequestError("pooled-member parent must be a pooled channel");
  }

  private async assertNoPoolCycle(
    channelId: string,
    tx?: Parameters<RelayChannelStore["replaceMembersByChannelId"]>[2],
  ): Promise<void> {
    const channels = await this.relayChannelRepository.listVisible(tx);
    const membersByChannelId = new Map<string, string[]>();

    for (const channel of channels) {
      const members = (
        channel as RelayChannel & { poolMembers?: Array<{ enabled?: boolean; memberChannelId: string }> }
      ).poolMembers;
      membersByChannelId.set(channel.id, Array.isArray(members) ? members.map((member) => member.memberChannelId) : []);
    }

    const visit = (currentId: string, path: Set<string>): void => {
      if (path.has(currentId)) throw new BadRequestError("pooled channels cannot contain an indirect cycle");
      const nextPath = new Set(path).add(currentId);
      for (const memberId of membersByChannelId.get(currentId) ?? []) visit(memberId, nextPath);
    };

    visit(channelId, new Set());
  }

  private async syncPoolMembers(
    channelId: string,
    channelType: RelayChannelType,
    members: RelayChannelMemberDto[] | null | undefined,
    tx?: Parameters<RelayChannelStore["replaceMembersByChannelId"]>[2],
  ): Promise<void> {
    if (channelType === "pooled-member" || channelType === "standalone") {
      await this.relayChannelRepository.deleteMembersByChannelId(channelId, tx);
      await this.assertNoPoolCycle(channelId, tx);
      return;
    }

    if (channelType === "pooled") {
      // Legacy ordinary-pool edges are read while the topology is in legacy mode, but new
      // pooled channels receive their members through pooled-member.pooledParentId.
      const topology = await this.relayConfigService.getRelayConfig();
      if (topology.channelTopologyMode !== "strict-two-tier") {
        if (members === undefined) return;
        if (members === null || members.length === 0) {
          await this.relayChannelRepository.deleteMembersByChannelId(channelId, tx);
          return;
        }
        await this.assertPoolMembersExist(members, tx);
        await this.relayChannelRepository.replaceMembersByChannelId(
          channelId,
          members.map((member) => ({
            memberChannelId: member.memberChannelId,
            priority: member.priority,
            weight: member.weight,
            enabled: member.enabled,
          })),
          tx,
        );
        await this.assertNoPoolCycle(channelId, tx);
        return;
      }
      if (members?.length)
        throw new BadRequestError("pooled channels use pooled-member parent assignments instead of poolMembers");
      await this.relayChannelRepository.deleteMembersByChannelId(channelId, tx);
      return;
    }

    if (members === undefined) return;
    if (members === null || members.length === 0) {
      throw new BadRequestError("pooled channel must contain at least one member");
    }

    await this.assertPoolMembersExist(members, tx);
    if (channelType === "automatic-proxy-pool") {
      const channels = await this.relayChannelRepository.listVisibleByIds(
        members.map((member) => member.memberChannelId),
        tx,
      );
      const topology = await this.relayConfigService.getRelayConfig();
      if (
        topology.channelTopologyMode === "strict-two-tier" &&
        channels.some((channel) => channel.channelType !== "pooled")
      )
        throw new BadRequestError("automatic proxy pool members must be pooled channels");
    }

    await this.relayChannelRepository.replaceMembersByChannelId(
      channelId,
      members.map((member) => ({
        memberChannelId: member.memberChannelId,
        priority: member.priority,
        weight: member.weight,
        enabled: member.enabled,
      })),
      tx,
    );
    await this.assertNoPoolCycle(channelId, tx);
  }

  private toPoolMemberDto(member: {
    id: string;
    memberChannelId: string;
    priority: number;
    weight: Prisma.Decimal | number;
    enabled: boolean;
    memberChannel?: RelayChannel | null;
  }): RelayChannelMemberDto {
    return {
      id: member.id,
      memberChannelId: member.memberChannelId,
      priority: member.priority,
      weight: Number(member.weight),
      enabled: member.enabled,
      memberChannelName: member.memberChannel?.name,
      memberChannelType: member.memberChannel?.channelType as RelayChannelType | undefined,
      memberChannelEnabled: member.memberChannel?.status === RELAY_CHANNEL_STATUS.ENABLED,
    };
  }

  private async buildValidatedChannelData(
    data: CreateRelayChannelRequest | UpdateRelayChannelRequest,
    existing?: RelayChannel,
  ): Promise<ValidatedRelayChannelData> {
    const name = (data.name !== undefined ? data.name : existing?.name)?.trim();
    if (!name) throw new BadRequestError(existing ? "Channel name cannot be empty" : "Channel name is required");

    const channelType = (data.channelType ??
      (existing?.channelType as RelayChannelType | undefined) ??
      DEFAULT_CHANNEL_TYPE) as RelayChannelType;
    // A logical pooled channel owns the customer-facing price. Its physical members only provide
    // upstream execution and balance signals.
    const multiplier = data.multiplier !== undefined ? data.multiplier : Number(existing?.multiplier ?? 1);
    if (multiplier < 0) throw new BadRequestError("multiplier must be >= 0");
    const routingStrategy = (data.routingStrategy ??
      (existing?.routingStrategy as RelayChannelRoutingStrategy | undefined) ??
      DEFAULT_ROUTING_STRATEGY) as RelayChannelRoutingStrategy;
    const requestedVisibilityMode = (data.visibilityMode ??
      (existing?.visibilityMode as RelayChannelVisibilityMode | undefined) ??
      DEFAULT_VISIBILITY_MODE) as RelayChannelVisibilityMode;
    const visibilityMode = channelType === "pooled-member" ? "hidden" : requestedVisibilityMode;
    const routingConfig =
      data.routingConfig !== undefined
        ? data.routingConfig
        : (existing?.routingConfig as RelayChannelRoutingConfigDto | null | undefined);
    const configuredVisibilityConfig =
      data.visibilityConfig !== undefined
        ? data.visibilityConfig
        : (existing?.visibilityConfig as RelayChannelVisibilityConfigDto | null | undefined);
    const visibilityConfig = visibilityMode === "hidden" ? null : configuredVisibilityConfig;
    const poolMembers = this.normalizeRelayChannelMembers(
      data.poolMembers !== undefined ? data.poolMembers : undefined,
    );
    this.assertNoSelfReference(existing?.id, poolMembers);
    const pooledParentId =
      data.pooledParentId !== undefined ? data.pooledParentId?.trim() || null : (existing?.pooledParentId ?? null);
    const pooledPriority =
      data.pooledPriority !== undefined
        ? Math.max(0, Math.floor(data.pooledPriority))
        : (existing?.pooledPriority ?? 0);
    const pooledWeight =
      data.pooledWeight !== undefined ? Number(data.pooledWeight) : Number(existing?.pooledWeight ?? 1);
    const pooledMemberEnabled =
      data.pooledMemberEnabled !== undefined ? data.pooledMemberEnabled : existing?.pooledMemberEnabled !== false;
    if (!Number.isFinite(pooledWeight) || pooledWeight <= 0)
      throw new BadRequestError("pooledWeight must be greater than zero");
    if (channelType === "pooled-member" && !pooledParentId)
      throw new BadRequestError("pooled-member channels require a pooled parent");
    if (channelType !== "pooled-member" && pooledParentId)
      throw new BadRequestError("only pooled-member channels may have a pooled parent");
    const isCreate = !existing;
    const wasPooled = isPoolType((existing?.channelType as RelayChannelType | undefined) ?? "standalone");
    const normalizedRoutingConfig = this.normalizeRoutingConfig(routingConfig, channelType);
    if (
      channelType !== "automatic-proxy-pool" &&
      (data.routingConfig?.rankingMode ||
        Object.prototype.hasOwnProperty.call(data.routingConfig ?? {}, "dynamicMemberRankingEnabled"))
    )
      throw new BadRequestError("automatic pool ranking settings can only be configured for automatic proxy pools");

    const openaiUpstreamUrl =
      data.openaiUpstreamUrl !== undefined ? data.openaiUpstreamUrl : existing?.openaiUpstreamUrl || undefined;
    const openaiUpstreamApiKey =
      data.openaiUpstreamApiKey !== undefined ? data.openaiUpstreamApiKey : existing?.openaiUpstreamApiKey || undefined;
    const anthropicUpstreamUrl =
      data.anthropicUpstreamUrl !== undefined ? data.anthropicUpstreamUrl : existing?.anthropicUpstreamUrl || undefined;
    const anthropicUpstreamApiKey =
      data.anthropicUpstreamApiKey !== undefined
        ? data.anthropicUpstreamApiKey
        : existing?.anthropicUpstreamApiKey || undefined;
    const geminiUpstreamUrl =
      data.geminiUpstreamUrl !== undefined ? data.geminiUpstreamUrl : existing?.geminiUpstreamUrl || undefined;
    const geminiUpstreamApiKey =
      data.geminiUpstreamApiKey !== undefined ? data.geminiUpstreamApiKey : existing?.geminiUpstreamApiKey || undefined;
    const allowedFormatsInput = isPoolType(channelType)
      ? "all"
      : data.allowedFormats !== undefined
        ? data.allowedFormats
        : existing?.allowedFormats || "all";
    const { normalized: allowedFormats, formats } = this.normalizeAllowedFormats(allowedFormatsInput);
    const allowedModels = data.allowedModels !== undefined ? data.allowedModels : existing?.allowedModels;
    const addUserIdentifier =
      data.addUserIdentifier !== undefined ? data.addUserIdentifier : existing?.addUserIdentifier !== false;
    const inputTokensIncludeCacheRead =
      data.inputTokensIncludeCacheRead !== undefined
        ? data.inputTokensIncludeCacheRead
        : existing?.inputTokensIncludeCacheRead === true;

    const modelMapping =
      data.modelMapping !== undefined
        ? data.modelMapping
        : (existing?.modelMapping as Record<string, string> | null | undefined);

    const timePeriodMultipliers =
      data.timePeriodMultipliers !== undefined
        ? data.timePeriodMultipliers
        : (existing?.timePeriodMultipliers as TimePeriodMultiplierRule[] | undefined);
    const contextLengthMultipliers =
      data.contextLengthMultipliers !== undefined
        ? data.contextLengthMultipliers
        : (existing?.contextLengthMultipliers as ContextLengthMultiplierRule[] | undefined);
    const topology = await this.relayConfigService.getRelayConfig();

    if (allowedModels !== undefined && allowedModels !== null)
      try {
        const parsed = JSON.parse(allowedModels);
        if (!Array.isArray(parsed)) throw new Error("allowedModels must be a JSON array");
        await this.validateNoDuplicateModelIds(parsed);
      } catch (error) {
        if (error instanceof Error && error.message.includes("duplicate model ID")) throw error;
        throw new BadRequestError("allowedModels must be a valid JSON array");
      }

    if (isUpstreamChannelType(channelType)) {
      if (!openaiUpstreamUrl && !anthropicUpstreamUrl && !geminiUpstreamUrl)
        throw new BadRequestError("At least one upstream URL (OpenAI, Anthropic, or Gemini) must be configured");

      if (formats.includes("openai")) {
        if (!openaiUpstreamUrl)
          throw new BadRequestError("OpenAI upstream URL is required when allowedFormats includes 'openai'");
        if (!openaiUpstreamApiKey)
          throw new BadRequestError("OpenAI API key is required when allowedFormats includes 'openai'");
      }
      if (formats.includes("anthropic")) {
        if (!anthropicUpstreamUrl)
          throw new BadRequestError("Anthropic upstream URL is required when allowedFormats includes 'anthropic'");
        if (!anthropicUpstreamApiKey)
          throw new BadRequestError("Anthropic API key is required when allowedFormats includes 'anthropic'");
      }
      if (formats.includes("gemini")) {
        if (!geminiUpstreamUrl)
          throw new BadRequestError("Gemini upstream URL is required when allowedFormats includes 'gemini'");
        if (!geminiUpstreamApiKey)
          throw new BadRequestError("Gemini API key is required when allowedFormats includes 'gemini'");
      }

      if (allowedFormats === "all") {
        if (openaiUpstreamUrl && !openaiUpstreamApiKey)
          throw new BadRequestError("OpenAI API key is required when OpenAI upstream URL is configured");
        if (anthropicUpstreamUrl && !anthropicUpstreamApiKey)
          throw new BadRequestError("Anthropic API key is required when Anthropic upstream URL is configured");
        if (geminiUpstreamUrl && !geminiUpstreamApiKey)
          throw new BadRequestError("Gemini API key is required when Gemini upstream URL is configured");
      }
    }

    if (channelType === "automatic-proxy-pool") {
      const memberCount = poolMembers == null ? undefined : poolMembers.length;
      if (isCreate || !wasPooled) {
        if (!memberCount) throw new BadRequestError("pooled channel must contain at least one member");
      } else if (poolMembers !== undefined && memberCount === 0)
        throw new BadRequestError("pooled channel must contain at least one member");
    }

    if (
      channelType === "pooled" &&
      topology.channelTopologyMode === "strict-two-tier" &&
      poolMembers != null &&
      poolMembers.length > 0
    )
      throw new BadRequestError("pooled channels use pooled-member parent assignments instead of poolMembers");
    if (
      existing &&
      channelType === "pooled" &&
      topology.channelTopologyMode !== "strict-two-tier" &&
      poolMembers != null &&
      poolMembers.length === 0
    )
      throw new BadRequestError("pooled channel must contain at least one member channel");

    return {
      name,
      channelType,
      routingStrategy,
      routingConfig: normalizedRoutingConfig,
      visibilityMode,
      visibilityConfig,
      poolMembers,
      pooledParentId,
      pooledPriority,
      pooledWeight,
      pooledMemberEnabled,
      openaiUpstreamUrl,
      openaiUpstreamApiKey,
      anthropicUpstreamUrl,
      anthropicUpstreamApiKey,
      geminiUpstreamUrl,
      geminiUpstreamApiKey,
      multiplier,
      allowedFormats,
      allowedModels,
      addUserIdentifier,
      inputTokensIncludeCacheRead,
      modelMapping,
      timePeriodMultipliers,
      contextLengthMultipliers: contextLengthMultipliers
        ? [...contextLengthMultipliers].sort((left, right) => left.minTokens - right.minTokens)
        : undefined,
    };
  }

  private toPersistenceInput(data: ValidatedRelayChannelData): Prisma.RelayChannelUncheckedCreateInput {
    return {
      name: data.name,
      channelType: data.channelType,
      routingStrategy: data.routingStrategy,
      routingConfig: data.routingConfig as Prisma.InputJsonValue | undefined,
      visibilityMode: data.visibilityMode,
      visibilityConfig:
        data.visibilityConfig === null ? Prisma.JsonNull : (data.visibilityConfig as Prisma.InputJsonValue | undefined),
      pooledParentId: data.pooledParentId ?? null,
      pooledPriority: data.pooledPriority,
      pooledWeight: data.pooledWeight,
      pooledMemberEnabled: data.pooledMemberEnabled,
      openaiUpstreamUrl: data.openaiUpstreamUrl,
      openaiUpstreamApiKey: data.openaiUpstreamApiKey,
      anthropicUpstreamUrl: data.anthropicUpstreamUrl,
      anthropicUpstreamApiKey: data.anthropicUpstreamApiKey,
      geminiUpstreamUrl: data.geminiUpstreamUrl,
      geminiUpstreamApiKey: data.geminiUpstreamApiKey,
      multiplier: data.multiplier,
      allowedFormats: data.allowedFormats,
      allowedModels: data.allowedModels,
      addUserIdentifier: data.addUserIdentifier,
      inputTokensIncludeCacheRead: data.inputTokensIncludeCacheRead,
      modelMapping: data.modelMapping as Prisma.InputJsonValue | undefined,
      timePeriodMultipliers: data.timePeriodMultipliers as Prisma.InputJsonValue | undefined,
      contextLengthMultipliers: data.contextLengthMultipliers as Prisma.InputJsonValue | undefined,
    };
  }

  private toCreateRequest(channel: RelayChannel): RelayChannelImportItemDto {
    return {
      name: channel.name,
      channelType: (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE,
      routingStrategy: (channel.routingStrategy as RelayChannelRoutingStrategy | undefined) ?? DEFAULT_ROUTING_STRATEGY,
      routingConfig: channel.routingConfig as RelayChannelRoutingConfigDto | undefined,
      visibilityMode: (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE,
      visibilityConfig: channel.visibilityConfig as RelayChannelVisibilityConfigDto | undefined,
      pooledParentId: channel.pooledParentId || undefined,
      pooledPriority: channel.pooledPriority,
      pooledWeight: Number(channel.pooledWeight),
      pooledMemberEnabled: channel.pooledMemberEnabled,
      poolMembers: Array.isArray((channel as RelayChannel & { poolMembers?: unknown[] }).poolMembers)
        ? (
            (
              channel as RelayChannel & {
                poolMembers?: Array<{
                  id: string;
                  memberChannelId: string;
                  priority: number;
                  weight: Prisma.Decimal | number;
                  enabled: boolean;
                  memberChannel?: RelayChannel | null;
                }>;
              }
            ).poolMembers ?? []
          ).map((member) => this.toPoolMemberDto(member))
        : undefined,
      openaiUpstreamUrl: channel.openaiUpstreamUrl || undefined,
      openaiUpstreamApiKey: channel.openaiUpstreamApiKey || undefined,
      anthropicUpstreamUrl: channel.anthropicUpstreamUrl || undefined,
      anthropicUpstreamApiKey: channel.anthropicUpstreamApiKey || undefined,
      geminiUpstreamUrl: channel.geminiUpstreamUrl || undefined,
      geminiUpstreamApiKey: channel.geminiUpstreamApiKey || undefined,
      multiplier: Number(channel.multiplier),
      allowedFormats: channel.allowedFormats || "all",
      allowedModels: channel.allowedModels,
      addUserIdentifier: channel.addUserIdentifier !== false,
      inputTokensIncludeCacheRead: channel.inputTokensIncludeCacheRead === true,
      modelMapping: channel.modelMapping as Record<string, string> | undefined,
      timePeriodMultipliers: channel.timePeriodMultipliers as unknown as TimePeriodMultiplierRule[] | undefined,
      contextLengthMultipliers: channel.contextLengthMultipliers as unknown as
        | ContextLengthMultiplierRule[]
        | undefined,
      enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
    };
  }

  private toExportItemDto(channel: RelayChannel): RelayChannelExportItemDto {
    return {
      ...this.toCreateRequest(channel),
      id: channel.id,
      enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
      createTime: channel.createTime,
      updateTime: channel.updateTime,
    };
  }

  async createChannel(
    data: CreateRelayChannelRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayChannelDto> {
    const validated = await this.buildValidatedChannelData(data);
    await this.assertVisibleNameAvailable(validated.name);

    const channel = await this.relayChannelRepository.withTransaction(async (tx) => {
      const created = await this.relayChannelRepository.create(
        {
          ...this.toPersistenceInput(validated),
          status: RELAY_CHANNEL_STATUS.ENABLED,
        },
        tx,
      );

      await this.assertPooledMemberParent(created.id, validated, tx);
      await this.syncPoolMembers(created.id, validated.channelType, validated.poolMembers, tx);

      return created;
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_CREATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: channel.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `创建了中转渠道 '${channel.name}'`,
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(channel);
  }

  async updateChannel(
    id: string,
    data: UpdateRelayChannelRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayChannelDto> {
    const existing = await this.relayChannelRepository.findVisibleById(id);
    if (!existing) throw new NotFoundError("Relay channel not found");
    const validated = await this.buildValidatedChannelData(data, existing);
    await this.assertVisibleNameAvailable(validated.name, existing.id);

    if (
      validated.visibilityMode === "hidden" &&
      (existing.visibilityMode as RelayChannelVisibilityMode | undefined) !== "hidden"
    ) {
      const referenceCount = await this.relayChannelRepository.countDirectBusinessReferences(id);
      if (referenceCount > 0)
        throw new BadRequestError(
          "Cannot hide a relay channel while it is directly assigned to relay tokens, OJ API keys, or monthly passes",
        );
    }

    const channel = await this.relayChannelRepository.withTransaction(async (tx) => {
      await this.assertPooledMemberParent(id, validated, tx);
      const updated = await this.relayChannelRepository.updateById(id, this.toPersistenceInput(validated), tx);

      await this.syncPoolMembers(updated.id, validated.channelType, validated.poolMembers, tx);

      return updated;
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: channel.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `更新了中转渠道 '${channel.name}'`,
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(channel);
  }

  async batchUpdateChannels(
    body: BatchUpdateRelayChannelsRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<BatchUpdateRelayChannelsResponse> {
    const channels = await this.getOrderedChannelsByIds(body.ids, true);
    const migration = body.modelPricingMigration;
    const relayConfig = migration ? await this.relayConfigService.getRelayConfig() : undefined;
    const sourceModelId = migration?.sourceModelId.trim();
    const targetPricingModel = migration?.targetPricingModel.trim();
    const targetModel = migration
      ? relayConfig?.modelRates.find((model) => model.model.trim() === targetPricingModel)
      : undefined;

    const rejected: BatchUpdateRelayChannelsResponse["rejected"] = [];
    const updated: RelayChannelDto[] = [];

    if (migration && !targetModel) {
      await this.logBatchChannelUpdate(body, actorUserId, request, 0, channels.length);
      return {
        updated,
        rejected: channels.map((channel) => ({
          id: channel.id,
          reason: `Pricing model '${targetPricingModel}' was not found`,
        })),
      };
    }

    const targetModelId = targetModel?.modelId?.trim() || targetModel?.model.trim();
    if (migration && targetModelId !== sourceModelId) {
      await this.logBatchChannelUpdate(body, actorUserId, request, 0, channels.length);
      return {
        updated,
        rejected: channels.map((channel) => ({
          id: channel.id,
          reason: `Pricing model '${targetPricingModel}' has upstream modelId '${targetModelId}', expected '${sourceModelId}'`,
        })),
      };
    }

    const sourceModelNames = new Set(
      (relayConfig?.modelRates ?? [])
        .filter((model) => (model.modelId?.trim() || model.model.trim()) === sourceModelId)
        .map((model) => model.model.trim()),
    );

    for (const channel of channels) {
      try {
        if (migration && !this.channelAllowsModelId(channel, sourceModelId!, sourceModelNames)) {
          throw new BadRequestError(`Channel does not allow request model '${sourceModelId}'`);
        }

        const patch: UpdateRelayChannelRequest = { ...body.patch };
        if (migration) {
          patch.modelMapping = {
            ...((channel.modelMapping as Record<string, string> | null) ?? {}),
            [sourceModelId!]: targetPricingModel!,
          };
        }
        const validated = await this.buildValidatedChannelData(patch, channel);
        await this.assertVisibleNameAvailable(validated.name, channel.id);
        if (
          validated.visibilityMode === "hidden" &&
          (channel.visibilityMode as RelayChannelVisibilityMode | undefined) !== "hidden"
        ) {
          const referenceCount = await this.relayChannelRepository.countDirectBusinessReferences(channel.id);
          if (referenceCount > 0) {
            throw new BadRequestError(
              "Cannot hide a relay channel while it is directly assigned to relay tokens, OJ API keys, or monthly passes",
            );
          }
        }

        const saved = await this.relayChannelRepository.withTransaction((tx) =>
          this.relayChannelRepository.updateById(channel.id, this.toPersistenceInput(validated), tx),
        );
        updated.push(await this.toDto(saved));
      } catch (error) {
        rejected.push({
          id: channel.id,
          reason: error instanceof Error ? error.message : "Channel update failed",
        });
      }
    }

    await this.logBatchChannelUpdate(body, actorUserId, request, updated.length, rejected.length);

    return { updated, rejected };
  }

  private async logBatchChannelUpdate(
    body: BatchUpdateRelayChannelsRequest,
    actorUserId: string,
    request: Request | undefined,
    updatedCount: number,
    rejectedCount: number,
  ): Promise<void> {
    const migration = body.modelPricingMigration;
    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_BATCH_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `批量更新了 ${updatedCount} 个中转渠道${rejectedCount ? `，${rejectedCount} 个未更新` : ""}`,
      metadata: {
        ids: body.ids,
        fields: Object.keys(body.patch),
        modelPricingMigration: migration
          ? { sourceModelId: migration.sourceModelId, targetPricingModel: migration.targetPricingModel }
          : undefined,
        updated: updatedCount,
        rejected: rejectedCount,
      },
      success: rejectedCount === 0,
      ...buildBusinessLogRequestContext(request),
    });
  }

  private channelAllowsModelId(channel: RelayChannel, sourceModelId: string, sourceModelNames: Set<string>): boolean {
    if (!channel.allowedModels) return true;
    try {
      const allowedModels = JSON.parse(channel.allowedModels);
      if (!Array.isArray(allowedModels)) return false;
      return allowedModels.some((model) => {
        const normalized = typeof model === "string" ? model.trim() : "";
        return normalized === sourceModelId || sourceModelNames.has(normalized);
      });
    } catch {
      return false;
    }
  }

  async duplicateChannel(
    id: string,
    data: DuplicateRelayChannelRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayChannelDto> {
    const existing = await this.relayChannelRepository.findVisibleById(id);
    if (!existing) throw new NotFoundError("Relay channel not found");

    const reservedNames = await this.getVisibleNameSet();
    const duplicatedName = data.name?.trim() || this.buildCopyName(existing.name, reservedNames);
    const validated = await this.buildValidatedChannelData({ ...this.toCreateRequest(existing), name: duplicatedName });
    await this.assertVisibleNameAvailable(validated.name);

    const channel = await this.relayChannelRepository.withTransaction(async (tx) => {
      const created = await this.relayChannelRepository.create(
        {
          ...this.toPersistenceInput(validated),
          status: RELAY_CHANNEL_STATUS.ENABLED,
        },
        tx,
      );

      await this.syncPoolMembers(created.id, validated.channelType, validated.poolMembers, tx);

      return created;
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_DUPLICATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: channel.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `复制了中转渠道 '${existing.name}'`,
      metadata: {
        sourceChannelId: existing.id,
        sourceChannelName: existing.name,
      },
      changes: maskSensitiveData({ name: validated.name }),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(channel);
  }

  async batchDuplicateChannels(ids: string[], actorUserId: string, request?: Request): Promise<RelayChannelDto[]> {
    const sourceChannels = await this.getOrderedChannelsByIds(ids, true);
    const duplicatedChannels = await this.relayChannelRepository.withTransaction(async (tx) => {
      const reservedNames = await this.getVisibleNameSet();
      const items: RelayChannel[] = [];

      for (const sourceChannel of sourceChannels) {
        const duplicatedName = this.buildCopyName(sourceChannel.name, reservedNames);
        const validated = await this.buildValidatedChannelData({
          ...this.toCreateRequest(sourceChannel),
          name: duplicatedName,
        });
        const created = await this.relayChannelRepository.create(
          {
            ...this.toPersistenceInput(validated),
            status: RELAY_CHANNEL_STATUS.ENABLED,
          },
          tx,
        );

        await this.syncPoolMembers(created.id, validated.channelType, validated.poolMembers, tx);
        items.push(created);
      }

      return items;
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_BATCH_DUPLICATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `批量复制了 ${duplicatedChannels.length} 个中转渠道`,
      metadata: {
        ids,
        total: duplicatedChannels.length,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return Promise.all(duplicatedChannels.map((channel) => this.toDto(channel)));
  }

  async batchSetChannelStatus(
    body: BatchSetRelayChannelStatusRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<BatchRelayChannelsResultDto> {
    await this.getOrderedChannelsByIds(body.ids, true);
    const status = body.enabled ? RELAY_CHANNEL_STATUS.ENABLED : RELAY_CHANNEL_STATUS.DISABLED;
    const affected = await this.relayChannelRepository.updateStatusByIds(body.ids, status);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_BATCH_STATUS_CHANGE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `批量${body.enabled ? "启用" : "禁用"}了 ${affected} 个中转渠道`,
      metadata: {
        ids: body.ids,
        enabled: body.enabled,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      total: body.ids.length,
      affected,
    };
  }

  async batchDeleteChannels(
    body: BatchDeleteRelayChannelsRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<BatchRelayChannelsResultDto> {
    await this.getOrderedChannelsByIds(body.ids, true);
    const affected = await this.relayChannelRepository.softDeleteAndUnassignTokensByIds(body.ids);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_BATCH_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `批量删除了 ${affected} 个中转渠道`,
      metadata: {
        ids: body.ids,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      total: body.ids.length,
      affected,
    };
  }

  async importChannels(
    body: ImportRelayChannelsRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<ImportRelayChannelsResponse> {
    const createdChannels = await this.relayChannelRepository.withTransaction(async (tx) => {
      const sourceIds = body.channels.map((item) => item.id).filter((id): id is string => Boolean(id));
      const hasSourceIds = sourceIds.length > 0;
      if (hasSourceIds && sourceIds.length !== body.channels.length) {
        throw new BadRequestError("Imported relay channels must either all include source IDs or all omit them");
      }
      if (new Set(sourceIds).size !== sourceIds.length) {
        throw new BadRequestError("Imported relay channel source IDs must be unique");
      }

      const reservedNames = await this.getVisibleNameSet(tx);
      const importedChannels: Array<{
        created: RelayChannel;
        channelType: RelayChannelType;
        poolMembers?: RelayChannelMemberDto[] | null;
      }> = [];
      const importedChannelIds = new Map<string, string>();

      // Parents must exist before their physical children so exported source IDs
      // can be remapped without guessing or temporarily violating the FK.
      const orderedItems = [...body.channels].sort(
        (left, right) => Number(left.channelType === "pooled-member") - Number(right.channelType === "pooled-member"),
      );
      for (const item of orderedItems) {
        const preferredName = item.name.trim();
        const finalName = reservedNames.has(preferredName)
          ? this.buildCopyName(preferredName, reservedNames)
          : preferredName;
        reservedNames.add(finalName);

        const pooledParentId = item.pooledParentId
          ? (importedChannelIds.get(item.pooledParentId) ?? item.pooledParentId)
          : item.pooledParentId;
        const validated = await this.buildValidatedChannelData({ ...item, name: finalName, pooledParentId });
        const created = await this.relayChannelRepository.create(
          {
            ...this.toPersistenceInput(validated),
            status: item.enabled === false ? RELAY_CHANNEL_STATUS.DISABLED : RELAY_CHANNEL_STATUS.ENABLED,
          },
          tx,
        );
        if (item.id) importedChannelIds.set(item.id, created.id);
        importedChannels.push({
          created,
          channelType: validated.channelType,
          poolMembers: validated.poolMembers,
        });
      }

      // Older exports may contain a pool without its member records. When the destination
      // already has a channel with the exported member name, resolve that reference instead
      // of failing solely because the source ID belongs to another installation.
      const existingChannelsByName = new Map(
        (await this.relayChannelRepository.listVisible(tx)).map((channel) => [channel.name, channel.id]),
      );

      for (const importedChannel of importedChannels) {
        const poolMembers = importedChannel.poolMembers?.map((member) => ({
          ...member,
          memberChannelId:
            importedChannelIds.get(member.memberChannelId) ??
            (member.memberChannelName ? existingChannelsByName.get(member.memberChannelName) : undefined) ??
            member.memberChannelId,
        }));
        await this.syncPoolMembers(importedChannel.created.id, importedChannel.channelType, poolMembers, tx);
      }

      return importedChannels.map(({ created }) => created);
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_IMPORT,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceType: "RELAY_CHANNEL",
      description: `导入了 ${createdChannels.length} 个中转渠道`,
      metadata: {
        total: body.channels.length,
        created: createdChannels.length,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    const createdChannelDtos = await Promise.all(createdChannels.map((channel) => this.toDto(channel)));

    return {
      code: 0,
      message: "success",
      created: createdChannelDtos.length,
      total: body.channels.length,
      data: createdChannelDtos,
    };
  }

  async toggleChannelStatus(id: string, actorUserId: string, request?: Request): Promise<RelayChannelDto> {
    const existing = await this.relayChannelRepository.findVisibleById(id);
    if (!existing) throw new NotFoundError("Relay channel not found");
    const currentStatus = existing.status as RelayChannelStatus;
    if (!VISIBLE_RELAY_CHANNEL_STATUSES.includes(currentStatus)) throw new NotFoundError("Relay channel not found");

    const nextStatus =
      currentStatus === RELAY_CHANNEL_STATUS.ENABLED ? RELAY_CHANNEL_STATUS.DISABLED : RELAY_CHANNEL_STATUS.ENABLED;
    const channel = await this.relayChannelRepository.updateById(id, {
      status: nextStatus,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_STATUS_CHANGE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: channel.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `将中转渠道 '${existing.name}' ${nextStatus === RELAY_CHANNEL_STATUS.ENABLED ? "启用" : "禁用"}`,
      changes: {
        fromStatus: currentStatus,
        toStatus: nextStatus,
        enabled: nextStatus === RELAY_CHANNEL_STATUS.ENABLED,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(channel);
  }

  async deleteChannel(id: string, actorUserId: string, request?: Request): Promise<void> {
    const existing = await this.relayChannelRepository.findVisibleById(id);
    if (!existing) throw new NotFoundError("Relay channel not found");

    await this.relayChannelRepository.softDeleteAndUnassignTokens(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_CHANNEL_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId,
      targetResourceId: existing.id,
      targetResourceType: "RELAY_CHANNEL",
      description: `删除了中转渠道 '${existing.name}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  private async toDto(
    channel: RelayChannel,
    modelCatalog?: ModelPricingDto[],
    includeDisabled = false,
  ): Promise<RelayChannelDto> {
    const legacyPoolMembers = Array.isArray((channel as RelayChannel & { poolMembers?: unknown[] }).poolMembers)
      ? (
          (
            channel as RelayChannel & {
              poolMembers?: Array<{
                id: string;
                memberChannelId: string;
                priority: number;
                weight: Prisma.Decimal | number;
                enabled: boolean;
                memberChannel?: RelayChannel | null;
              }>;
            }
          ).poolMembers ?? []
        ).map((member) => this.toPoolMemberDto(member))
      : undefined;
    const physicalPooledMembers =
      channel.channelType === "pooled"
        ? ((channel as RelayChannel & { pooledChildren?: RelayChannel[] }).pooledChildren ?? []).map(
            (member): RelayChannelMemberDto => ({
              memberChannelId: member.id,
              priority: member.pooledPriority,
              weight: Number(member.pooledWeight),
              enabled: member.pooledMemberEnabled,
              memberChannelName: member.name,
              memberChannelType: "pooled-member",
              memberChannelEnabled: member.status === RELAY_CHANNEL_STATUS.ENABLED,
            }),
          )
        : undefined;
    // Prefer strict one-to-many members when present; legacy edges remain visible
    // until an administrator explicitly completes topology migration.
    const poolMembers = physicalPooledMembers?.length ? physicalPooledMembers : legacyPoolMembers;

    const dto: RelayChannelDto = {
      id: channel.id,
      name: channel.name,
      enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
      openaiUpstreamUrl: channel.openaiUpstreamUrl || undefined,
      hasOpenaiUpstreamApiKey: Boolean(channel.openaiUpstreamApiKey),
      anthropicUpstreamUrl: channel.anthropicUpstreamUrl || undefined,
      hasAnthropicUpstreamApiKey: Boolean(channel.anthropicUpstreamApiKey),
      geminiUpstreamUrl: channel.geminiUpstreamUrl || undefined,
      hasGeminiUpstreamApiKey: Boolean(channel.geminiUpstreamApiKey),
      multiplier: Number(channel.multiplier),
      allowedFormats: channel.allowedFormats || "all",
      allowedModels: [],
      configuredAllowedModels: channel.allowedModels || undefined,
      addUserIdentifier: channel.addUserIdentifier !== false, // Default to true
      inputTokensIncludeCacheRead: channel.inputTokensIncludeCacheRead === true, // Default to false
      modelMapping: channel.modelMapping as Record<string, string> | undefined,
      timePeriodMultipliers: channel.timePeriodMultipliers as unknown as TimePeriodMultiplierRule[] | undefined,
      contextLengthMultipliers: channel.contextLengthMultipliers as unknown as
        | ContextLengthMultiplierRule[]
        | undefined,
      channelType: (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE,
      routingStrategy: (channel.routingStrategy as RelayChannelRoutingStrategy | undefined) ?? DEFAULT_ROUTING_STRATEGY,
      routingConfig: channel.routingConfig as RelayChannelRoutingConfigDto | undefined,
      visibilityMode: (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE,
      visibilityConfig: channel.visibilityConfig as RelayChannelVisibilityConfigDto | undefined,
      poolMembers,
      pooledParentId: channel.pooledParentId || undefined,
      pooledParentName: (channel as RelayChannel & { pooledParent?: RelayChannel | null }).pooledParent?.name,
      pooledPriority: channel.pooledPriority,
      pooledWeight: Number(channel.pooledWeight),
      pooledMemberEnabled: channel.pooledMemberEnabled,
      createTime: channel.createTime,
      updateTime: channel.updateTime,
    };

    const resolvedModelCatalog = modelCatalog ?? (await this.modelPricingService.getModelPricing());
    if (isPoolType(dto.channelType)) {
      const context = await this.relayPoolResolver.preloadContext(resolvedModelCatalog, { includeDisabled });
      const formats = new Set(
        (await this.relayPoolResolver.resolveChannelCapabilities(channel.id, context)).flatMap(
          (capability) => capability.supportedRequestFormats,
        ),
      );
      dto.allowedFormats = formatRelayRequestFormats([...formats]);
    }
    dto.allowedModels = includeDisabled
      ? await this.relayPoolResolver.resolveEffectiveAllowedModels(channel.id, resolvedModelCatalog, {
          includeDisabled: true,
        })
      : await this.relayPoolResolver.resolveEffectiveAllowedModels(channel.id, resolvedModelCatalog);

    return dto;
  }
}
