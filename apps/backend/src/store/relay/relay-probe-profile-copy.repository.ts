import { Prisma } from "@prisma/client";
import { Permission, parseAllowedModelsJson, supportsRelayRequestFormat, type RelayRequestFormat } from "@quyan/shared";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeProfileTemplateSelect, copyProbeProfileSettings } from "./relay-probe-profile-template";
import { relayProbeProfileReadSelect, type RelayProbeProfileReadRecord } from "./relay-probe-profile-read.repository";
import { relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
/** One independently atomic copy. Source ciphertext is never hydrated, including in shadow mode. */
export class RelayProbeProfileCopyRepository {
  private static instance: RelayProbeProfileCopyRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeProfileCopyRepository());
  }
  async copy<T>(
    sourceId: string,
    targetId: string,
    reservedId: string,
    overwrite: boolean,
    guard: RelayProbeMutationContext,
    map: (record: RelayProbeProfileReadRecord) => T,
  ): Promise<T | undefined> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard;
    if (sourceId === targetId) throw iamAccountDenied();
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([platformRelayChannelArn(sourceId), platformRelayChannelArn(targetId)]);
        // Same total order as distributed locks; both source and target stay stable through commit.
        for (const id of [sourceId, targetId].sort())
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${id} FOR UPDATE`);
        const rows = await tx.relayChannel.findMany({
          where: { id: { in: [sourceId, targetId] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
          select: { id: true, channelType: true, visibilityMode: true, visibilityConfig: true },
        });
        const source = rows.find((row) => row.id === sourceId),
          target = rows.find((row) => row.id === targetId);
        if (!source || !target || !(await visible(source)) || !(await visible(target))) throw iamAccountDenied();
        if (source.channelType !== "standalone" || target.channelType !== "standalone")
          throw new BadRequestError("Profile copy requires standalone channels", undefined, {
            messageKey: "relayChannelProbe.pooledProfileCopyUnsupported",
          });
        const metadata = await tx.relayChannelProbeProfile.findMany({
          where: { relayChannelId: { in: [sourceId, targetId] } },
          select: { id: true, relayChannelId: true, updateTime: true },
        });
        const sourceProfile = metadata.find((row) => row.relayChannelId === sourceId),
          targetProfile = metadata.find((row) => row.relayChannelId === targetId);
        if (!sourceProfile)
          throw new NotFoundError("Source profile unavailable", undefined, {
            messageKey: "relayChannelProbe.sourceProfileNotFound",
          });
        const profileId = targetProfile?.id ?? reservedId;
        await authorize([
          platformRelayProbeProfileArn(sourceId, sourceProfile.id),
          platformRelayProbeProfileArn(targetId, profileId),
        ]);
        if (targetProfile && !overwrite)
          throw new ConflictError("Target profile already exists", undefined, { messageKey: "errors.conflict" });
        if (
          await tx.relayChannelProbeRun.count({
            where: { relayChannelId: targetId, status: { in: ["queued", "running"] } },
          })
        )
          throw new ConflictError("Target probe is active", undefined, {
            messageKey: "relayChannelProbe.probeAlreadyQueued",
          });
        if (targetProfile) {
          const bindings = await tx.relayChannelProbeTargetConfig.findMany({
            where: { profileId },
            select: { id: true, targetChannelId: true, accountId: true },
          });
          // A standalone profile cannot legitimately contain stale/foreign physical targets.
          if (bindings.some((row) => row.targetChannelId !== targetId)) throw iamAccountDenied();
          const accounts = [...new Set(bindings.flatMap((row) => (row.accountId ? [row.accountId] : [])))];
          if (accounts.length) {
            const group = await platformManagementGroupSnapshot(
              principal,
              Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
              tx,
            );
            if (group.id !== snapshot.group.id || group.updateTime.getTime() !== snapshot.group.updateTime.getTime())
              throw iamAccountDenied();
            await guard.authorizeBoundProfileEdit(accounts.map(platformRelayProbeAccountArn));
          }
        }
        await recheck();
        if (!persist) return undefined;
        const template = await tx.relayChannelProbeProfile.findUniqueOrThrow({
          where: { id: sourceProfile.id, updateTime: sourceProfile.updateTime },
          select: relayProbeProfileTemplateSelect,
        });
        const settings = await tx.relayChannel.findUniqueOrThrow({
          where: { id: targetId },
          select: { allowedFormats: true, allowedModels: true },
        });
        if (!supportsRelayRequestFormat(settings.allowedFormats, template.probeFormat as RelayRequestFormat))
          throw new BadRequestError("Target format unsupported", undefined, {
            messageKey: "relayChannelProbe.formatProbeUnsupported",
          });
        const models = parseAllowedModelsJson(settings.allowedModels) ?? [];
        if (models.length && !models.includes(template.probeModel))
          throw new BadRequestError("Target model unsupported", undefined, {
            messageKey: "relayChannelProbe.modelNotSupportedByChannel",
          });
        if (!(await relayProbeUpstreamConfigured(tx, targetId, template.probeFormat)))
          throw new BadRequestError("Target upstream unavailable", undefined, {
            messageKey: "relayChannelProbe.upstreamMissingForFormat",
          });
        const data = copyProbeProfileSettings(template);
        await recheck();
        const record = targetProfile
          ? await tx.relayChannelProbeProfile.update({
              where: { id: profileId, updateTime: targetProfile.updateTime },
              data,
              select: relayProbeProfileReadSelect,
            })
          : await tx.relayChannelProbeProfile.create({
              data: { ...data, id: profileId, relayChannelId: targetId },
              select: relayProbeProfileReadSelect,
            });
        if (record.id !== profileId || record.relayChannelId !== targetId) throw iamAccountDenied();
        return map(record);
      },
    );
  }
}
