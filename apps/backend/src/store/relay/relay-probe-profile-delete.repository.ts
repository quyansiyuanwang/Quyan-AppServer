import { Prisma, type RelayChannelProbeRun } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeRunArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { ConflictError, NotFoundError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget } from "./relay-probe-read-target";
export class RelayProbeProfileDeleteRepository {
  private static instance: RelayProbeProfileDeleteRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeProfileDeleteRepository());
  }
  async remove(channelId: string, guard: RelayProbeMutationContext) {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([platformRelayChannelArn(channelId)]);
        await relayProbeReadTarget(tx, channelId, undefined, visible);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM relay_channel_probe_profiles WHERE relayChannelId = ${channelId} FOR UPDATE`,
        );
        const profile = await tx.relayChannelProbeProfile.findUnique({
          where: { relayChannelId: channelId },
          select: { id: true, updateTime: true },
        });
        if (!profile)
          throw new NotFoundError("Probe profile not found", undefined, {
            messageKey: "relayChannelProbe.profileNotFound",
          });
        await authorize([platformRelayProbeProfileArn(channelId, profile.id)]);
        if (
          await tx.relayChannelProbeRun.findFirst({
            where: { relayChannelId: channelId, status: { in: ["queued", "running"] } },
            select: { id: true },
          })
        )
          throw new ConflictError("Active probe blocks profile deletion", undefined, {
            messageKey: "relayChannelProbe.activeProbeBlocksProfileReset",
          });
        let after: string | undefined;
        for (;;) {
          const targets = await tx.relayChannelProbeTargetConfig.findMany({
            where: { profileId: profile.id, ...(after ? { id: { gt: after } } : {}) },
            select: { id: true, targetChannelId: true, accountId: true },
            orderBy: { id: "asc" },
            take: limit,
          });
          if (!targets.length) break;
          let resources: string[];
          try {
            resources = [...new Set(targets.map((target) => target.targetChannelId))].map(platformRelayChannelArn);
          } catch {
            throw iamAccountDenied();
          }
          await authorize(resources);
          const accounts = [...new Set(targets.flatMap((target) => (target.accountId ? [target.accountId] : [])))];
          if (accounts.length) {
            const group = await platformManagementGroupSnapshot(
              principal,
              Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
              tx,
            );
            if (group.id !== snapshot.group.id || group.updateTime.getTime() !== snapshot.group.updateTime.getTime())
              throw iamAccountDenied();
            try {
              resources = accounts.map(platformRelayProbeAccountArn);
            } catch {
              throw iamAccountDenied();
            }
            await guard.authorizeAccountUnbind(resources);
          }
          after = targets[targets.length - 1]!.id;
          if (targets.length < limit) break;
        }
        after = undefined;
        for (;;) {
          const runs: Pick<RelayChannelProbeRun, "id" | "relayChannelId" | "probeMemberChannelId">[] =
            await tx.relayChannelProbeRun.findMany({
              where: { profileId: profile.id, ...(after ? { id: { gt: after } } : {}) },
              select: { id: true, relayChannelId: true, probeMemberChannelId: true },
              orderBy: { id: "asc" },
              take: limit,
            });
          if (!runs.length) break;
          if (runs.some((run) => run.relayChannelId !== channelId)) throw iamAccountDenied();
          await authorize(runs.map((run) => platformRelayProbeRunArn(channelId, run.id)));
          await authorize(
            [...new Set(runs.flatMap((run) => (run.probeMemberChannelId ? [run.probeMemberChannelId] : [])))].map(
              platformRelayChannelArn,
            ),
          );
          after = runs[runs.length - 1]!.id;
          if (runs.length < limit) break;
        }
        await recheck();
        if (
          persist &&
          (
            await tx.relayChannelProbeProfile.deleteMany({
              where: { id: profile.id, relayChannelId: channelId, updateTime: profile.updateTime },
            })
          ).count !== 1
        )
          throw iamAccountDenied();
      },
    );
  }
}
