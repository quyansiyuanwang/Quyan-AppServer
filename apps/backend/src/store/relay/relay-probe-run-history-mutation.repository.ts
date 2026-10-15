import { Permission } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget } from "./relay-probe-read-target";
import { relayProbeHistoryTerminalStatuses } from "./relay-probe-run-history-policy";
export class RelayProbeRunHistoryMutationRepository {
  private static instance: RelayProbeRunHistoryMutationRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunHistoryMutationRepository());
  }
  async clear(
    channelId: string,
    scope: "all" | "failed",
    memberChannelId: string | undefined,
    guard: RelayProbeMutationContext,
  ) {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([channelId, ...(memberChannelId ? [memberChannelId] : [])].map(platformRelayChannelArn));
        const { members } = await relayProbeReadTarget(tx, channelId, memberChannelId, visible),
          statuses = relayProbeHistoryTerminalStatuses[scope];
        let after: string | undefined;
        const admitted: { id: string; updateTime: Date }[] = [];
        for (;;) {
          const rows = await tx.relayChannelProbeRun.findMany({
            where: {
              relayChannelId: channelId,
              status: { in: [...statuses] },
              ...(memberChannelId ? { probeMemberChannelId: memberChannelId } : {}),
              ...(after ? { id: { gt: after } } : {}),
            },
            select: { id: true, probeMemberChannelId: true, updateTime: true },
            orderBy: { id: "asc" },
            take: limit,
          });
          if (!rows.length) break;
          if (rows.some((row) => row.probeMemberChannelId && !members.has(row.probeMemberChannelId)))
            throw iamAccountDenied();
          const memberIds = [
            ...new Set(rows.flatMap((row) => (row.probeMemberChannelId ? [row.probeMemberChannelId] : []))),
          ];
          await authorize(memberIds.map(platformRelayChannelArn));
          await authorize(rows.map((row) => platformRelayProbeRunArn(channelId, row.id)));
          admitted.push(...rows);
          after = rows[rows.length - 1]!.id;
          if (rows.length < limit) break;
        }
        await recheck();
        if (persist)
          for (let offset = 0; offset < admitted.length; offset += limit) {
            const batch = admitted.slice(offset, offset + limit),
              result = await tx.relayChannelProbeRun.deleteMany({
                where: {
                  relayChannelId: channelId,
                  status: { in: [...statuses] },
                  OR: batch.map((row) => ({ id: row.id, updateTime: row.updateTime })),
                },
              });
            if (result.count !== batch.length) throw iamAccountDenied();
          }
        return { deleted: admitted.length };
      },
    );
  }
}
