import type { RelayChannelDto } from "@/api/dto/relay/relay-channel.dto";
import type { RelayChannelProbeCustomerFacingTargetDto } from "@/api/dto/relay/relay-channel-probe.dto";

export type RelayChannelProbeTopologyItem = Pick<
  RelayChannelDto,
  "id" | "name" | "enabled" | "channelType" | "poolMembers"
>;

/**
 * Converts internal standalone members to the routing entries a customer
 * actually sees. Visibility mode governs management access, not token routing,
 * so a pooled channel takes precedence regardless of that internal setting.
 */
export function resolveProbeCustomerFacingTargets(
  channels: RelayChannelProbeTopologyItem[],
  standaloneChannelId: string,
): RelayChannelProbeCustomerFacingTargetDto[] {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const targetById = new Map<string, RelayChannelProbeCustomerFacingTargetDto>();
  const requested = channelById.get(standaloneChannelId);
  if (requested?.enabled && requested.channelType === "pooled") {
    return [{ channelId: requested.id, channelName: requested.name }];
  }

  const collectStandaloneMembers = (channelId: string, path = new Set<string>()): string[] => {
    if (path.has(channelId)) return [];
    const channel = channelById.get(channelId);
    if (!channel?.enabled) return [];
    if (channel.channelType === "standalone") return [channel.id];

    const nextPath = new Set(path).add(channelId);
    return (channel.poolMembers ?? []).flatMap((member) => {
      if (member.enabled === false || member.memberChannelEnabled === false) return [];
      return collectStandaloneMembers(member.memberChannelId, nextPath);
    });
  };

  for (const channel of channels) {
    if (!channel.enabled || channel.channelType !== "pooled") continue;
    if (collectStandaloneMembers(channel.id).includes(standaloneChannelId)) {
      targetById.set(channel.id, { channelId: channel.id, channelName: channel.name });
    }
  }

  if (targetById.size === 0) {
    const standalone = channelById.get(standaloneChannelId);
    if (standalone?.enabled) {
      targetById.set(standalone.id, { channelId: standalone.id, channelName: standalone.name });
    }
  }

  return [...targetById.values()].sort((left, right) => left.channelName.localeCompare(right.channelName));
}
