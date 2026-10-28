import { Prisma } from "@prisma/client";
import { Permission, parseAllowedModelsJson, supportsRelayRequestFormat, type RelayRequestFormat } from "@quyan/shared";
import type { CreateRelayChannelProbeRunRequest } from "@/api/dto/relay/relay-channel-probe.dto";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeRunArn,
  platformRelayProbeQueueSlotArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError, NotFoundError } from "@/util/errors";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget, relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import { relayProbeRunPublicSelect, type RelayProbeRunPublicRecord } from "./relay-probe-run-public-select";
const schedulingSelect = {
  id: true,
  relayChannelId: true,
  enabled: true,
  probeFormat: true,
  probeModel: true,
  probeEndpoint: true,
  distributionMultiplier: true,
  cacheMode: true,
  sampleCount: true,
  strictCalibrationValidation: true,
  measurementInputTokens: true,
  balanceSettlementTolerance: true,
  balanceSettlementReads: true,
  updateTime: true,
} as const satisfies Prisma.RelayChannelProbeProfileSelect;
export interface RelayProbeRunAdmissionTarget {
  profileId: string;
  profileUpdatedAt: string;
  targetConfigId: string | null;
  targetConfigUpdatedAt: string | null;
  accountId: string | null;
}
export class RelayProbeRunCreateRepository {
  private static instance: RelayProbeRunCreateRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunCreateRepository());
  }
  async create(
    channelId: string,
    runId: string,
    body: CreateRelayChannelProbeRunRequest,
    guard: RelayProbeMutationContext,
    endpoint: (format: string, previous: string, override: boolean) => string,
    reserve: (target: RelayProbeRunAdmissionTarget) => Promise<void>,
  ): Promise<RelayProbeRunPublicRecord | undefined> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([
          platformRelayChannelArn(channelId),
          platformRelayProbeRunArn(channelId, runId),
          platformRelayProbeQueueSlotArn(channelId, body.memberChannelId),
        ]);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${channelId} FOR UPDATE`);
        const { channel } = await relayProbeReadTarget(tx, channelId, body.memberChannelId, visible);
        if (!["standalone", "pooled"].includes(channel.channelType))
          throw new BadRequestError("Unsupported probe channel", undefined, {
            messageKey: "relayChannelProbe.balanceProbeScopeInvalid",
          });
        if (channel.channelType === "pooled" && !body.memberChannelId)
          throw new BadRequestError("Missing probe member", undefined, {
            messageKey: "relayChannelProbe.pooledProbeMemberRequired",
          });
        if (channel.channelType !== "pooled" && body.memberChannelId) throw iamAccountDenied();
        if (body.memberChannelId) await authorize([platformRelayChannelArn(body.memberChannelId)]);
        const targetId = body.memberChannelId ?? channelId;
        const target = await tx.relayChannel.findUniqueOrThrow({
          where: { id: targetId },
          select: {
            id: true,
            name: true,
            status: true,
            providerServiceEnabled: true,
            pooledMemberEnabled: true,
            allowedFormats: true,
            allowedModels: true,
          },
        });
        if (
          target.status !== RELAY_CHANNEL_STATUS.ENABLED ||
          target.providerServiceEnabled === false ||
          target.pooledMemberEnabled === false
        )
          throw new BadRequestError("Probe member unavailable", undefined, {
            messageKey: "relayChannelProbe.pooledMemberUnavailable",
          });
        if (
          body.memberChannelId &&
          !(await tx.relayChannel.count({ where: { pooledParentId: channelId } })) &&
          !(await tx.relayChannelMember.count({
            where: { relayChannelId: channelId, memberChannelId: body.memberChannelId, enabled: true },
          }))
        )
          throw iamAccountDenied();
        const metadata = await tx.relayChannelProbeProfile.findUnique({
          where: { relayChannelId: channelId },
          select: { id: true, updateTime: true },
        });
        if (!metadata)
          throw new NotFoundError("Probe profile missing", undefined, {
            messageKey: "relayChannelProbe.profileNotFound",
          });
        await authorize([platformRelayProbeProfileArn(channelId, metadata.id)]);
        const identity = await tx.relayChannelProbeTargetConfig.findUnique({
          where: { profileId_targetChannelId: { profileId: metadata.id, targetChannelId: targetId } },
          select: { id: true, accountId: true, updateTime: true },
        });
        if (identity?.accountId) await authorize([platformRelayProbeAccountArn(identity.accountId)]);
        const profile = await tx.relayChannelProbeProfile.findUniqueOrThrow({
          where: { id: metadata.id },
          select: schedulingSelect,
        });
        const config = identity
          ? await tx.relayChannelProbeTargetConfig.findUniqueOrThrow({
              where: { id: identity.id },
              select: { probeFormat: true, probeModel: true },
            })
          : undefined;
        if (!profile.enabled)
          throw new BadRequestError("Probe disabled", undefined, { messageKey: "relayChannelProbe.probeDisabled" });
        if (profile.relayChannelId !== channelId || profile.updateTime.getTime() !== metadata.updateTime.getTime())
          throw iamAccountDenied();
        const format = config?.probeFormat ?? profile.probeFormat,
          model = config?.probeModel ?? profile.probeModel;
        if (!supportsRelayRequestFormat(target.allowedFormats, format as RelayRequestFormat))
          throw new BadRequestError("Unsupported probe format", undefined, {
            messageKey: "relayChannelProbe.formatProbeUnsupported",
          });
        const models = parseAllowedModelsJson(target.allowedModels) ?? [];
        if (models.length && !models.includes(model))
          throw new BadRequestError("Unsupported probe model", undefined, {
            messageKey: "relayChannelProbe.modelNotSupportedByChannel",
          });
        if (!(await relayProbeUpstreamConfigured(tx, targetId, format)))
          throw new BadRequestError("Missing upstream settings", undefined, {
            messageKey: "relayChannelProbe.upstreamMissingForFormat",
          });
        if (
          await tx.relayChannelProbeRun.count({
            where: {
              relayChannelId: channelId,
              probeMemberChannelId: body.memberChannelId ?? null,
              status: { in: ["queued", "running"] },
            },
          })
        )
          throw new ConflictError("Probe already queued", undefined, {
            messageKey: "relayChannelProbe.probeAlreadyQueued",
          });
        await recheck();
        if (!persist) return undefined;
        await reserve({
          profileId: profile.id,
          profileUpdatedAt: profile.updateTime.toISOString(),
          targetConfigId: identity?.id ?? null,
          targetConfigUpdatedAt: identity?.updateTime.toISOString() ?? null,
          accountId: identity?.accountId ?? null,
        });
        await recheck();
        return tx.relayChannelProbeRun.create({
          data: {
            id: runId,
            relayChannelId: channelId,
            profileId: profile.id,
            requestedByUserId: principal.subjectUserId,
            probeMemberChannelId: body.memberChannelId ?? null,
            probeMemberChannelName: body.memberChannelId ? target.name : null,
            distributionMultiplier: body.distributionMultiplier ?? profile.distributionMultiplier,
            cacheBustingEnabled: profile.cacheMode === "cache-bust",
            probeEndpoint: endpoint(format, profile.probeEndpoint, Boolean(config?.probeFormat)),
            cacheMode: profile.cacheMode,
            sampleCount: profile.sampleCount,
            strictCalibrationValidation: profile.strictCalibrationValidation,
            measurementInputTokens: profile.measurementInputTokens,
            balanceSettlementTolerance: profile.balanceSettlementTolerance,
            balanceSettlementReads: profile.balanceSettlementReads,
            forceWithoutCacheBuster: body.forceWithoutCacheBuster === true,
          },
          select: relayProbeRunPublicSelect,
        });
      },
    );
  }
}
