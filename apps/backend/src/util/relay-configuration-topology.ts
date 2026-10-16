import { BadRequestError } from "./errors";
export interface RelayConfigurationTopologyChannel {
  id: string;
  name: string;
  channelType: string;
  pooledParentId: string | null;
  poolMembers?: readonly { memberChannelId?: string }[];
}
export interface RelayConfigurationTopologyIssue {
  code: string;
  channelId: string;
  channelName: string;
  message: string;
}
/** The report and strict-mode admission use the same topology invariants. */
export function relayConfigurationTopologyIssues(
  channels: readonly RelayConfigurationTopologyChannel[],
): RelayConfigurationTopologyIssue[] {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const issues: RelayConfigurationTopologyIssue[] = [];
  const add = (channel: RelayConfigurationTopologyChannel, code: string, message: string) =>
    issues.push({ code, channelId: channel.id, channelName: channel.name, message });
  for (const channel of channels) {
    const type = channel.channelType || "standalone";
    const legacyMembers = channel.poolMembers ?? [];
    if (type === "pooled" && legacyMembers.length)
      add(channel, "legacy_pool_members", `pooled '${channel.name}' still has legacy members`);
    if (type === "pooled-member") {
      const parent = channel.pooledParentId ? byId.get(channel.pooledParentId) : undefined;
      if (!parent || parent.channelType !== "pooled")
        add(channel, "invalid_pooled_parent", `pooled-member '${channel.name}' has no valid pooled parent`);
    } else if (channel.pooledParentId) {
      add(channel, "non_member_pooled_parent", `non-member '${channel.name}' has a pooled parent`);
    }
    if (type === "automatic-proxy-pool") {
      for (const member of legacyMembers) {
        const target = member.memberChannelId ? byId.get(member.memberChannelId) : undefined;
        if (!target || target.channelType !== "pooled")
          add(
            channel,
            "automatic_pool_physical_member",
            `automatic pool '${channel.name}' contains a non-logical-pool member`,
          );
      }
    }
  }
  return issues;
}
export function assertRelayConfigurationTopology(channels: readonly RelayConfigurationTopologyChannel[]): void {
  const issues = relayConfigurationTopologyIssues(channels);
  if (issues.length)
    throw new BadRequestError(
      `Strict two-tier topology audit failed: ${issues
        .slice(0, 10)
        .map((issue) => issue.message)
        .join("; ")}`,
      undefined,
      {
        messageKey: "relay.topologyAuditFailed",
        messageParams: { count: issues.length },
      },
    );
}
