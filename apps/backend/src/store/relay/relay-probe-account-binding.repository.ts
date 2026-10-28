import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import type {
  BindRelayChannelProbeAccountsRequest,
  RelayChannelProbeTargetConfigDto,
} from "@/api/dto/relay/relay-channel-probe.dto";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget } from "./relay-probe-read-target";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
/** Authorization and metadata only: binding never hydrates login ciphertext or tokens. */
export class RelayProbeAccountBindingRepository {
  private static instance: RelayProbeAccountBindingRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeAccountBindingRepository());
  }
  async bind(
    target: BindRelayChannelProbeAccountsRequest["targets"][number],
    guard: RelayProbeMutationContext,
  ): Promise<RelayChannelProbeTargetConfigDto | undefined> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        const { channelId, memberChannelId, accountId } = target,
          physicalId = memberChannelId ?? channelId;
        await authorize([
          platformRelayChannelArn(channelId),
          ...(memberChannelId ? [platformRelayChannelArn(memberChannelId)] : []),
        ]);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${channelId} FOR UPDATE`);
        const { channel } = await relayProbeReadTarget(tx, channelId, memberChannelId, visible);
        if (
          channel.channelType === "pooled"
            ? !memberChannelId
            : channel.channelType !== "standalone" || Boolean(memberChannelId)
        )
          throw iamAccountDenied();
        if (
          memberChannelId &&
          !(await tx.relayChannel.count({ where: { pooledParentId: channelId } })) &&
          !(await tx.relayChannelMember.count({ where: { relayChannelId: channelId, memberChannelId, enabled: true } }))
        )
          throw iamAccountDenied();
        const profile = await tx.relayChannelProbeProfile.findUnique({
          where: { relayChannelId: channelId },
          select: { id: true },
        });
        if (!profile)
          throw new BadRequestError("Probe profile required", undefined, {
            messageKey: "relayChannelProbe.targetProfileRequired",
          });
        await authorize([platformRelayProbeProfileArn(channelId, profile.id)]);
        if (
          await tx.relayChannelProbeRun.count({
            where: { relayChannelId: channelId, status: { in: ["queued", "running"] } },
          })
        )
          throw new ConflictError("Cannot change an active probe binding", undefined, {
            messageKey: "relayChannelProbe.probeAlreadyQueued",
          });
        const previous = await tx.relayChannelProbeTargetConfig.findUnique({
          where: { profileId_targetChannelId: { profileId: profile.id, targetChannelId: physicalId } },
          select: { id: true, accountId: true },
        });
        if (previous?.accountId && previous.accountId !== accountId)
          await guard.authorizeAccountUnbind([platformRelayProbeAccountArn(previous.accountId)]);
        if (accountId) await authorize([platformRelayProbeAccountArn(accountId)]);
        // Bind/delete/update use the same SQL account lock; never select credential values.
        for (const id of [
          ...new Set([previous?.accountId, accountId].filter((id): id is string => Boolean(id))),
        ].sort()) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channel_probe_accounts WHERE id = ${id} FOR UPDATE`);
          if (!(await tx.relayChannelProbeAccount.findUnique({ where: { id }, select: { id: true } })))
            throw new NotFoundError("Probe account unavailable", undefined, {
              messageKey: "relayChannelProbe.accountNotFound",
            });
        }
        await recheck();
        if (!persist) return undefined;
        const record = await tx.relayChannelProbeTargetConfig.upsert({
          where: { profileId_targetChannelId: { profileId: profile.id, targetChannelId: physicalId } },
          create: { profileId: profile.id, targetChannelId: physicalId, accountId },
          update: { accountId },
          select: { id: true, profileId: true, targetChannelId: true, accountId: true },
        });
        if (record.profileId !== profile.id || record.targetChannelId !== physicalId || record.accountId !== accountId)
          throw iamAccountDenied();
        return { channelId, ...(memberChannelId ? { memberChannelId } : {}), ...(accountId ? { accountId } : {}) };
      },
    );
  }
}
