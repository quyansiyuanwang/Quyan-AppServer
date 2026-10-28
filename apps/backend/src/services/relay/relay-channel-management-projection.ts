import type { RelayChannelManagementRecord } from "@/store/relay/relay-channel.store";
import type {
  RelayChannelManagementListItemDto,
  RelayChannelType,
  RelayChannelRoutingStrategy,
  RelayChannelVisibilityMode,
  RelayChannelSubmissionStatus,
} from "@/api/dto/relay/relay-channel.dto";
import type { PaginatedResponse } from "@/api/dto/common/common.dto";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
export const DEFAULT_CHANNEL_TYPE: RelayChannelType = "standalone";
export const DEFAULT_ROUTING_STRATEGY: RelayChannelRoutingStrategy = "priority";
export const DEFAULT_VISIBILITY_MODE: RelayChannelVisibilityMode = "public";
export const isProviderServiceEnabled = (channel: { providerServiceEnabled: boolean }): boolean =>
  channel.providerServiceEnabled !== false;
export const isChannelServiceEnabled = (channel: { status: number; providerServiceEnabled: boolean }): boolean =>
  channel.status === RELAY_CHANNEL_STATUS.ENABLED && isProviderServiceEnabled(channel);
export function projectRelayManagementChannels(
  records: readonly RelayChannelManagementRecord[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<RelayChannelManagementListItemDto> {
  return {
    items: records.map((channel) => {
      const providers = channel.providers ?? [];
      return {
        id: channel.id,
        name: channel.name,
        submittedByUserId: channel.submittedByUserId || undefined,
        submittedByUsername: channel.submittedBy?.username || channel.submittedByUserId || undefined,
        enabled: channel.status === RELAY_CHANNEL_STATUS.ENABLED,
        providerServiceEnabled: channel.providerServiceEnabled !== false,
        serviceEnabled: isChannelServiceEnabled(channel),
        channelType: (channel.channelType as RelayChannelType | undefined) ?? DEFAULT_CHANNEL_TYPE,
        routingStrategy:
          (channel.routingStrategy as RelayChannelRoutingStrategy | undefined) ?? DEFAULT_ROUTING_STRATEGY,
        visibilityMode: (channel.visibilityMode as RelayChannelVisibilityMode | undefined) ?? DEFAULT_VISIBILITY_MODE,
        poolMemberCount: new Set([
          ...channel.poolMembers.map((member) => member.memberChannelId),
          ...(channel.channelType === "pooled" ? channel.pooledChildren.map((member) => member.id) : []),
        ]).size,
        pooledParentId: channel.pooledParentId || undefined,
        pooledParentName: channel.pooledParent?.name,
        multiplier: Number(channel.multiplier),
        submissionStatus: (channel.submissionStatus as RelayChannelSubmissionStatus) || "approved",
        providerCount: providers.length,
        providerCommissionPercent: providers.reduce((total, provider) => total + Number(provider.commissionPercent), 0),
        updateTime: channel.updateTime,
      };
    }),
    total,
    page,
    pageSize,
  };
}
