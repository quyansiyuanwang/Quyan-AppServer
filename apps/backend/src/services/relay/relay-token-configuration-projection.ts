import type {
  RelayToken,
  RelayTokenMemberConfig,
  RelayTokenChannelConfig,
  RelayTokenQuotaWindow,
  RelayTokenFailoverConfig,
} from "@prisma/client";
import type { RelayTokenImportItemDto, CreateRelayTokenDto, RelayTokenQuotaUnit } from "@/api/dto/relay/relay.dto";
import type { RelayRequestFormatTransform } from "@quyan/shared";
import type { RelayTokenNormalizerConfig } from "@/util/anthropic-token-normalizer.util";
import { MANAGED_STATUS } from "@/constant/status";
import { normalizeRetryStatusRules } from "@/util/relay/relay-failover-status-rule.util";

/** Configuration-only source: credentials, ownership, usage and user/upstream details are not inputs. */
export type RelayTokenConfigurationProjectionSource = Pick<
  RelayToken,
  | "name"
  | "expiresAt"
  | "routingMode"
  | "automaticProxyPoolChannelId"
  | "blockedAutomaticProxyPoolChannelIds"
  | "channelId"
  | "quotaLimit"
  | "allowedModels"
  | "ipWhitelist"
  | "modelMapping"
  | "requestFormatTransforms"
  | "normalizerConfig"
  | "streamConfig"
  | "contentSafetyConfig"
  | "status"
> & {
  memberTokenConfigs?: Pick<RelayTokenMemberConfig, "tokenId" | "priority" | "enabled">[];
  channelConfigs: Pick<RelayTokenChannelConfig, "channelId" | "priority">[];
  quotaWindows: Pick<RelayTokenQuotaWindow, "quotaLimit" | "quotaUnit" | "quotaWindowHours">[];
  failoverConfig: Pick<
    RelayTokenFailoverConfig,
    | "enabled"
    | "maxRetries"
    | "retryStatusCodes"
    | "failoverThreshold"
    | "failbackCooldownMinutes"
    | "maxAcceptedChannelMultiplier"
    | "minCacheHitRate"
  > | null;
};
export interface RelayTokenConfigurationProjectionNormalizers {
  blockedChannelIds: (value: unknown) => string[];
  quotaUnit: (value: string | null | undefined) => RelayTokenQuotaUnit;
  requestFormatTransforms: (value: unknown) => RelayRequestFormatTransform[] | null;
  normalizerConfig: (value: unknown) => RelayTokenNormalizerConfig;
}
/** Shared export/copy field projection. Only the explicit export boundary may add a credential. */
export function projectRelayTokenConfiguration(
  token: RelayTokenConfigurationProjectionSource,
  normalizers: RelayTokenConfigurationProjectionNormalizers,
): Omit<RelayTokenImportItemDto, "token" | "targetUserId"> {
  return {
    name: token.name || undefined,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : undefined,
    routingMode:
      token.routingMode === "composite"
        ? "composite"
        : token.routingMode === "automatic-pool"
          ? "automatic-pool"
          : "ordered",
    memberTokenConfigs:
      token.routingMode === "composite"
        ? (token.memberTokenConfigs ?? []).map((member) => ({
            tokenId: member.tokenId,
            priority: member.priority,
            enabled: member.enabled,
          }))
        : undefined,
    automaticProxyPoolChannelId: token.automaticProxyPoolChannelId || undefined,
    blockedAutomaticProxyPoolChannelIds: normalizers.blockedChannelIds(token.blockedAutomaticProxyPoolChannelIds),
    channelId: token.channelId || token.channelConfigs[0]?.channelId || undefined,
    channelConfigs: token.channelConfigs.map((config) => ({
      channelId: config.channelId,
      priority: config.priority,
    })),
    failoverConfig: token.failoverConfig
      ? {
          enabled: Boolean(token.failoverConfig.enabled),
          maxRetries: Number(token.failoverConfig.maxRetries || 2),
          retryStatusCodes: normalizeRetryStatusRules(
            Array.isArray(token.failoverConfig.retryStatusCodes) ? token.failoverConfig.retryStatusCodes : [],
          ),
          failoverThreshold: Math.max(0, Number(token.failoverConfig.failoverThreshold ?? 0)),
          failbackCooldownMinutes: Math.max(0, Number(token.failoverConfig.failbackCooldownMinutes ?? 0)),
          maxAcceptedChannelMultiplier:
            token.failoverConfig.maxAcceptedChannelMultiplier == null
              ? null
              : Number(token.failoverConfig.maxAcceptedChannelMultiplier),
          minCacheHitRate:
            token.failoverConfig.minCacheHitRate == null ? null : Number(token.failoverConfig.minCacheHitRate),
        }
      : undefined,
    quotaLimit: token.quotaLimit != null ? Number(token.quotaLimit) : undefined,
    quotaWindows: Array.isArray(token.quotaWindows)
      ? token.quotaWindows.map((quotaWindow) => ({
          quotaLimit: Number(quotaWindow.quotaLimit),
          quotaUnit: normalizers.quotaUnit(quotaWindow.quotaUnit),
          quotaWindowHours: Number(quotaWindow.quotaWindowHours),
        }))
      : undefined,
    allowedModels: token.allowedModels || undefined,
    ipWhitelist: token.ipWhitelist || undefined,
    modelMapping: token.modelMapping as Record<string, string> | undefined,
    requestFormatTransforms: normalizers.requestFormatTransforms(token.requestFormatTransforms) ?? undefined,
    normalizerConfig: normalizers.normalizerConfig(token.normalizerConfig),
    streamConfig: token.streamConfig as CreateRelayTokenDto["streamConfig"],
    contentSafetyConfig: (token.contentSafetyConfig as RelayTokenImportItemDto["contentSafetyConfig"]) ?? null,
    enabled: token.status === MANAGED_STATUS.ENABLED,
  };
}
