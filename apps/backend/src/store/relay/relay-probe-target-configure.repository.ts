import { Prisma } from "@prisma/client";
import { Permission, parseAllowedModelsJson, supportsRelayRequestFormat, type RelayRequestFormat } from "@quyan/shared";
import type {
  ConfigureRelayChannelProbeTargetsRequest,
  RelayChannelProbeTargetConfigDto,
} from "@/api/dto/relay/relay-channel-probe.dto";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget, relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import { relayProbeProfileTemplateSelect, copyProbeProfileSettings } from "./relay-probe-profile-template";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
/** Target settings and optional shareable profile creation commit together. No credential projection. */
export class RelayProbeTargetConfigureRepository {
  private static instance: RelayProbeTargetConfigureRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeTargetConfigureRepository());
  }
  async configure(
    target: ConfigureRelayChannelProbeTargetsRequest["targets"][number],
    sourceId: string | undefined,
    reservedId: string,
    overwrite: boolean,
    guard: RelayProbeMutationContext,
  ): Promise<RelayChannelProbeTargetConfigDto | undefined> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard,
      { channelId, memberChannelId } = target,
      physicalId = memberChannelId ?? channelId,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([
          platformRelayChannelArn(channelId),
          ...(memberChannelId ? [platformRelayChannelArn(memberChannelId)] : []),
          ...(sourceId ? [platformRelayChannelArn(sourceId)] : []),
        ]);
        for (const id of [...new Set([channelId, ...(sourceId ? [sourceId] : [])])].sort())
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${id} FOR UPDATE`);
        const { channel, members } = await relayProbeReadTarget(tx, channelId, memberChannelId, visible);
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
        if (sourceId && sourceId !== channelId) {
          const source = await tx.relayChannel.findFirst({
            where: { id: sourceId, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
            select: { id: true, visibilityMode: true, visibilityConfig: true, channelType: true },
          });
          if (!source || !["standalone", "pooled"].includes(source.channelType) || !(await visible(source)))
            throw iamAccountDenied();
        }
        const profiles = await tx.relayChannelProbeProfile.findMany({
          where: { relayChannelId: { in: [channelId, ...(sourceId ? [sourceId] : [])] } },
          select: { id: true, relayChannelId: true, updateTime: true },
        });
        const previous = profiles.find((row) => row.relayChannelId === channelId),
          source = sourceId ? profiles.find((row) => row.relayChannelId === sourceId) : undefined;
        if (sourceId && !source)
          throw new NotFoundError("Source profile unavailable", undefined, {
            messageKey: "relayChannelProbe.sourceProfileNotFound",
          });
        if (!previous && !source)
          throw new BadRequestError("Configure a template first", undefined, {
            messageKey: "relayChannelProbe.targetProfileRequired",
          });
        const profileId = previous?.id ?? reservedId,
          replaceProfile = Boolean(source && sourceId !== channelId && (!previous || overwrite));
        await authorize([
          platformRelayProbeProfileArn(channelId, profileId),
          ...(source ? [platformRelayProbeProfileArn(sourceId!, source.id)] : []),
        ]);
        if (
          await tx.relayChannelProbeRun.count({
            where: { relayChannelId: channelId, status: { in: ["queued", "running"] } },
          })
        )
          throw new ConflictError("Probe is active", undefined, { messageKey: "relayChannelProbe.probeAlreadyQueued" });
        const accounts = new Set<string>();
        if (previous) {
          // Replacing shared settings affects every configured/current target, not just the first requested member.
          if (replaceProfile) {
            const allMembers = [...members];
            for (let offset = 0; offset < allMembers.length; offset += limit)
              await authorize(allMembers.slice(offset, offset + limit).map(platformRelayChannelArn));
          }
          let after: string | undefined;
          for (;;) {
            const bindings: { id: string; targetChannelId: string; accountId: string | null }[] =
              await tx.relayChannelProbeTargetConfig.findMany({
                where: {
                  profileId,
                  ...(!replaceProfile ? { targetChannelId: physicalId } : {}),
                  ...(after ? { id: { gt: after } } : {}),
                },
                select: { id: true, targetChannelId: true, accountId: true },
                orderBy: { id: "asc" },
                take: limit,
              });
            if (!bindings.length) break;
            if (
              bindings.some((row) =>
                channel.channelType === "pooled"
                  ? !members.has(row.targetChannelId)
                  : row.targetChannelId !== channelId,
              )
            )
              throw iamAccountDenied();
            await authorize([...new Set(bindings.map((row) => row.targetChannelId))].map(platformRelayChannelArn));
            bindings.forEach((row) => {
              if (row.accountId) accounts.add(row.accountId);
            });
            after = bindings[bindings.length - 1]!.id;
            if (bindings.length < limit) break;
          }
        }
        if (accounts.size) {
          const group = await platformManagementGroupSnapshot(
            principal,
            Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
            tx,
          );
          if (group.id !== snapshot.group.id || group.updateTime.getTime() !== snapshot.group.updateTime.getTime())
            throw iamAccountDenied();
          const all = [...accounts];
          for (let offset = 0; offset < all.length; offset += limit)
            await guard.authorizeBoundProfileEdit(all.slice(offset, offset + limit).map(platformRelayProbeAccountArn));
        }
        await recheck();
        if (!persist) return undefined;
        const templateIdentity = replaceProfile ? source! : previous!;
        const template = await tx.relayChannelProbeProfile.findUniqueOrThrow({
          where: { id: templateIdentity.id, updateTime: templateIdentity.updateTime },
          select: relayProbeProfileTemplateSelect,
        });
        const format = target.probeFormat ?? template.probeFormat,
          model = target.probeModel ?? template.probeModel;
        if (format !== template.probeFormat && target.probePayload === undefined)
          throw new BadRequestError("Format changes require payload", undefined, {
            messageKey: "relayChannelProbe.formatChangeRequiresPayload",
          });
        const settings = await tx.relayChannel.findUniqueOrThrow({
          where: { id: physicalId },
          select: { allowedFormats: true, allowedModels: true },
        });
        if (!supportsRelayRequestFormat(settings.allowedFormats, format as RelayRequestFormat))
          throw new BadRequestError("Unsupported format", undefined, {
            messageKey: "relayChannelProbe.formatProbeUnsupported",
          });
        const models = parseAllowedModelsJson(settings.allowedModels) ?? [];
        if (models.length && !models.includes(model))
          throw new BadRequestError("Unsupported model", undefined, {
            messageKey: "relayChannelProbe.modelNotSupportedByChannel",
          });
        if (!(await relayProbeUpstreamConfigured(tx, physicalId, format)))
          throw new BadRequestError("Missing upstream", undefined, {
            messageKey: "relayChannelProbe.upstreamMissingForFormat",
          });
        if (replaceProfile) {
          const data = copyProbeProfileSettings(template);
          if (previous)
            await tx.relayChannelProbeProfile.update({
              where: { id: profileId, updateTime: previous.updateTime },
              data,
              select: { id: true },
            });
          else
            await tx.relayChannelProbeProfile.create({
              data: { ...data, id: profileId, relayChannelId: channelId },
              select: { id: true },
            });
        }
        await recheck();
        const data = {
          ...(target.probeFormat !== undefined ? { probeFormat: target.probeFormat } : {}),
          ...(target.probeModel !== undefined ? { probeModel: target.probeModel } : {}),
          ...(target.probePayload !== undefined ? { probePayload: target.probePayload as Prisma.InputJsonValue } : {}),
          ...(target.probeGroup !== undefined ? { probeGroup: target.probeGroup.trim() } : {}),
        };
        const record = await tx.relayChannelProbeTargetConfig.upsert({
          where: { profileId_targetChannelId: { profileId, targetChannelId: physicalId } },
          create: { profileId, targetChannelId: physicalId, ...data },
          update: data,
          select: {
            id: true,
            profileId: true,
            targetChannelId: true,
            probeFormat: true,
            probeModel: true,
            probePayload: true,
            probeGroup: true,
          },
        });
        if (record.profileId !== profileId || record.targetChannelId !== physicalId) throw iamAccountDenied();
        return {
          channelId,
          ...(memberChannelId ? { memberChannelId } : {}),
          ...(record.probeFormat ? { probeFormat: record.probeFormat as RelayRequestFormat } : {}),
          ...(record.probeModel ? { probeModel: record.probeModel } : {}),
          ...(record.probePayload ? { probePayload: record.probePayload as Record<string, unknown> } : {}),
          ...(record.probeGroup !== null ? { probeGroup: record.probeGroup } : {}),
        };
      },
    );
  }
}
