import type { RelayChannel, Prisma } from "@prisma/client";
import type {
  RelayChannelDto,
  RelayChannelMemberDto,
  RelayChannelProviderDto,
  RelayChannelRoutingConfigDto,
  RelayChannelVisibilityConfigDto,
  TimePeriodMultiplierRule,
  ContextLengthMultiplierRule,
} from "@/api/dto/relay/relay-channel.dto";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { resolveEffectiveRelayPoolMembers } from "./utils/relay-pool-members.util";
import {
  DEFAULT_CHANNEL_TYPE,
  DEFAULT_ROUTING_STRATEGY,
  DEFAULT_VISIBILITY_MODE,
  isChannelServiceEnabled,
} from "./relay-channel-management-projection";
export type RelayChannelConfigurationMember = Pick<
  RelayChannel,
  | "id"
  | "name"
  | "channelType"
  | "status"
  | "providerServiceEnabled"
  | "pooledPriority"
  | "pooledWeight"
  | "pooledMemberEnabled"
>;
export type RelayChannelConfigurationSource = Pick<
  RelayChannel,
  | "id"
  | "name"
  | "status"
  | "providerServiceEnabled"
  | "channelType"
  | "routingStrategy"
  | "routingConfig"
  | "visibilityMode"
  | "visibilityConfig"
  | "pooledParentId"
  | "pooledPriority"
  | "pooledWeight"
  | "pooledMemberEnabled"
  | "openaiUpstreamUrl"
  | "anthropicUpstreamUrl"
  | "geminiUpstreamUrl"
  | "useProxy"
  | "multiplier"
  | "allowedFormats"
  | "allowedModels"
  | "addUserIdentifier"
  | "inputTokensIncludeCacheRead"
  | "modelMapping"
  | "timePeriodMultipliers"
  | "contextLengthMultipliers"
  | "submissionStatus"
  | "submittedByUserId"
  | "reviewedAt"
  | "reviewReason"
  | "createTime"
  | "updateTime"
> & {
  pooledParent?: { name: string } | null;
  poolMembers?: {
    memberChannelId: string;
    priority: number;
    weight: Prisma.Decimal | number;
    enabled: boolean;
    memberChannel?: RelayChannelConfigurationMember | null;
  }[];
  pooledChildren?: RelayChannelConfigurationMember[];
  submittedBy?: { username: string } | null;
  providers?: {
    id: string;
    userId: string;
    commissionPercent: Prisma.Decimal | number;
    settlementMode: RelayChannelProviderDto["settlementMode"];
    settlementIntervalDays: number | null;
    settlementTime: string | null;
    nextSettlementAt: Date | null;
    user?: { username: string } | null;
  }[];
};
export type RelayChannelCredentialPresence = Pick<
  RelayChannelDto,
  "hasOpenaiUpstreamApiKey" | "hasAnthropicUpstreamApiKey" | "hasGeminiUpstreamApiKey"
>;
/** Payload projection requires no credentials, rich user record, catalog or hidden graph traversal.
 * Related configuration must already be admitted by the caller; capability resolution is a separate boundary.
 */
export function projectRelayChannelConfiguration(
  channel: RelayChannelConfigurationSource,
  presence: RelayChannelCredentialPresence,
): RelayChannelDto {
  const poolMembers = resolveEffectiveRelayPoolMembers<RelayChannelConfigurationMember>(channel).map(
    (member): RelayChannelMemberDto => ({
      memberChannelId: member.memberChannelId,
      priority: member.priority,
      weight: Number(member.weight),
      enabled: member.enabled,
      memberChannelName: member.memberChannel?.name,
      memberChannelType: member.memberChannel?.channelType as RelayChannelDto["channelType"] | undefined,
      memberChannelEnabled: member.memberChannel ? isChannelServiceEnabled(member.memberChannel) : false,
    }),
  );

  return {
    id: channel.id,
    name: channel.name,
    enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
    providerServiceEnabled: channel.providerServiceEnabled !== false,
    serviceEnabled: isChannelServiceEnabled(channel),
    openaiUpstreamUrl: channel.openaiUpstreamUrl || undefined,
    hasOpenaiUpstreamApiKey: presence.hasOpenaiUpstreamApiKey,
    anthropicUpstreamUrl: channel.anthropicUpstreamUrl || undefined,
    hasAnthropicUpstreamApiKey: presence.hasAnthropicUpstreamApiKey,
    geminiUpstreamUrl: channel.geminiUpstreamUrl || undefined,
    hasGeminiUpstreamApiKey: presence.hasGeminiUpstreamApiKey,
    useProxy: channel.useProxy === true,
    multiplier: Number(channel.multiplier),
    allowedFormats: channel.allowedFormats || "openai-chat-completions,anthropic,gemini",
    allowedModels: [],
    configuredAllowedModels: channel.allowedModels || undefined,
    addUserIdentifier: channel.addUserIdentifier !== false, // Default to true
    inputTokensIncludeCacheRead: channel.inputTokensIncludeCacheRead === true, // Default to false
    modelMapping: channel.modelMapping as Record<string, string> | undefined,
    timePeriodMultipliers: channel.timePeriodMultipliers as unknown as TimePeriodMultiplierRule[] | undefined,
    contextLengthMultipliers: channel.contextLengthMultipliers as unknown as ContextLengthMultiplierRule[] | undefined,
    channelType: (channel.channelType as RelayChannelDto["channelType"] | undefined) ?? DEFAULT_CHANNEL_TYPE,
    routingStrategy:
      (channel.routingStrategy as RelayChannelDto["routingStrategy"] | undefined) ?? DEFAULT_ROUTING_STRATEGY,
    routingConfig: channel.routingConfig as RelayChannelRoutingConfigDto | undefined,
    visibilityMode:
      (channel.visibilityMode as RelayChannelDto["visibilityMode"] | undefined) ?? DEFAULT_VISIBILITY_MODE,
    visibilityConfig: channel.visibilityConfig as RelayChannelVisibilityConfigDto | undefined,
    poolMembers,
    pooledParentId: channel.pooledParentId || undefined,
    pooledParentName: channel.pooledParent?.name,
    pooledPriority: channel.pooledPriority,
    pooledWeight: Number(channel.pooledWeight),
    pooledMemberEnabled: channel.pooledMemberEnabled,
    submissionStatus: (channel.submissionStatus as RelayChannelDto["submissionStatus"]) || "approved",
    submittedByUserId: channel.submittedByUserId || undefined,
    submittedByUsername: channel.submittedBy?.username,
    reviewedAt: channel.reviewedAt || undefined,
    reviewReason: channel.reviewReason || undefined,
    providers:
      channel.providers?.map((provider) => ({
        id: provider.id,
        userId: provider.userId,
        username: provider.user?.username || provider.userId,
        commissionPercent: Number(provider.commissionPercent),
        settlementMode: provider.settlementMode,
        settlementIntervalDays: provider.settlementIntervalDays ?? undefined,
        settlementTime: provider.settlementTime ?? undefined,
        nextSettlementAt: provider.nextSettlementAt ?? undefined,
      })) ?? [],
    createTime: channel.createTime,
    updateTime: channel.updateTime,
  };
}
