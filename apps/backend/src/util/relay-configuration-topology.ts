import { BadRequestError } from "./errors";
export interface RelayConfigurationTopologyChannel {
  id: string;
  name: string;
  channelType: string;
  pooledParentId: string | null;
  poolMembers?: readonly { memberChannelId?: string }[];
}
export function assertRelayConfigurationTopology(channels: readonly RelayConfigurationTopologyChannel[]): void {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const issues: string[] = [];
  for (const channel of channels) {
    const type = channel.channelType || "standalone";
    const legacyMembers = channel.poolMembers ?? [];
    if (type === "pooled" && legacyMembers.length) issues.push(`pooled '${channel.name}' still has legacy members`);
    if (type === "pooled-member") {
      const parent = channel.pooledParentId ? byId.get(channel.pooledParentId) : undefined;
      if (!parent || parent.channelType !== "pooled")
        issues.push(`pooled-member '${channel.name}' has no valid pooled parent`);
    } else if (channel.pooledParentId) {
      issues.push(`non-member '${channel.name}' has a pooled parent`);
    }
    if (type === "automatic-proxy-pool") {
      for (const member of legacyMembers) {
        const target = member.memberChannelId ? byId.get(member.memberChannelId) : undefined;
        if (!target || target.channelType !== "pooled")
          issues.push(`automatic pool '${channel.name}' contains a non-logical-pool member`);
      }
    }
  }
  if (issues.length)
    throw new BadRequestError(`Strict two-tier topology audit failed: ${issues.slice(0, 10).join("; ")}`, undefined, {
      messageKey: "relay.topologyAuditFailed",
      messageParams: { count: issues.length },
    });
}
