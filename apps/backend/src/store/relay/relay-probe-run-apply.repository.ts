import { Prisma } from "@prisma/client";
import { Permission, type RelayProbeFormat } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_PROBE_APPLY_POLICY } from "@/constant/relay-probe";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeProfileArn, platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { BadRequestError, ConflictError } from "@/util/errors";
import { projectRelayModelRates } from "@/services/relay/relay-configuration-projection";
import {
  buildProbePricingSnapshot,
  fingerprintProbePricing,
  resolveProbeModelPricing,
  defaultProbeEndpoint,
  requiresLargeMultiplierConfirmation,
} from "@/services/relay/relay-probe-pricing";
import { iamAccountDenied } from "../users/iam-account-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget } from "./relay-probe-read-target";

const identitySelect = { id: true, relayChannelId: true, probeMemberChannelId: true, profileId: true } as const;
const applySelect = {
  ...identitySelect,
  status: true,
  calibrationStatus: true,
  finishedAt: true,
  suggestedMultiplier: true,
  sourceChannelMultiplier: true,
  pricingFingerprint: true,
  appliedAt: true,
  updateTime: true,
} as const satisfies Prisma.RelayChannelProbeRunSelect;
/** Applying a result needs pricing and identity, never samples, ledgers, payloads, workflows or credentials. */
export class RelayProbeRunApplyRepository {
  private static instance: RelayProbeRunApplyRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunApplyRepository());
  }
  async apply(
    runId: string,
    override: number | undefined,
    forceLargeChange: boolean,
    guard: RelayProbeMutationContext,
    withLock: <T>(channelId: string, operation: () => Promise<T>) => Promise<T>,
  ): Promise<boolean> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard;
    const identity = await prisma.relayChannelProbeRun.findUnique({ where: { id: runId }, select: identitySelect });
    if (!identity?.profileId) throw iamAccountDenied();
    const channelId = identity.relayChannelId,
      profileId = identity.profileId,
      memberId = identity.probeMemberChannelId;
    await authorize([
      platformRelayChannelArn(channelId),
      platformRelayProbeRunArn(channelId, runId),
      platformRelayProbeProfileArn(channelId, profileId),
      ...(memberId ? [platformRelayChannelArn(memberId)] : []),
    ]);
    return withLock(channelId, () =>
      mutatePlatformRelayProbe(Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST, principal, snapshot, recheck, async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${channelId} FOR UPDATE`);
        const { channel, members } = await relayProbeReadTarget(tx, channelId, memberId ?? undefined, visible);
        if (channel.channelType === "pooled" ? !memberId : channel.channelType !== "standalone" || Boolean(memberId))
          throw iamAccountDenied();
        // The parent multiplier affects every member, not just the one used to measure it.
        const allMembers = [...members].sort(),
          limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
        for (let offset = 0; offset < allMembers.length; offset += limit)
          await authorize(allMembers.slice(offset, offset + limit).map(platformRelayChannelArn));
        if (memberId) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${memberId} FOR UPDATE`);
          const member = await tx.relayChannel.findUniqueOrThrow({
            where: { id: memberId },
            select: {
              status: true,
              providerServiceEnabled: true,
              pooledMemberEnabled: true,
              visibilityMode: true,
              visibilityConfig: true,
            },
          });
          if (
            member.status !== RELAY_CHANNEL_STATUS.ENABLED ||
            !member.providerServiceEnabled ||
            !member.pooledMemberEnabled ||
            !(await visible(member))
          )
            throw iamAccountDenied();
          if (
            !(await tx.relayChannel.count({ where: { pooledParentId: channelId } })) &&
            !(await tx.relayChannelMember.count({
              where: { relayChannelId: channelId, memberChannelId: memberId, enabled: true },
            }))
          )
            throw iamAccountDenied();
        }
        await recheck();
        const run = await tx.relayChannelProbeRun.findUnique({ where: { id: runId }, select: applySelect });
        if (
          !run ||
          run.relayChannelId !== channelId ||
          run.profileId !== profileId ||
          run.probeMemberChannelId !== memberId
        )
          throw iamAccountDenied();
        if (run.status !== "succeeded" || run.suggestedMultiplier === null || run.appliedAt)
          throw new BadRequestError("Probe result is not applicable", undefined, {
            messageKey: "relayChannelProbe.resultNotApplicable",
          });
        if (run.calibrationStatus !== "verified")
          throw new BadRequestError("Probe result is not verified", undefined, {
            messageKey: "relayChannelProbe.resultStabilityFailed",
          });
        const now = new Date(),
          since = new Date(now.getTime() - RELAY_PROBE_APPLY_POLICY.suggestionMaxAgeMs);
        if (!run.finishedAt || run.finishedAt < since || run.finishedAt > now)
          throw new BadRequestError("Probe result expired", undefined, {
            messageKey: "relayChannelProbe.suggestionExpired",
          });
        if (!run.pricingFingerprint || run.sourceChannelMultiplier === null)
          throw new BadRequestError("Missing probe snapshot", undefined, {
            messageKey: "relayChannelProbe.legacyResultMissingBillingSnapshot",
          });
        const value = override ?? Number(run.suggestedMultiplier),
          sourceMultiplier = Number(run.sourceChannelMultiplier);
        if (
          !Number.isFinite(value) ||
          value < RELAY_PROBE_APPLY_POLICY.minimumMultiplier ||
          value > RELAY_PROBE_APPLY_POLICY.maximumMultiplier ||
          !Number.isFinite(sourceMultiplier) ||
          sourceMultiplier <= 0
        )
          throw new BadRequestError("Invalid probe multiplier", undefined, { messageKey: "errors.badRequest" });
        if (!persist) return false; // Shadow previews identities and scopes; it never hydrates pricing or writes.
        const billing = await tx.relayChannel.findUniqueOrThrow({
          where: { id: channelId },
          select: {
            multiplier: true,
            updateTime: true,
            timePeriodMultipliers: true,
            contextLengthMultipliers: true,
            inputTokensIncludeCacheRead: true,
            modelMapping: true,
          },
        });
        if (Number(billing.multiplier) !== sourceMultiplier)
          throw new ConflictError("Multiplier changed", undefined, {
            messageKey: "relayChannelProbe.multiplierChangedReprobe",
          });
        const profile = await tx.relayChannelProbeProfile.findFirst({
          where: { id: profileId, relayChannelId: channelId },
          select: { probeModel: true, probeFormat: true, probeEndpoint: true, cacheMode: true },
        });
        if (!profile) throw iamAccountDenied();
        const target = await tx.relayChannelProbeTargetConfig.findUnique({
          where: { profileId_targetChannelId: { profileId, targetChannelId: memberId ?? channelId } },
          select: { probeModel: true, probeFormat: true },
        });
        const effective = {
          ...profile,
          probeModel: target?.probeModel ?? profile.probeModel,
          probeEndpoint: target?.probeFormat
            ? defaultProbeEndpoint(target.probeFormat as RelayProbeFormat)
            : profile.probeEndpoint,
        };
        const mapping = memberId
          ? (await tx.relayChannel.findUniqueOrThrow({ where: { id: memberId }, select: { modelMapping: true } }))
              .modelMapping
          : billing.modelMapping;
        const config = await tx.relayConfig.findFirst({
          where: { status: 1 },
          orderBy: { updateTime: "desc" },
          select: { globalMultiplier: true },
        });
        if (!config) throw iamAccountDenied();
        const rates = projectRelayModelRates(
          await tx.modelPricing.findMany({ where: { status: 1 }, orderBy: { model: "asc" } }),
        );
        const { rate } = resolveProbeModelPricing(
          effective.probeModel,
          mapping as Record<string, string> | null,
          rates,
        );
        const fingerprint = fingerprintProbePricing(
          buildProbePricingSnapshot(effective, billing, mapping, rate, Number(config.globalMultiplier), now),
        );
        if (fingerprint !== run.pricingFingerprint)
          throw new ConflictError("Pricing changed", undefined, {
            messageKey: "relayChannelProbe.billingConfigChangedReprobe",
          });
        if (!forceLargeChange && requiresLargeMultiplierConfirmation(sourceMultiplier, value)) {
          const previousWhere = {
            relayChannelId: channelId,
            profileId,
            probeMemberChannelId: memberId,
            id: { not: runId },
            status: "succeeded",
            calibrationStatus: "verified",
            suggestedMultiplier: { not: null },
            sourceChannelMultiplier: run.sourceChannelMultiplier,
            pricingFingerprint: fingerprint,
            finishedAt: { gte: since, lte: now },
          } satisfies Prisma.RelayChannelProbeRunWhereInput;
          const previous = await tx.relayChannelProbeRun.findFirst({
            where: previousWhere,
            orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
            select: { id: true },
          });
          if (!previous)
            throw new BadRequestError("Independent confirmation required", undefined, {
              messageKey: "relayChannelProbe.largeMultiplierChangeNeedsConfirmation",
            });
          await authorize([platformRelayProbeRunArn(channelId, previous.id)]);
          await recheck();
          const confirmation = await tx.relayChannelProbeRun.findFirst({
            where: { ...previousWhere, id: previous.id },
            select: { suggestedMultiplier: true },
          });
          if (
            requiresLargeMultiplierConfirmation(
              sourceMultiplier,
              value,
              confirmation?.suggestedMultiplier === null || confirmation?.suggestedMultiplier === undefined
                ? undefined
                : Number(confirmation.suggestedMultiplier),
            )
          )
            throw new BadRequestError("Independent confirmation differs", undefined, {
              messageKey: "relayChannelProbe.largeMultiplierChangeNeedsConfirmation",
            });
        }
        await recheck();
        const changed = await tx.relayChannel.updateMany({
          where: { id: channelId, multiplier: run.sourceChannelMultiplier, updateTime: billing.updateTime },
          data: { multiplier: value },
        });
        if (changed.count !== 1) throw iamAccountDenied();
        const applied = await tx.relayChannelProbeRun.updateMany({
          where: {
            id: runId,
            updateTime: run.updateTime,
            appliedAt: null,
            status: "succeeded",
            calibrationStatus: "verified",
            profileId,
            relayChannelId: channelId,
            probeMemberChannelId: memberId,
          },
          data: { appliedAt: now, appliedByUserId: principal.subjectUserId, appliedMultiplier: value },
        });
        if (applied.count !== 1) throw iamAccountDenied();
        await recheck();
        return true;
      }),
    );
  }
}
