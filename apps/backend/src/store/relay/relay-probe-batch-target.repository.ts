import { Permission } from "@quyan/shared";
import { RELAY_PROBE_BATCH_POLICY } from "@/constant/relay-probe";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { BadRequestError } from "@/util/errors";
/** Discover identifiers only. No profile workflow, upstream endpoints, API keys or credentials. */
export class RelayProbeBatchTargetRepository {
  private static instance: RelayProbeBatchTargetRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeBatchTargetRepository());
  }
  async expand(channelId: string, guard: RelayProbeMutationContext) {
    const { principal, snapshot, authorize, recheck, visible } = guard;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([platformRelayChannelArn(channelId)]);
        const channel = await tx.relayChannel.findFirst({
          where: { id: channelId, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
          select: { id: true, channelType: true, visibilityMode: true, visibilityConfig: true },
        });
        if (!channel || !(await visible(channel))) throw iamAccountDenied();
        if (channel.channelType === "standalone") return [{ channelId }];
        if (channel.channelType !== "pooled") throw iamAccountDenied();
        // Strict topology existence takes precedence even if every strict member is disabled/deleted/denied.
        const strict = await tx.relayChannel.count({ where: { pooledParentId: channelId } });
        const rows = await tx.relayChannel.findMany({
          where: {
            ...(strict
              ? { pooledParentId: channelId }
              : { memberOfPools: { some: { relayChannelId: channelId, enabled: true } } }),
            status: RELAY_CHANNEL_STATUS.ENABLED,
            providerServiceEnabled: true,
            pooledMemberEnabled: true,
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: RELAY_PROBE_BATCH_POLICY.targets + 1,
        });
        if (rows.length > RELAY_PROBE_BATCH_POLICY.targets)
          throw new BadRequestError("Probe expansion exceeds batch limit", undefined, {
            messageKey: "errors.badRequest",
          });
        const targets: Array<{ channelId: string; memberChannelId: string }> = [];
        for (const row of rows) {
          try {
            await authorize([platformRelayChannelArn(row.id)]);
          } catch {
            continue;
          }
          targets.push({ channelId, memberChannelId: row.id });
        }
        if (!targets.length) throw iamAccountDenied();
        return targets;
      },
    );
  }
}
