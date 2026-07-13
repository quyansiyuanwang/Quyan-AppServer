import type {
  BatchDeleteRelayChannelsRequest,
  BatchRelayChannelsResultDto,
  BatchSetRelayChannelStatusRequest,
  CreateRelayChannelRequest,
  DuplicateRelayChannelRequest,
  ExportRelayChannelsRequest,
  ImportRelayChannelsRequest,
  ImportRelayChannelsResponse,
  RelayChannelDto,
  RelayChannelExportItemDto,
  RelayChannelExportResponse,
  RelayChannelImportItemDto,
  TimePeriodMultiplierRule,
  UpdateRelayChannelRequest,
  RelayChannelMemberDto,
  RelayChannelRoutingConfigDto,
  RelayChannelRoutingStrategy,
  RelayChannelType,
  RelayChannelVisibilityConfigDto,
  RelayChannelVisibilityMode,
} from "@/api/dto/relay/relay-channel.dto";
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
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import type { Prisma, RelayChannel } from "@prisma/client";
import type { Request } from "express";

const COPY_SUFFIX = "（副本）";
const MAX_CHANNEL_NAME_LENGTH = 100;

interface ValidatedRelayChannelData {
  name: string;
  channelType: RelayChannelType;
  routingStrategy: RelayChannelRoutingStrategy;
  routingConfig?: RelayChannelRoutingConfigDto | null;
  visibilityMode: RelayChannelVisibilityMode;
  visibilityConfig?: RelayChannelVisibilityConfigDto | null;
  poolMembers?: RelayChannelMemberDto[] | null;
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
}

const DEFAULT_CHANNEL_TYPE: RelayChannelType = "standalone";
const DEFAULT_ROUTING_STRATEGY: RelayChannelRoutingStrategy = "priority";
const DEFAULT_VISIBILITY_MODE: RelayChannelVisibilityMode = "public";

export class RelayChannelService {
  private static instance: RelayChannelService;

  private constructor(
    private readonly relayChannelRepository: RelayChannelStore = RelayChannelRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly ramRoleRepository: RamRoleStore = RamRoleRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
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
    return visibleChannels.map((channel) => this.toDto(channel));
  }

  async getChannel(id: string, actorUserId: string): Promise<RelayChannelDto> {
    const channel = await this.relayChannelRepository.findVisibleById(id);
    if (!channel) throw new NotFoundError("Relay channel not found");
    await this.assertChannelAccessible(channel, actorUserId);
    return this.toDto(channel);
  }

  async assertChannelAccessibleById(id: string, actorUserId: string): Promise<RelayChannel> {
    const channel = await this.relayChannelRepository.findVisibleById(id);
    if (!channel) throw new NotFoundError("Relay channel not found");

    await this.assertChannelAccessible(channel, actorUserId);
    return channel;
  }

  async exportChannels(
    body: ExportRelayChannelsRequest,
    actorUserId: string,
    request?: Request,
  ): Promise<RelayChannelExportResponse> {
    const channels = body.ids?.length
      ? await this.getOrderedChannelsByIds(body.ids, body.includeDisabled === true)
      : body.includeDisabled === true
        ? await this.relayChannelRepository.listVisible()
        : await this.relayChannelRepository.listActive();

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

  private async getVisibleNameSet(): Promise<Set<string>> {
    const channels = await this.relayChannelRepository.listVisible();
    return new Set(channels.map((channel) => channel.name));
  }

  private async canBypassVisibility(actorUserId: string): Promise<boolean> {
    return this.permissionService.hasAnyPermission(actorUserId, [
      Permission.RELAY_CHANNEL_CREATE,
      Permission.RELAY_CHANNEL_UPDATE,
      Permission.RELAY_CHANNEL_DELETE,
    ]);
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

  private async canUserAccessChannel(channel: RelayChannel, actorUserId: string): Promise<boolean> {
    if (await this.canBypassVisibility(actorUserId)) return true;

    const visibilityMode =
      (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE;
    if (visibilityMode === "public") return true;
    if (visibilityMode === "private") return false;

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

  private assertNoSelfReference(channelId: string | undefined, members?: RelayChannelMemberDto[] | null): void {
    if (!channelId || !members) return;
    if (members.some((member) => member.memberChannelId === channelId)) {
      throw new BadRequestError("pooled channel cannot include itself as a member");
    }
  }

  private async syncPoolMembers(
    channelId: string,
    channelType: RelayChannelType,
    members: RelayChannelMemberDto[] | null | undefined,
    tx?: Parameters<RelayChannelStore["replaceMembersByChannelId"]>[2],
  ): Promise<void> {
    if (channelType !== "pooled") {
      await this.relayChannelRepository.deleteMembersByChannelId(channelId, tx);
      return;
    }

    if (members === undefined) return;
    if (members === null || members.length === 0) {
      throw new BadRequestError("pooled channel must contain at least one member");
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
    };
  }

  private async buildValidatedChannelData(
    data: CreateRelayChannelRequest | UpdateRelayChannelRequest,
    existing?: RelayChannel,
  ): Promise<ValidatedRelayChannelData> {
    const name = (data.name !== undefined ? data.name : existing?.name)?.trim();
    if (!name) throw new BadRequestError(existing ? "Channel name cannot be empty" : "Channel name is required");

    const multiplier = data.multiplier !== undefined ? data.multiplier : Number(existing?.multiplier ?? 1);
    if (multiplier < 0) throw new BadRequestError("multiplier must be >= 0");

    const channelType = (data.channelType ??
      (existing?.channelType as RelayChannelType | undefined) ??
      DEFAULT_CHANNEL_TYPE) as RelayChannelType;
    const routingStrategy = (data.routingStrategy ??
      (existing?.routingStrategy as RelayChannelRoutingStrategy | undefined) ??
      DEFAULT_ROUTING_STRATEGY) as RelayChannelRoutingStrategy;
    const visibilityMode = (data.visibilityMode ??
      (existing?.visibilityMode as RelayChannelVisibilityMode | undefined) ??
      DEFAULT_VISIBILITY_MODE) as RelayChannelVisibilityMode;
    const routingConfig =
      data.routingConfig !== undefined
        ? data.routingConfig
        : (existing?.routingConfig as RelayChannelRoutingConfigDto | null | undefined);
    const visibilityConfig =
      data.visibilityConfig !== undefined
        ? data.visibilityConfig
        : (existing?.visibilityConfig as RelayChannelVisibilityConfigDto | null | undefined);
    const poolMembers = this.normalizeRelayChannelMembers(
      data.poolMembers !== undefined ? data.poolMembers : undefined,
    );
    this.assertNoSelfReference(existing?.id, poolMembers);
    const isCreate = !existing;
    const wasPooled = existing?.channelType === "pooled";

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
    const allowedFormatsInput =
      data.allowedFormats !== undefined ? data.allowedFormats : existing?.allowedFormats || "all";
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

    if (allowedModels !== undefined && allowedModels !== null)
      try {
        const parsed = JSON.parse(allowedModels);
        if (!Array.isArray(parsed)) throw new Error("allowedModels must be a JSON array");
        await this.validateNoDuplicateModelIds(parsed);
      } catch (error) {
        if (error instanceof Error && error.message.includes("duplicate model ID")) throw error;
        throw new BadRequestError("allowedModels must be a valid JSON array");
      }

    if (channelType !== "pooled") {
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

    if (channelType === "pooled") {
      const memberCount = poolMembers == null ? undefined : poolMembers.length;
      if (isCreate || !wasPooled) {
        if (!memberCount) throw new BadRequestError("pooled channel must contain at least one member");
      } else if (poolMembers !== undefined && memberCount === 0)
        throw new BadRequestError("pooled channel must contain at least one member");
    }

    return {
      name,
      channelType,
      routingStrategy,
      routingConfig,
      visibilityMode,
      visibilityConfig,
      poolMembers,
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
    };
  }

  private toPersistenceInput(data: ValidatedRelayChannelData): Prisma.RelayChannelUncheckedCreateInput {
    return {
      name: data.name,
      channelType: data.channelType,
      routingStrategy: data.routingStrategy,
      routingConfig: data.routingConfig as Prisma.InputJsonValue | undefined,
      visibilityMode: data.visibilityMode,
      visibilityConfig: data.visibilityConfig as Prisma.InputJsonValue | undefined,
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

    const channel = await this.relayChannelRepository.withTransaction(async (tx) => {
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
      const items: RelayChannelDto[] = [];

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
        items.push(this.toDto(created));
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

    return duplicatedChannels;
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
      const reservedNames = await this.getVisibleNameSet();
      const items: RelayChannelDto[] = [];

      for (const item of body.channels) {
        const preferredName = item.name.trim();
        const finalName = reservedNames.has(preferredName)
          ? this.buildCopyName(preferredName, reservedNames)
          : preferredName;
        reservedNames.add(finalName);

        const validated = await this.buildValidatedChannelData({
          ...item,
          name: finalName,
        });
        const created = await this.relayChannelRepository.create(
          {
            ...this.toPersistenceInput(validated),
            status: item.enabled === false ? RELAY_CHANNEL_STATUS.DISABLED : RELAY_CHANNEL_STATUS.ENABLED,
          },
          tx,
        );
        await this.syncPoolMembers(created.id, validated.channelType, validated.poolMembers, tx);
        items.push(this.toDto(created));
      }

      return items;
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

    return {
      code: 0,
      message: "success",
      created: createdChannels.length,
      total: body.channels.length,
      data: createdChannels,
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

  private toDto(channel: RelayChannel): RelayChannelDto {
    const poolMembers = Array.isArray((channel as RelayChannel & { poolMembers?: unknown[] }).poolMembers)
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

    return {
      id: channel.id,
      name: channel.name,
      enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
      openaiUpstreamUrl: channel.openaiUpstreamUrl || undefined,
      openaiUpstreamApiKey: channel.openaiUpstreamApiKey || undefined,
      anthropicUpstreamUrl: channel.anthropicUpstreamUrl || undefined,
      anthropicUpstreamApiKey: channel.anthropicUpstreamApiKey || undefined,
      geminiUpstreamUrl: channel.geminiUpstreamUrl || undefined,
      geminiUpstreamApiKey: channel.geminiUpstreamApiKey || undefined,
      multiplier: Number(channel.multiplier),
      allowedFormats: channel.allowedFormats || "all",
      allowedModels: channel.allowedModels || undefined,
      addUserIdentifier: channel.addUserIdentifier !== false, // Default to true
      inputTokensIncludeCacheRead: channel.inputTokensIncludeCacheRead === true, // Default to false
      modelMapping: channel.modelMapping as Record<string, string> | undefined,
      timePeriodMultipliers: channel.timePeriodMultipliers as unknown as TimePeriodMultiplierRule[] | undefined,
      channelType: (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE,
      routingStrategy: (channel.routingStrategy as RelayChannelRoutingStrategy | undefined) ?? DEFAULT_ROUTING_STRATEGY,
      routingConfig: channel.routingConfig as RelayChannelRoutingConfigDto | undefined,
      visibilityMode: (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE,
      visibilityConfig: channel.visibilityConfig as RelayChannelVisibilityConfigDto | undefined,
      poolMembers,
      createTime: channel.createTime,
      updateTime: channel.updateTime,
    };
  }
}
