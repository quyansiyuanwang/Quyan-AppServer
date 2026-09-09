import type { RelayChannel } from "@prisma/client";
import type {
  RelayAttemptPlan,
  RelayFailoverRuntimeConfig,
  RelayTokenAvailabilityInput,
} from "./types/relay-proxy.types";
import type {
  RelayPoolMemberGraph,
  RelayPoolMemberOrderContext,
  RelayResolvedChannelCandidate,
} from "./relay-pool-resolver.service";

export interface RelayAttemptPlannerHost {
  getTopLevelAttemptChannels(token: RelayTokenAvailabilityInput): RelayChannel[];
  resolveActiveLeafCandidates(
    channels: RelayChannel[],
    orderMembers: (
      pool: RelayChannel,
      members: RelayPoolMemberGraph[],
      context?: RelayPoolMemberOrderContext,
    ) => Promise<RelayPoolMemberGraph[]>,
  ): Promise<RelayResolvedChannelCandidate[]>;
  orderPooledMemberChannels(
    pool: RelayChannel,
    members: RelayPoolMemberGraph[],
    context?: RelayPoolMemberOrderContext,
  ): Promise<RelayPoolMemberGraph[]>;
  getFailoverRuntimeConfig(token: RelayTokenAvailabilityInput): RelayFailoverRuntimeConfig;
  getPoolFailoverRuntimeConfig(channel: RelayChannel, poolSize: number): RelayFailoverRuntimeConfig;
  isPriceFirstAutomaticPool(channel: RelayChannel | undefined): boolean;
}

export interface BuildAttemptPlanParams {
  relayToken: RelayTokenAvailabilityInput;
}

export class RelayAttemptPlannerService {
  constructor(private readonly host: RelayAttemptPlannerHost) {}

  async build(params: BuildAttemptPlanParams): Promise<RelayAttemptPlan> {
    const relayToken = params.relayToken;
    const topLevelChannels = this.host.getTopLevelAttemptChannels(relayToken);
    const resolvedChannels = await this.host.resolveActiveLeafCandidates(topLevelChannels, (pool, members, context) =>
      this.host.orderPooledMemberChannels(pool, members, context),
    );
    const blockedChannelIds = new Set(
      Array.isArray(relayToken.blockedAutomaticProxyPoolChannelIds)
        ? relayToken.blockedAutomaticProxyPoolChannelIds.reduce<string[]>((ids, channelId) => {
            if (typeof channelId !== "string") return ids;
            const normalizedChannelId = channelId.trim();
            if (normalizedChannelId) ids.push(normalizedChannelId);
            return ids;
          }, [])
        : [],
    );
    const channels = blockedChannelIds.size
      ? resolvedChannels.filter(
          (candidate) => !blockedChannelIds.has((candidate.billingChannel ?? candidate.resolvedChannel).id),
        )
      : resolvedChannels;
    const tokenFailoverConfig = this.host.getFailoverRuntimeConfig(relayToken);
    const singleTopLevelChannel = topLevelChannels.length === 1 ? topLevelChannels[0] : undefined;
    if (singleTopLevelChannel?.channelType === "automatic-proxy-pool") {
      return {
        channels,
        failoverConfig: {
          ...this.host.getPoolFailoverRuntimeConfig(singleTopLevelChannel, channels.length),
          ...(tokenFailoverConfig.maxAcceptedChannelMultiplier == null
            ? {}
            : { maxAcceptedChannelMultiplier: tokenFailoverConfig.maxAcceptedChannelMultiplier }),
        },
        allowStickyFailover: !this.host.isPriceFirstAutomaticPool(singleTopLevelChannel),
      };
    }
    if (tokenFailoverConfig.enabled || !singleTopLevelChannel || singleTopLevelChannel.channelType !== "pooled")
      return {
        channels,
        failoverConfig: tokenFailoverConfig,
        allowStickyFailover: !this.host.isPriceFirstAutomaticPool(singleTopLevelChannel),
      };
    return {
      channels,
      failoverConfig: this.host.getPoolFailoverRuntimeConfig(singleTopLevelChannel, channels.length),
      allowStickyFailover: !this.host.isPriceFirstAutomaticPool(singleTopLevelChannel),
    };
  }
}
