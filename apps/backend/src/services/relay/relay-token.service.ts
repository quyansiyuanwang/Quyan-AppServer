import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import { ModelPricingRepository } from "@/store/relay/model-pricing.repository";
import type { RelayTokenStore } from "@/store/relay/relay-token.store";
import type { RelayTokenUsageAggregate, RelayUsageStore } from "@/store/relay/relay-usage.store";
import type { ModelPricingStore } from "@/store/relay/model-pricing.store";
import {
  BatchDeleteRelayTokensRequest,
  BatchRelayTokensResultDto,
  BatchSetRelayTokenStatusRequest,
  CreateRelayTokenDto,
  DuplicateRelayTokenRequest,
  ExportRelayTokensRequest,
  ImportRelayTokensRequest,
  ImportRelayTokensResponse,
  RelayChannelSwitchLogDto,
  RelayTokenCurrentQuotaDto,
  RelayTokenCurrentQuotaQueryDto,
  RelayTokenExportItemDto,
  RelayTokenExportResponse,
  RelayTokenImportItemDto,
  RelayTokenQuotaUnit,
  UpdateRelayTokenDto,
  UpdateRelayTokenChannelDto,
  RelayTokenDto,
  RelayTokenPageDto,
  RelayTokenQuotaWindowDto,
  RelayTokenQuotaWindowInputDto,
  RelayTokenUsageDetailDto,
  RelayTokenUsageSummaryBatchDto,
  RelayTokenUsageSummaryDto,
  RelayUsageStatsDto,
  RelayAvailableModelsMapDto,
  RelayTokenSwitchLogsDto,
  RelayTokenAvailableModelsDto,
} from "@/api/dto/relay/relay.dto";
import { NotFoundError, BadRequestError, ForbiddenError } from "@/util/errors";
import { resolveModelId } from "@/util/model-resolution.util";
import { normalizeRetryStatusRules } from "@/util/relay-failover-status-rule.util";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import crypto from "crypto";
import type { Request } from "express";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { MANAGED_STATUS } from "@/constant/status";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import type { RelayChannelStore } from "@/store/relay/relay-channel.store";
import type {
  RelayTokenTransactionClient,
  RelayTokenUsageSummaryTarget,
  RelayTokenWithRelations,
} from "@/store/relay/relay-token.store";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { BalanceRepository } from "@/store/billing/balance.repository";
import type { BalanceStore } from "@/store/billing/balance.store";
import {
  MONTHLY_PASS_DECIMAL_SCALE,
  MONTHLY_PASS_MAX_AMOUNT_QUOTA,
  MONTHLY_PASS_MAX_INTEGER_QUOTA,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
  MONTHLY_PASS_QUOTA_WINDOW_MS,
} from "@/constant/monthly-pass";
import { extractClientIp } from "@/util/ip-extractor";
import {
  isIpWhitelisted,
  isValidIpWhitelistEntry,
  normalizeIpWhitelistEntries,
  splitIpWhitelistEntries,
} from "@/util/ip-whitelist.util";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@/constant/permission";

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const trimTrailingZeros = (value: number): string => String(value).replace(/\.0+$|(\.\d*?[1-9])0+$/, "$1");
const RELAY_TOKEN_QUOTA_COMPARE_EPSILON = 1e-8;
const COPY_SUFFIX = "（副本）";
const MAX_TOKEN_NAME_LENGTH = 100;
const DEFAULT_DAILY_RESET_TIMEZONE_OFFSET_MINUTES = 0;
const MAX_CUSTOM_KEY_TOKENS_PER_USER = 10;

type UsageRangeMode = "lifetime" | "window" | "custom" | "daily-reset";

type UsageSummaryRange = {
  mode: UsageRangeMode;
  label: string;
  startDate?: Date;
  endDate?: Date;
};

const hasDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < 1e-8;
};

const normalizeQuotaUnit = (value?: string | null): RelayTokenQuotaUnit => {
  if (value === "request" || value === "token") return value;
  return "amount";
};

const isIntegerQuotaUnit = (unit: RelayTokenQuotaUnit): boolean => {
  return unit === "request" || unit === "token";
};

const getQuotaMaxByUnit = (unit: RelayTokenQuotaUnit): number => {
  return isIntegerQuotaUnit(unit) ? MONTHLY_PASS_MAX_INTEGER_QUOTA : MONTHLY_PASS_MAX_AMOUNT_QUOTA;
};

const normalizeQuotaValue = (value: number, unit: RelayTokenQuotaUnit): number => {
  if (isIntegerQuotaUnit(unit)) return Math.floor(value);
  return round4(value);
};

const normalizeQuotaWindowHours = (value: number): number => {
  if (!Number.isFinite(value)) throw new BadRequestError("quotaWindowHours must be a finite number");
  const normalized = round4(Math.max(0, value));
  if (normalized > MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS)
    throw new BadRequestError(`quotaWindowHours must be less than or equal to ${MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS}`);
  return normalized;
};

const validateQuotaValue = (fieldName: string, value: number, unit: RelayTokenQuotaUnit): void => {
  if (!Number.isFinite(value) || value <= 0) throw new BadRequestError(`${fieldName} must be greater than 0`);

  if (isIntegerQuotaUnit(unit) && !Number.isInteger(value))
    throw new BadRequestError(`${fieldName} must be an integer when quotaUnit is ${unit}`);

  if (!isIntegerQuotaUnit(unit) && !hasDecimalPrecision(value, MONTHLY_PASS_DECIMAL_SCALE))
    throw new BadRequestError(
      `${fieldName} must have at most ${MONTHLY_PASS_DECIMAL_SCALE} decimal places when quotaUnit is amount`,
    );

  const max = getQuotaMaxByUnit(unit);
  if (value > max) throw new BadRequestError(`${fieldName} must not exceed ${max} when quotaUnit is ${unit}`);
};

export class RelayTokenService {
  private static readonly DEFAULT_TOKEN_PAGE = 1;
  private static readonly DEFAULT_TOKEN_PAGE_SIZE = 20;

  constructor(
    private readonly relayTokenRepo: RelayTokenStore = RelayTokenRepository.getInstance(),
    private readonly relayUsageRepo: RelayUsageStore = RelayUsageRepository.getInstance(),
    private readonly modelPricingRepo: ModelPricingStore = ModelPricingRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly relayChannelRepo: RelayChannelStore = RelayChannelRepository.getInstance(),
    private readonly relayProxyService: RelayProxyService = RelayProxyService.getInstance(),
    private readonly balanceRepo: BalanceStore = BalanceRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
  ) {}

  private normalizeOptionalExpiresAt(value?: string | Date | null): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    const normalized = String(value).trim();
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestError("expiresAt must be a valid datetime");
    return parsed;
  }

  private async checkCustomKeyPermission(userId: string): Promise<void> {
    const hasPermission = await this.permissionService.hasPermission(userId, Permission.RELAY_TOKEN_CUSTOM_KEY);
    if (!hasPermission) throw new ForbiddenError("You do not have permission to set custom token keys", undefined, { messageKey: "relay.customKeyPermissionDenied" });
  }

  private async assertCustomKeyLimit(userId: string): Promise<void> {
    const count = await this.relayTokenRepo.countCustomKeyTokensByUserId(userId);
    if (count >= MAX_CUSTOM_KEY_TOKENS_PER_USER)
      throw new BadRequestError(
        `Custom token limit reached (${MAX_CUSTOM_KEY_TOKENS_PER_USER}). Please delete unused custom tokens first.`,
        undefined,
        { messageKey: "relay.customKeyLimitReached", messageParams: { limit: MAX_CUSTOM_KEY_TOKENS_PER_USER } },
      );
  }

  async generateToken(userId: string, data: CreateRelayTokenDto, request?: Request): Promise<RelayTokenDto> {
    const normalizedConfig = await this.normalizeChannelConfiguration(data.channelId, data.channelConfigs);

    let tokenValue: string;
    let isCustomKey = false;

    if (data.token) {
      await this.checkCustomKeyPermission(userId);
      await this.assertCustomKeyLimit(userId);
      tokenValue = await this.resolveImportedTokenValue(data.token);
      isCustomKey = true;
    } else {
      tokenValue = this.generateRelayTokenValue();
    }

    const relayToken = await this.relayTokenRepo.create({
      userId,
      name: data.name?.trim() || undefined,
      token: tokenValue,
      isCustomKey,
      expiresAt: this.normalizeOptionalExpiresAt(data.expiresAt) ?? undefined,
      channelId: normalizedConfig.defaultChannelId,
      channelConfigs: normalizedConfig.channelConfigs,
      failoverConfig: data.failoverConfig,
      quotaLimit: data.quotaLimit ?? undefined,
      quotaWindows: this.normalizeQuotaWindows(data.quotaWindows),
      allowedModels: data.allowedModels?.trim() || undefined,
      ipWhitelist: this.normalizeOptionalIpWhitelist(data.ipWhitelist),
      modelMapping: data.modelMapping ?? undefined,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_CREATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: relayToken.id,
      targetResourceType: "RELAY_TOKEN",
      description: `创建了中转令牌 '${relayToken.name || relayToken.id}'`,
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(relayToken);
  }

  async exportTokens(
    body: ExportRelayTokensRequest,
    userId: string,
    request?: Request,
  ): Promise<RelayTokenExportResponse> {
    const tokens = body.ids?.length
      ? await this.getOrderedTokensByIds(userId, body.ids, body.includeDisabled === true)
      : (await this.relayTokenRepo.findByUserIdWithRelations(userId)).filter(
          (token) => body.includeDisabled === true || token.status === MANAGED_STATUS.ENABLED,
        );

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_EXPORT,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "RELAY_TOKEN",
      description: `导出了 ${tokens.length} 个中转令牌`,
      metadata: {
        ids: body.ids,
        includeDisabled: body.includeDisabled === true,
        total: tokens.length,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      tokens: tokens.map((token) => this.toExportItemDto(token)),
    };
  }

  async importTokens(
    body: ImportRelayTokensRequest,
    userId: string,
    request?: Request,
  ): Promise<ImportRelayTokensResponse> {
    const createdTokens = await this.relayTokenRepo.withTransaction(async (tx) => {
      const reservedNames = await this.getVisibleNameSet(userId);
      const reservedTokens = new Set<string>();
      const items: RelayTokenDto[] = [];

      for (const item of body.tokens) {
        const preferredName = item.name?.trim();
        const finalName = preferredName
          ? reservedNames.has(preferredName)
            ? this.buildCopyName(preferredName, reservedNames)
            : preferredName
          : undefined;

        if (finalName) reservedNames.add(finalName);

        const created = await this.createTokenFromImportData(
          userId,
          {
            ...item,
            name: finalName,
          },
          reservedTokens,
          tx,
        );
        items.push(this.toDto(created));
      }

      return items;
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_IMPORT,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "RELAY_TOKEN",
      description: `导入了 ${createdTokens.length} 个中转令牌`,
      metadata: {
        total: body.tokens.length,
        created: createdTokens.length,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return {
      code: 0,
      message: "success",
      created: createdTokens.length,
      total: body.tokens.length,
      data: createdTokens,
    };
  }

  async refreshToken(tokenId: string, userId: string, request?: Request): Promise<RelayTokenDto> {
    const token = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const refreshedTokenValue = this.generateRelayTokenValue();
    await this.relayTokenRepo.update(tokenId, {
      token: refreshedTokenValue,
    });
    const refreshedToken = await this.getToken(tokenId, userId);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_REFRESH,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: token.id,
      targetResourceType: "RELAY_TOKEN",
      description: `刷新了中转令牌 '${token.name || token.id}'`,
      changes: maskSensitiveData({
        oldToken: token.token,
        newToken: refreshedTokenValue,
      }),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return refreshedToken;
  }

  async validateToken(token: string, request?: Request) {
    const relayToken = await this.relayTokenRepo.findByToken(token);
    if (!relayToken || relayToken.status !== MANAGED_STATUS.ENABLED) throw new NotFoundError("Invalid relay token");

    if (relayToken.expiresAt && relayToken.expiresAt < new Date()) throw new BadRequestError("Relay token expired");

    if (relayToken.ipWhitelist) {
      if (!request) throw new ForbiddenError("Relay token IP whitelist requires request context");

      const clientIp = extractClientIp(request);
      if (!isIpWhitelisted(clientIp, relayToken.ipWhitelist))
        throw new ForbiddenError("Current IP is not allowed for this relay token");
    }

    return relayToken;
  }

  async listTokens(userId: string, page?: number, pageSize?: number): Promise<RelayTokenPageDto> {
    const result = await this.relayTokenRepo.findPageByUserIdWithRelations(
      userId,
      page ?? RelayTokenService.DEFAULT_TOKEN_PAGE,
      pageSize ?? RelayTokenService.DEFAULT_TOKEN_PAGE_SIZE,
    );
    const quotaWindowUsageMap = await this.buildQuotaWindowUsageMap(result.items);

    return {
      items: result.items.map((item) => this.toDto(item, quotaWindowUsageMap)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async getToken(tokenId: string, userId: string): Promise<RelayTokenDto> {
    const token = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const quotaWindowUsageMap = await this.buildQuotaWindowUsageMap([token]);
    return this.toDto(token, quotaWindowUsageMap);
  }

  async revokeToken(tokenId: string, userId: string, request?: Request): Promise<void> {
    const token = await this.relayTokenRepo.findById(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    await this.relayTokenRepo.delete(tokenId);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: token.id,
      targetResourceType: "RELAY_TOKEN",
      description: `删除了中转令牌 '${token.name || token.id}'`,
      success: true,
      ...buildBusinessLogRequestContext(request),
    });
  }

  async updateTokenChannel(
    tokenId: string,
    userId: string,
    data: UpdateRelayTokenChannelDto,
    request?: Request,
  ): Promise<RelayTokenDto> {
    const token = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const channelIds = token.channelConfigs.map((config) => config.channelId);
    if (!channelIds.includes(data.channelId)) {
      const nextConfigs = [
        { channelId: data.channelId, priority: 0 },
        ...token.channelConfigs.map((config, index) => ({
          channelId: config.channelId,
          priority: index + 1,
        })),
      ].filter((config, index, list) => list.findIndex((item) => item.channelId === config.channelId) === index);
      await this.assertChannelsExist(nextConfigs.map((config) => config.channelId));
      await this.relayTokenRepo.replaceChannelConfigs(tokenId, data.channelId, nextConfigs);
    } else {
      const reorderedConfigs = [
        { channelId: data.channelId, priority: 0 },
        ...token.channelConfigs
          .filter((config) => config.channelId !== data.channelId)
          .map((config, index) => ({ channelId: config.channelId, priority: index + 1 })),
      ];
      await this.relayTokenRepo.replaceChannelConfigs(tokenId, data.channelId, reorderedConfigs);
    }

    const updatedToken = await this.getToken(tokenId, userId);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_CHANNEL_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: token.id,
      targetResourceType: "RELAY_TOKEN",
      description: `更新了中转令牌 '${token.name || token.id}' 的渠道绑定`,
      changes: {
        fromChannelId: token.channelId ?? null,
        toChannelId: data.channelId,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return updatedToken;
  }

  async updateToken(
    tokenId: string,
    userId: string,
    data: UpdateRelayTokenDto,
    request?: Request,
  ): Promise<RelayTokenDto> {
    const token = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const normalizedConfig = await this.normalizeChannelConfiguration(
      data.channelId ?? token.channelId ?? undefined,
      data.channelConfigs,
    );
    const hasName = Object.prototype.hasOwnProperty.call(data, "name");
    const hasExpiresAt = Object.prototype.hasOwnProperty.call(data, "expiresAt");
    const hasQuotaWindows = Object.prototype.hasOwnProperty.call(data, "quotaWindows");
    const hasQuotaLimit = Object.prototype.hasOwnProperty.call(data, "quotaLimit");
    const hasAllowedModels = Object.prototype.hasOwnProperty.call(data, "allowedModels");
    const hasModelMapping = Object.prototype.hasOwnProperty.call(data, "modelMapping");
    const hasToken = Object.prototype.hasOwnProperty.call(data, "token");

    let tokenValue: string | undefined;
    let isCustomKey: boolean | undefined;

    if (hasToken && data.token) {
      await this.checkCustomKeyPermission(userId);
      if (!token.isCustomKey) await this.assertCustomKeyLimit(userId);
      tokenValue = await this.resolveImportedTokenValue(data.token);
      isCustomKey = true;
    }

    await this.relayTokenRepo.update(tokenId, {
      name: hasName ? data.name?.trim() || null : undefined,
      ...(hasToken ? { token: tokenValue, isCustomKey } : {}),
      expiresAt: hasExpiresAt ? (this.normalizeOptionalExpiresAt(data.expiresAt) ?? null) : undefined,
      quotaLimit: hasQuotaLimit ? (data.quotaLimit ?? null) : undefined,
      quotaWindows: hasQuotaWindows ? this.normalizeQuotaWindows(data.quotaWindows) : undefined,
      allowedModels: hasAllowedModels ? data.allowedModels?.trim() || null : undefined,
      ipWhitelist: Object.prototype.hasOwnProperty.call(data, "ipWhitelist")
        ? this.normalizeOptionalIpWhitelist(data.ipWhitelist)
        : undefined,
      modelMapping: hasModelMapping ? (data.modelMapping ?? null) : undefined,
      channelId: normalizedConfig.defaultChannelId,
      channelConfigs: normalizedConfig.channelConfigs,
      failoverConfig: data.failoverConfig,
    });
    const updatedToken = await this.getToken(tokenId, userId);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_UPDATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: token.id,
      targetResourceType: "RELAY_TOKEN",
      description: `更新了中转令牌 '${token.name || token.id}'`,
      changes: maskSensitiveData(data),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return updatedToken;
  }

  async duplicateToken(
    tokenId: string,
    data: DuplicateRelayTokenRequest,
    userId: string,
    request?: Request,
  ): Promise<RelayTokenDto> {
    const sourceToken = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!sourceToken || sourceToken.userId !== userId) throw new NotFoundError("Relay token not found");

    const reservedNames = await this.getVisibleNameSet(userId);
    const duplicatedName = data.name?.trim() || this.buildDuplicatedTokenName(sourceToken.name, reservedNames);
    const duplicatedToken = await this.relayTokenRepo.withTransaction((tx) =>
      this.createTokenFromImportData(
        userId,
        {
          ...this.toImportItemDto(sourceToken),
          name: duplicatedName,
          enabled: true,
          token: undefined,
        },
        new Set<string>(),
        tx,
      ),
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_DUPLICATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: duplicatedToken.id,
      targetResourceType: "RELAY_TOKEN",
      description: `复制了中转令牌 '${sourceToken.name || sourceToken.id}'`,
      metadata: {
        sourceTokenId: sourceToken.id,
        sourceTokenName: sourceToken.name,
      },
      changes: maskSensitiveData({ name: duplicatedName }),
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return this.toDto(duplicatedToken);
  }

  async batchDuplicateTokens(ids: string[], userId: string, request?: Request): Promise<RelayTokenDto[]> {
    const sourceTokens = await this.getOrderedTokensByIds(userId, ids, true);
    const duplicatedTokens = await this.relayTokenRepo.withTransaction(async (tx) => {
      const reservedNames = await this.getVisibleNameSet(userId);
      const reservedTokens = new Set<string>();
      const items: RelayTokenDto[] = [];

      for (const sourceToken of sourceTokens) {
        const duplicatedName = this.buildDuplicatedTokenName(sourceToken.name, reservedNames);
        const duplicatedToken = await this.createTokenFromImportData(
          userId,
          {
            ...this.toImportItemDto(sourceToken),
            name: duplicatedName,
            enabled: true,
            token: undefined,
          },
          reservedTokens,
          tx,
        );
        items.push(this.toDto(duplicatedToken));
      }

      return items;
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_BATCH_DUPLICATE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "RELAY_TOKEN",
      description: `批量复制了 ${duplicatedTokens.length} 个中转令牌`,
      metadata: {
        ids,
        total: duplicatedTokens.length,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return duplicatedTokens;
  }

  async toggleTokenStatus(tokenId: string, userId: string, request?: Request): Promise<RelayTokenDto> {
    const token = await this.relayTokenRepo.findById(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const newStatus = token.status === MANAGED_STATUS.ENABLED ? MANAGED_STATUS.DISABLED : MANAGED_STATUS.ENABLED;
    await this.relayTokenRepo.updateStatus(tokenId, newStatus);
    const updatedToken = await this.getToken(tokenId, userId);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_STATUS_CHANGE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceId: token.id,
      targetResourceType: "RELAY_TOKEN",
      description: `将中转令牌 '${token.name || token.id}' ${newStatus === MANAGED_STATUS.ENABLED ? "启用" : "禁用"}`,
      changes: {
        fromStatus: token.status,
        toStatus: newStatus,
      },
      success: true,
      ...buildBusinessLogRequestContext(request),
    });

    return updatedToken;
  }

  async batchSetTokenStatus(
    body: BatchSetRelayTokenStatusRequest,
    userId: string,
    request?: Request,
  ): Promise<BatchRelayTokensResultDto> {
    await this.getOrderedTokensByIds(userId, body.ids, true);
    const status = body.enabled ? MANAGED_STATUS.ENABLED : MANAGED_STATUS.DISABLED;
    const affected = await this.relayTokenRepo.updateStatusByIds(userId, body.ids, status);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_BATCH_STATUS_CHANGE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "RELAY_TOKEN",
      description: `批量${body.enabled ? "启用" : "禁用"}了 ${affected} 个中转令牌`,
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

  async batchDeleteTokens(
    body: BatchDeleteRelayTokensRequest,
    userId: string,
    request?: Request,
  ): Promise<BatchRelayTokensResultDto> {
    await this.getOrderedTokensByIds(userId, body.ids, true);
    const affected = await this.relayTokenRepo.deleteByIds(userId, body.ids);

    await this.businessLogService.logOperation({
      operationType: OperationType.RELAY_TOKEN_BATCH_DELETE,
      operationCategory: OperationCategory.RELAY,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "RELAY_TOKEN",
      description: `批量删除了 ${affected} 个中转令牌`,
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

  async getUsageStats(tokenId: string, userId: string, startDate?: Date, endDate?: Date): Promise<RelayUsageStatsDto> {
    const token = await this.relayTokenRepo.findById(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const usages = await this.relayUsageRepo.findByRelayTokenId(tokenId, startDate, endDate);
    const totalTokens = usages.reduce((sum, u) => sum + u.totalTokens, 0);
    const requestCount = usages.length;
    return {
      totalTokens,
      requestCount,
      avgTokensPerRequest: requestCount > 0 ? totalTokens / requestCount : 0,
      usages: usages.map((u) => ({
        id: u.id,
        relayTokenId: u.relayTokenId,
        requestTokens: u.requestTokens,
        responseTokens: u.responseTokens,
        totalTokens: u.totalTokens,
        cacheCreationTokens: u.cacheCreationTokens,
        cacheReadTokens: u.cacheReadTokens,
        path: u.path,
        method: u.method,
        statusCode: u.statusCode,
        ipAddress: u.ipAddress,
        createTime: u.createTime,
      })),
    };
  }

  async getUsageSummaries(
    userId: string,
    tokenIds?: string[],
    startDate?: Date,
    endDate?: Date,
  ): Promise<RelayTokenUsageSummaryBatchDto> {
    const targetTokens = tokenIds?.length
      ? await this.getRequestedUsageSummaryTargets(userId, tokenIds)
      : await this.relayTokenRepo.findUsageSummaryTargetsByUserId(userId);

    if (!startDate && !endDate)
      return {
        summaries: targetTokens.map((token) =>
          this.buildUsageSummaryDto(token, undefined, { usePersistedQuota: true }),
        ),
      };

    const aggregateRows = await this.relayUsageRepo.aggregateByRelayTokenIds(
      targetTokens.map((token) => token.id),
      startDate,
      endDate,
    );
    const aggregateMap = new Map(aggregateRows.map((row) => [row.relayTokenId, row]));

    return {
      summaries: targetTokens.map((token) => this.buildUsageSummaryDto(token, aggregateMap.get(token.id))),
    };
  }

  async getUsageSummary(
    tokenId: string,
    userId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 20,
    offset: number = 0,
  ): Promise<RelayTokenUsageDetailDto> {
    const token = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const [aggregateRows, usageDetailPage] = await Promise.all([
      this.relayUsageRepo.aggregateByRelayTokenIds([tokenId], startDate, endDate),
      this.relayUsageRepo.findUsageDetailPageByRelayTokenId(tokenId, startDate, endDate, limit, offset),
    ]);

    const summary = this.buildUsageSummaryDto(token, aggregateRows[0]);

    return {
      ...summary,
      total: usageDetailPage.total,
      limit,
      offset,
      usages: usageDetailPage.usages.map((usage) => ({
        id: usage.id,
        relayTokenId: usage.relayTokenId,
        requestTokens: usage.requestTokens,
        responseTokens: usage.responseTokens,
        totalTokens: usage.totalTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        cacheReadTokens: usage.cacheReadTokens,
        path: usage.path,
        method: usage.method,
        statusCode: usage.statusCode,
        ipAddress: usage.ipAddress,
        createTime: usage.createTime,
        chargedAmount: usage.chargedAmount,
        coveredAmount: usage.coveredAmount,
        totalSpend: usage.totalSpend,
      })),
    };
  }

  async getCurrentTokenQuotaSummary(
    relayToken: RelayTokenWithRelations,
    query?: RelayTokenCurrentQuotaQueryDto,
  ): Promise<RelayTokenCurrentQuotaDto> {
    const range = this.resolveUsageSummaryRange(query);
    const [aggregateRows, allTimeAggregateRows] = await Promise.all([
      range.startDate || range.endDate
        ? this.relayUsageRepo.aggregateByRelayTokenIds([relayToken.id], range.startDate, range.endDate)
        : Promise.resolve([]),
      this.relayUsageRepo.aggregateByRelayTokenIds([relayToken.id]),
    ]);
    const aggregate = aggregateRows[0];
    const allTimeAggregate = allTimeAggregateRows[0];
    const summary = this.buildUsageSummaryDto(relayToken, aggregate, {
      rangeMode: range.mode,
      rangeLabel: range.label,
      rangeStartAt: range.startDate,
      rangeEndAt: range.endDate,
    });
    const allTimeSummary = this.buildUsageSummaryDto(relayToken, allTimeAggregate, {
      rangeMode: "lifetime",
      rangeLabel: "lifetime",
    });
    const quotaWindowUsageMap = await this.buildQuotaWindowUsageMap([relayToken]);
    const balanceAccount = await this.balanceRepo.findAccountByUserId(relayToken.userId);

    return {
      scopedSummary: summary,
      allTimeSummary,
      balance: Math.floor(Number(balanceAccount?.balance || 0) * 10000) / 10000,
      status: relayToken.status,
      expiresAt: relayToken.expiresAt ?? undefined,
      quotaWindows: this.toQuotaWindowDtos(relayToken.quotaWindows, quotaWindowUsageMap, relayToken.id),
      allowedModels: relayToken.allowedModels || undefined,
      ipWhitelist: relayToken.ipWhitelist || undefined,
    };
  }

  /** 旧版 getCurrentTokenQuotaSummary — 无 allTimeSummary、无 totalSpend、无 range 字段 */
  async getCurrentTokenQuotaSummaryLegacy(relayToken: RelayTokenWithRelations): Promise<RelayTokenCurrentQuotaDto> {
    const summary = this.buildUsageSummaryDto(relayToken, undefined);
    const quotaWindowUsageMap = await this.buildQuotaWindowUsageMap([relayToken]);
    const balanceAccount = await this.balanceRepo.findAccountByUserId(relayToken.userId);

    return {
      scopedSummary: summary,
      allTimeSummary: summary,
      balance: Math.floor(Number(balanceAccount?.balance || 0) * 10000) / 10000,
      status: relayToken.status,
      expiresAt: relayToken.expiresAt ?? undefined,
      quotaWindows: this.toQuotaWindowDtos(relayToken.quotaWindows, quotaWindowUsageMap, relayToken.id),
      allowedModels: relayToken.allowedModels || undefined,
      ipWhitelist: relayToken.ipWhitelist || undefined,
    };
  }

  async getAvailableModels(): Promise<RelayAvailableModelsMapDto> {
    const modelConfigs = await this.modelPricingRepo.listActiveOrderedByModel();

    const modelNames: string[] = [];
    const seenModelNames = new Set<string>();
    const uniqueModelIdToName = new Map<string, string>();
    const ambiguousModelIds = new Set<string>();
    const modelIdToModelNamesMap = new Map<string, string[]>();
    const modelIds: string[] = [];
    const seenModelIds = new Set<string>();

    for (const modelConfig of modelConfigs) {
      const modelName = String(modelConfig.model || "").trim();
      if (!modelName) continue;

      if (!seenModelNames.has(modelName)) {
        seenModelNames.add(modelName);
        modelNames.push(modelName);
      }

      const modelId = String(resolveModelId(modelConfig) || "").trim();
      if (!modelId) continue;

      // Add to modelIds list
      if (!seenModelIds.has(modelId)) {
        seenModelIds.add(modelId);
        modelIds.push(modelId);
      }

      // Build modelId -> modelNames[] map (including one-to-many)
      const existingNames = modelIdToModelNamesMap.get(modelId) || [];
      if (!existingNames.includes(modelName)) {
        existingNames.push(modelName);
        modelIdToModelNamesMap.set(modelId, existingNames);
      }

      // Build unique modelId -> modelName map (only one-to-one)
      if (ambiguousModelIds.has(modelId)) continue;

      const existingModelName = uniqueModelIdToName.get(modelId);
      if (!existingModelName) {
        uniqueModelIdToName.set(modelId, modelName);
        continue;
      }

      if (existingModelName !== modelName) {
        uniqueModelIdToName.delete(modelId);
        ambiguousModelIds.add(modelId);
      }
    }

    return {
      modelNames,
      modelIdToModelNameMap: Object.fromEntries(uniqueModelIdToName),
      modelIdToModelNamesMap: Object.fromEntries(modelIdToModelNamesMap),
      modelIds,
    };
  }

  async getSwitchLogs(tokenId: string, userId: string, limit: number = 50): Promise<RelayTokenSwitchLogsDto> {
    const token = await this.relayTokenRepo.findById(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const logs = await this.relayTokenRepo.listSwitchLogs(tokenId, limit);
    const channelIds = [...new Set(logs.flatMap((log) => [log.fromChannelId, log.toChannelId]))];
    const channels = await this.relayChannelRepo.listActiveByIds(channelIds);
    const channelNameMap = new Map(channels.map((channel) => [channel.id, channel.name]));

    return {
      logs: logs.map((log) => this.toSwitchLogDto(log, channelNameMap)),
    };
  }

  async getTokenAvailableModels(tokenId: string, userId: string): Promise<RelayTokenAvailableModelsDto> {
    const token = await this.relayTokenRepo.findByIdWithRelations(tokenId);
    if (!token || token.userId !== userId) throw new NotFoundError("Relay token not found");

    const [openaiModels, anthropicModels, geminiModels] = await Promise.all([
      this.relayProxyService.getAvailableModelsForToken(token, "openai"),
      this.relayProxyService.getAvailableModelsForToken(token, "anthropic"),
      this.relayProxyService.getAvailableModelsForToken(token, "gemini"),
    ]);

    return {
      openai: openaiModels,
      anthropic: anthropicModels,
      gemini: geminiModels,
    };
  }

  private toDto(
    token: RelayTokenWithRelations | any,
    quotaWindowUsageMap?: Map<string, RelayTokenUsageAggregate>,
  ): RelayTokenDto {
    const channelConfigs = Array.isArray(token.channelConfigs)
      ? token.channelConfigs.map((config: any) => {
          const successCount = Number(config.successCount || 0);
          const failureCount = Number(config.failureCount || 0);
          const total = successCount + failureCount;
          return {
            channelId: config.channelId,
            channelName: config.channel?.name || undefined,
            priority: config.priority,
            successCount,
            failureCount,
            successRate: total > 0 ? successCount / total : 0,
            lastUsedAt: config.lastUsedAt || undefined,
            lastSuccessAt: config.lastSuccessAt || undefined,
            lastFailureAt: config.lastFailureAt || undefined,
          };
        })
      : [];

    return {
      id: token.id,
      name: token.name,
      token: token.token,
      balance: Number(token.balance),
      totalTokens: token.totalTokens,
      requestCount: token.requestCount,
      usedQuota: Number(token.usedQuota || 0),
      channelId: token.channelId || undefined,
      channelName: token.channel?.name || undefined,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      createTime: token.createTime,
      status: token.status,
      quotaLimit: token.quotaLimit != null ? Number(token.quotaLimit) : undefined,
      quotaWindows: this.toQuotaWindowDtos(token.quotaWindows, quotaWindowUsageMap, token.id),
      allowedModels: token.allowedModels || undefined,
      ipWhitelist: token.ipWhitelist || undefined,
      modelMapping: token.modelMapping as Record<string, string> | undefined,
      channelConfigs,
      failoverConfig: token.failoverConfig
        ? {
            enabled: Boolean(token.failoverConfig.enabled),
            maxRetries: Number(token.failoverConfig.maxRetries || 0),
            retryStatusCodes: normalizeRetryStatusRules(
              Array.isArray(token.failoverConfig.retryStatusCodes) ? token.failoverConfig.retryStatusCodes : [],
            ),
            failoverThreshold: Math.max(0, Number(token.failoverConfig.failoverThreshold ?? 0)),
          }
        : undefined,
    };
  }

  private toImportItemDto(token: RelayTokenWithRelations): RelayTokenImportItemDto {
    return {
      name: token.name || undefined,
      token: token.token,
      expiresAt: token.expiresAt ? token.expiresAt.toISOString() : undefined,
      channelId: token.channelId || token.channelConfigs[0]?.channelId || undefined,
      channelConfigs: token.channelConfigs.map((config) => ({
        channelId: config.channelId,
        priority: config.priority,
      })),
      failoverConfig: token.failoverConfig
        ? {
            enabled: Boolean(token.failoverConfig.enabled),
            maxRetries: Number(token.failoverConfig.maxRetries || 0),
            retryStatusCodes: normalizeRetryStatusRules(
              Array.isArray(token.failoverConfig.retryStatusCodes) ? token.failoverConfig.retryStatusCodes : [],
            ),
            failoverThreshold: Math.max(0, Number(token.failoverConfig.failoverThreshold ?? 0)),
          }
        : undefined,
      quotaLimit: token.quotaLimit != null ? Number(token.quotaLimit) : undefined,
      quotaWindows: Array.isArray(token.quotaWindows)
        ? token.quotaWindows.map((quotaWindow) => ({
            quotaLimit: Number(quotaWindow.quotaLimit),
            quotaUnit: normalizeQuotaUnit(quotaWindow.quotaUnit),
            quotaWindowHours: Number(quotaWindow.quotaWindowHours),
          }))
        : undefined,
      allowedModels: token.allowedModels || undefined,
      ipWhitelist: token.ipWhitelist || undefined,
      modelMapping: token.modelMapping as Record<string, string> | undefined,
      enabled: token.status === MANAGED_STATUS.ENABLED,
    };
  }

  private toExportItemDto(token: RelayTokenWithRelations): RelayTokenExportItemDto {
    return {
      ...this.toImportItemDto(token),
      id: token.id,
      token: token.token,
      enabled: token.status === MANAGED_STATUS.ENABLED,
      createTime: token.createTime,
      updateTime: token.updateTime,
    };
  }

  private buildUsageSummaryDto(
    token: RelayTokenUsageSummaryTarget,
    aggregate?: {
      relayTokenId: string;
      requestCount: number;
      requestTokens: number;
      responseTokens: number;
      totalTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      chargedAmount: number;
      coveredAmount: number;
      lastUsedAt?: Date;
    },
    options?: {
      usePersistedQuota?: boolean;
      rangeMode?: UsageRangeMode;
      rangeLabel?: string;
      rangeStartAt?: Date;
      rangeEndAt?: Date;
    },
  ): RelayTokenUsageSummaryDto {
    const hasExplicitRange = Boolean(options?.rangeMode && options.rangeMode !== "lifetime");
    const usePersistedQuota = options?.usePersistedQuota ?? (aggregate == null && !hasExplicitRange);
    const quotaLimit = token.quotaLimit != null ? Number(token.quotaLimit) : undefined;
    const chargedAmount = usePersistedQuota ? 0 : (aggregate?.chargedAmount ?? 0);
    const coveredAmount = usePersistedQuota ? 0 : (aggregate?.coveredAmount ?? 0);
    const usedQuota = usePersistedQuota ? Number(token.usedQuota || 0) : chargedAmount + coveredAmount;
    const remainingQuota = quotaLimit != null ? Math.max(quotaLimit - usedQuota, 0) : undefined;
    const quotaUsagePercent = quotaLimit && quotaLimit > 0 ? (usedQuota / quotaLimit) * 100 : undefined;
    const totalSpend = chargedAmount + coveredAmount;

    return {
      relayTokenId: token.id,
      tokenName: token.name || undefined,
      quotaLimit,
      usedQuota,
      remainingQuota,
      quotaUsagePercent,
      isQuotaExceeded: quotaLimit != null ? usedQuota >= quotaLimit : false,
      rangeMode: options?.rangeMode,
      rangeLabel: options?.rangeLabel,
      rangeStartAt: options?.rangeStartAt,
      rangeEndAt: options?.rangeEndAt,
      requestCount: aggregate?.requestCount ?? (hasExplicitRange ? 0 : (token.requestCount ?? 0)),
      requestTokens: aggregate?.requestTokens ?? 0,
      responseTokens: aggregate?.responseTokens ?? 0,
      totalTokens: aggregate?.totalTokens ?? (hasExplicitRange ? 0 : (token.totalTokens ?? 0)),
      cacheCreationTokens: aggregate?.cacheCreationTokens ?? 0,
      cacheReadTokens: aggregate?.cacheReadTokens ?? 0,
      chargedAmount,
      coveredAmount,
      totalSpend,
      lastUsedAt: aggregate?.lastUsedAt ?? (hasExplicitRange ? undefined : (token.lastUsedAt ?? undefined)),
    };
  }

  private resolveUsageSummaryRange(query?: RelayTokenCurrentQuotaQueryDto): UsageSummaryRange {
    const now = new Date();
    const startDate = query?.startDate ? new Date(query.startDate) : undefined;
    const endDate = query?.endDate ? new Date(query.endDate) : now;

    if (startDate || query?.endDate) {
      if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime())))
        throw new BadRequestError("startDate and endDate must be valid datetimes");

      return {
        mode: "custom",
        label: startDate && endDate ? `${startDate.toISOString()} ~ ${endDate.toISOString()}` : "custom-range",
        startDate,
        endDate,
      };
    }

    if (query?.resetAt) {
      const timezoneOffsetMinutes = Number.isFinite(Number(query.timezoneOffsetMinutes))
        ? Number(query.timezoneOffsetMinutes)
        : DEFAULT_DAILY_RESET_TIMEZONE_OFFSET_MINUTES;
      const resetRange = this.buildDailyResetRange(query.resetAt, timezoneOffsetMinutes, now);

      return {
        mode: "daily-reset",
        label: `since ${query.resetAt} (UTC${this.formatTimezoneOffset(timezoneOffsetMinutes)})`,
        startDate: resetRange.startDate,
        endDate: now,
      };
    }

    if (query?.windowHours != null) {
      const windowHours = round4(Number(query.windowHours));
      if (!Number.isFinite(windowHours) || windowHours < 0)
        throw new BadRequestError("windowHours must be a valid non-negative number");

      return {
        mode: "window",
        label: `last ${trimTrailingZeros(windowHours)}h`,
        startDate: new Date(now.getTime() - windowHours * MONTHLY_PASS_QUOTA_WINDOW_MS),
        endDate: now,
      };
    }

    return {
      mode: "lifetime",
      label: "lifetime",
    };
  }

  private buildDailyResetRange(resetAt: string, timezoneOffsetMinutes: number, now: Date): { startDate: Date } {
    const [hoursText, minutesText] = resetAt.split(":");
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes))
      throw new BadRequestError("resetAt must be in HH:mm format");

    const shiftedNowMs = now.getTime() + timezoneOffsetMinutes * 60 * 1000;
    const shiftedNow = new Date(shiftedNowMs);
    const anchor = new Date(shiftedNow);
    anchor.setUTCHours(hours, minutes, 0, 0);
    if (anchor.getTime() > shiftedNow.getTime()) anchor.setUTCDate(anchor.getUTCDate() - 1);

    return {
      startDate: new Date(anchor.getTime() - timezoneOffsetMinutes * 60 * 1000),
    };
  }

  private formatTimezoneOffset(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteMinutes = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
    const minutes = String(absoluteMinutes % 60).padStart(2, "0");
    return `${sign}${hours}:${minutes}`;
  }

  private async getRequestedUsageSummaryTargets(
    userId: string,
    tokenIds: string[],
  ): Promise<RelayTokenUsageSummaryTarget[]> {
    const tokens = await this.relayTokenRepo.findUsageSummaryTargetsByIds(userId, tokenIds);
    const tokenMap = new Map(tokens.map((token) => [token.id, token]));

    return tokenIds
      .map((id) => tokenMap.get(id))
      .filter((token): token is RelayTokenUsageSummaryTarget => Boolean(token));
  }

  private toSwitchLogDto(log: any, channelNameMap: Map<string, string>): RelayChannelSwitchLogDto {
    return {
      id: log.id,
      relayTokenId: log.relayTokenId,
      fromChannelId: log.fromChannelId,
      fromChannelName: channelNameMap.get(log.fromChannelId),
      toChannelId: log.toChannelId,
      toChannelName: channelNameMap.get(log.toChannelId),
      triggerStatusCode: log.triggerStatusCode ?? undefined,
      triggerError: log.triggerError ?? undefined,
      attemptNumber: log.attemptNumber,
      requestPath: log.requestPath,
      method: log.method,
      modelName: log.modelName ?? undefined,
      createTime: log.createTime,
    };
  }

  private getQuotaWindowUsageKey(relayTokenId: string, quotaWindowHours: number): string {
    return `${relayTokenId}:${round4(quotaWindowHours)}`;
  }

  private getQuotaWindowConsumed(summary: RelayTokenUsageAggregate | undefined, unit: RelayTokenQuotaUnit): number {
    if (!summary) return 0;
    if (unit === "request") return summary.requestCount;
    if (unit === "token") return summary.totalTokens;
    return round4(summary.chargedAmount + summary.coveredAmount);
  }

  private isQuotaExceeded(consumed: number, limit: number, unit: RelayTokenQuotaUnit): boolean {
    if (unit === "amount") return round4(consumed) + RELAY_TOKEN_QUOTA_COMPARE_EPSILON >= round4(limit);
    return Math.floor(consumed) >= Math.floor(limit);
  }

  private normalizeConsumedQuotaValue(value: number, unit: RelayTokenQuotaUnit): number {
    if (unit === "amount") return round4(Math.max(0, value));
    return Math.max(0, Math.floor(value));
  }

  private async buildQuotaWindowUsageMap(
    tokens: Array<Pick<RelayTokenWithRelations, "id" | "quotaWindows">>,
  ): Promise<Map<string, RelayTokenUsageAggregate>> {
    const relayTokenIds = [...new Set(tokens.map((token) => token.id).filter(Boolean))];
    if (relayTokenIds.length === 0) return new Map();

    const uniqueWindowHours = [
      ...new Set(
        tokens.flatMap((token) =>
          Array.isArray(token.quotaWindows)
            ? token.quotaWindows
                .map((quotaWindow) => round4(Number(quotaWindow.quotaWindowHours)))
                .filter((quotaWindowHours) => Number.isFinite(quotaWindowHours) && quotaWindowHours > 0)
            : [],
        ),
      ),
    ];

    if (uniqueWindowHours.length === 0) return new Map();

    const now = new Date();
    const aggregateResults = await Promise.all(
      uniqueWindowHours.map(async (quotaWindowHours) => {
        const startDate = new Date(now.getTime() - quotaWindowHours * MONTHLY_PASS_QUOTA_WINDOW_MS);
        const aggregates = await this.relayUsageRepo.aggregateByRelayTokenIds(relayTokenIds, startDate, now);
        return [quotaWindowHours, aggregates] as const;
      }),
    );

    const quotaWindowUsageMap = new Map<string, RelayTokenUsageAggregate>();
    for (const [quotaWindowHours, aggregates] of aggregateResults)
      for (const aggregate of aggregates)
        quotaWindowUsageMap.set(this.getQuotaWindowUsageKey(aggregate.relayTokenId, quotaWindowHours), aggregate);

    return quotaWindowUsageMap;
  }

  private async normalizeChannelConfiguration(
    channelId?: string,
    channelConfigs?: Array<{ channelId: string; priority: number }>,
  ): Promise<{ defaultChannelId: string; channelConfigs: Array<{ channelId: string; priority: number }> }> {
    const normalizedConfigs =
      channelConfigs && channelConfigs.length > 0
        ? [...channelConfigs]
            .sort((a, b) => a.priority - b.priority)
            .map((config, index) => ({ channelId: config.channelId, priority: index }))
        : channelId
          ? [{ channelId, priority: 0 }]
          : [];

    if (normalizedConfigs.length === 0) throw new BadRequestError("At least one relay channel must be configured");

    await this.assertChannelsExist(normalizedConfigs.map((config) => config.channelId));

    return {
      defaultChannelId: normalizedConfigs[0].channelId,
      channelConfigs: normalizedConfigs,
    };
  }

  private buildCopyName(baseName: string, reservedNames: Set<string>): string {
    for (let index = 1; index < 10000; index += 1) {
      const suffix = index === 1 ? COPY_SUFFIX : `（副本${index}）`;
      const trimmedBaseName = baseName.slice(0, Math.max(1, MAX_TOKEN_NAME_LENGTH - suffix.length)).trim();
      const candidate = `${trimmedBaseName}${suffix}`;

      if (!reservedNames.has(candidate)) {
        reservedNames.add(candidate);
        return candidate;
      }
    }

    throw new BadRequestError("Unable to generate a unique relay token name");
  }

  private buildDuplicatedTokenName(baseName?: string | null, reservedNames?: Set<string>): string | undefined {
    const normalizedName = String(baseName || "").trim();
    if (!normalizedName) return undefined;
    return this.buildCopyName(normalizedName, reservedNames || new Set<string>());
  }

  private async getVisibleNameSet(userId: string): Promise<Set<string>> {
    const tokens = await this.relayTokenRepo.findByUserIdWithRelations(userId);
    return new Set(tokens.map((token) => token.name?.trim()).filter(Boolean) as string[]);
  }

  private async getOrderedTokensByIds(
    userId: string,
    ids: string[],
    includeDisabled: boolean,
  ): Promise<RelayTokenWithRelations[]> {
    const uniqueIds = [...new Set(ids)];
    const tokens = await this.relayTokenRepo.findByUserIdWithRelationsByIds(
      userId,
      uniqueIds,
      includeDisabled ? [MANAGED_STATUS.ENABLED, MANAGED_STATUS.DISABLED] : [MANAGED_STATUS.ENABLED],
    );

    if (tokens.length !== uniqueIds.length) throw new NotFoundError("One or more relay tokens were not found");

    const tokenMap = new Map(tokens.map((token) => [token.id, token]));
    return uniqueIds.map((id) => tokenMap.get(id)!).filter(Boolean);
  }

  private async resolveImportedTokenValue(
    preferredToken?: string | null,
    reservedTokens: Set<string> = new Set<string>(),
  ): Promise<string> {
    const normalizedToken = String(preferredToken || "").trim();

    if (normalizedToken && !reservedTokens.has(normalizedToken)) {
      const existing = await this.relayTokenRepo.findByToken(normalizedToken);
      if (!existing) {
        reservedTokens.add(normalizedToken);
        return normalizedToken;
      }
    }

    let generatedToken = this.generateRelayTokenValue();
    while (reservedTokens.has(generatedToken) || (await this.relayTokenRepo.findByToken(generatedToken)))
      generatedToken = this.generateRelayTokenValue();

    reservedTokens.add(generatedToken);
    return generatedToken;
  }

  private async createTokenFromImportData(
    userId: string,
    data: RelayTokenImportItemDto,
    reservedTokens: Set<string> = new Set<string>(),
    tx?: RelayTokenTransactionClient,
  ): Promise<RelayTokenWithRelations> {
    const normalizedConfig = await this.normalizeChannelConfiguration(data.channelId, data.channelConfigs);

    const hasCustomToken = Boolean(data.token?.trim());
    if (hasCustomToken) {
      await this.checkCustomKeyPermission(userId);
      await this.assertCustomKeyLimit(userId);
    }

    const tokenValue = await this.resolveImportedTokenValue(data.token, reservedTokens);
    const isCustomKey = hasCustomToken && tokenValue === data.token!.trim();

    return this.relayTokenRepo.create(
      {
        userId,
        status: data.enabled === false ? MANAGED_STATUS.DISABLED : MANAGED_STATUS.ENABLED,
        name: data.name?.trim() || undefined,
        token: tokenValue,
        isCustomKey,
        expiresAt: this.normalizeOptionalExpiresAt(data.expiresAt) ?? undefined,
        channelId: normalizedConfig.defaultChannelId,
        channelConfigs: normalizedConfig.channelConfigs,
        failoverConfig: data.failoverConfig,
        quotaLimit: data.quotaLimit ?? undefined,
        quotaWindows: this.normalizeQuotaWindows(data.quotaWindows),
        allowedModels: data.allowedModels?.trim() || undefined,
        ipWhitelist: this.normalizeOptionalIpWhitelist(data.ipWhitelist),
        modelMapping: data.modelMapping ?? undefined,
      },
      tx,
    );
  }

  private toQuotaWindowDtos(
    quotaWindows: Array<any> | undefined,
    quotaWindowUsageMap?: Map<string, RelayTokenUsageAggregate>,
    relayTokenId?: string,
  ): RelayTokenQuotaWindowDto[] {
    if (!Array.isArray(quotaWindows)) return [];

    return quotaWindows.map((quotaWindow) => {
      const quotaLimit = Number(quotaWindow.quotaLimit);
      const quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit);
      const quotaWindowHours = Number(quotaWindow.quotaWindowHours);
      const aggregate =
        relayTokenId && quotaWindowUsageMap
          ? quotaWindowUsageMap.get(this.getQuotaWindowUsageKey(relayTokenId, quotaWindowHours))
          : undefined;
      const usedQuota = this.normalizeConsumedQuotaValue(this.getQuotaWindowConsumed(aggregate, quotaUnit), quotaUnit);
      const remainingQuota = this.normalizeConsumedQuotaValue(Math.max(quotaLimit - usedQuota, 0), quotaUnit);
      const quotaUsagePercent = quotaLimit > 0 ? (usedQuota / quotaLimit) * 100 : undefined;

      return {
        id: quotaWindow.id,
        quotaLimit,
        quotaUnit,
        quotaWindowHours,
        usedQuota,
        remainingQuota,
        quotaUsagePercent,
        isQuotaExceeded: this.isQuotaExceeded(usedQuota, quotaLimit, quotaUnit),
      };
    });
  }

  private normalizeQuotaWindows(quotaWindows?: RelayTokenQuotaWindowInputDto[]) {
    if (!quotaWindows?.length) return [];

    const seenRuleKeys = new Set<string>();
    const normalizedWindows = quotaWindows.map((quotaWindow) => {
      const quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit);
      const quotaLimit = Number(quotaWindow.quotaLimit);
      const quotaWindowHours = normalizeQuotaWindowHours(Number(quotaWindow.quotaWindowHours));

      validateQuotaValue("quotaLimit", quotaLimit, quotaUnit);

      const ruleKey = `${quotaUnit}:${quotaWindowHours}`;
      if (seenRuleKeys.has(ruleKey)) throw new BadRequestError("quotaWindowHours + quotaUnit must be unique");
      seenRuleKeys.add(ruleKey);

      return {
        quotaLimit: normalizeQuotaValue(quotaLimit, quotaUnit),
        quotaUnit,
        quotaWindowHours,
      };
    });

    return normalizedWindows.sort((a, b) => {
      if (a.quotaWindowHours !== b.quotaWindowHours) return a.quotaWindowHours - b.quotaWindowHours;
      return a.quotaUnit.localeCompare(b.quotaUnit);
    });
  }

  private async assertChannelsExist(channelIds: string[]): Promise<void> {
    const uniqueChannelIds = [...new Set(channelIds)];
    const channels = await this.relayChannelRepo.listActiveByIds(uniqueChannelIds);
    if (channels.length !== uniqueChannelIds.length) {
      const foundIds = new Set(channels.map((channel) => channel.id));
      const missingIds = uniqueChannelIds.filter((id) => !foundIds.has(id));
      throw new BadRequestError(`Relay channel not found or disabled: ${missingIds.join(", ")}`);
    }
  }

  private generateRelayTokenValue(): string {
    return "rlt_" + crypto.randomBytes(32).toString("hex");
  }

  private normalizeOptionalIpWhitelist(value?: string | null): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    const rawEntries = splitIpWhitelistEntries(value);
    if (rawEntries.length === 0) return null;

    for (const entry of rawEntries)
      if (!isValidIpWhitelistEntry(entry)) throw new BadRequestError(`Invalid ipWhitelist entry: ${entry}`);

    const normalizedEntries = normalizeIpWhitelistEntries(value);
    return normalizedEntries.length ? normalizedEntries.join("\n") : null;
  }
}
