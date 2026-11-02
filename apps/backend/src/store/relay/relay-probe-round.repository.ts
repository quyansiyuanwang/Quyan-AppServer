import { Prisma, type RelayProbeRoundTarget, type RelayChannelProbeProfile } from "@prisma/client";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/config/database";
import {
  Permission,
  NotificationEvent,
  supportsRelayRequestFormat,
  parseAllowedModelsJson,
  type RelayRequestFormat,
} from "@quyan/shared";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeAccountArn,
  platformRelayProbeProfileArn,
  platformRelayProbeQueueSlotArn,
  platformRelayProbeRunArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeUpstreamConfigured } from "./relay-probe-read-target";
import { probeAccountRevision } from "@/services/relay/relay-probe-account-editor";
import {
  RELAY_PROBE_ROUND_POLICY as policy,
  dueProbeDailyOccurrence,
  nextProbeDailyOccurrence,
} from "@/services/relay/relay-probe-round-policy";
import type { RelayProbeRunAdmissionTarget } from "./relay-probe-run-create.repository";
import { ConflictError, ForbiddenError } from "@/util/errors";
import type { SaveRelayProbeDailyScheduleRequest } from "@/api/dto/relay/relay-probe-round.dto";

export type ProbeTargetReadiness = (
  profile: RelayChannelProbeProfile,
  targetId: string,
  pooled: boolean,
  accountId: string | null,
) => Promise<boolean>;

export function scheduledProbeResources(
  target: Pick<RelayProbeRoundTarget, "id" | "channelId" | "memberChannelId" | "profileId" | "accountId">,
) {
  return [
    platformRelayChannelArn(target.channelId),
    platformRelayProbeProfileArn(target.channelId, target.profileId),
    platformRelayProbeRunArn(target.channelId, target.id),
    platformRelayProbeQueueSlotArn(target.channelId, target.memberChannelId || undefined),
    ...(target.memberChannelId ? [platformRelayChannelArn(target.memberChannelId)] : []),
    ...(target.accountId ? [platformRelayProbeAccountArn(target.accountId)] : []),
  ];
}

export class RelayProbeRoundRepository {
  private static instance: RelayProbeRoundRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRoundRepository());
  }

  schedule(actorUserId: string) {
    return prisma.relayProbeDailySchedule.findUnique({ where: { actorUserId } });
  }
  async actorForRound(id: string) {
    return (await prisma.relayProbeRound.findUniqueOrThrow({ where: { id }, select: { actorUserId: true } }))
      .actorUserId;
  }

  async saveSchedule(actorUserId: string, body: SaveRelayProbeDailyScheduleRequest, guard: RelayProbeMutationContext) {
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      guard.principal,
      guard.snapshot,
      guard.recheck,
      async (tx) => {
        const current = await tx.relayProbeDailySchedule.findUnique({ where: { actorUserId } });
        if ((current?.version ?? 0) !== body.expectedVersion)
          throw new ConflictError("Probe schedule changed", undefined, { messageKey: "errors.conflict" });
        const data = {
          enabled: body.enabled,
          minuteOfDay: body.minuteOfDay,
          timezone: policy.timezone,
          nextRunAt: nextProbeDailyOccurrence(new Date(), body.minuteOfDay),
        };
        if (body.enabled) {
          const preference = await tx.notificationPreference.findUniqueOrThrow({ where: { userId: actorUserId } });
          const events = Array.isArray(preference.subscribedEvents)
            ? preference.subscribedEvents.filter((event): event is string => typeof event === "string")
            : [];
          await tx.notificationPreference.update({
            where: { id: preference.id },
            data: { subscribedEvents: [...new Set([...events, NotificationEvent.RELAY_PROBE_ROUND_COMPLETED])] },
          });
        }
        return current
          ? tx.relayProbeDailySchedule.update({
              where: { id: current.id },
              data: { ...data, version: { increment: 1 } },
            })
          : tx.relayProbeDailySchedule.create({ data: { ...data, actorUserId } });
      },
    );
  }

  async due(now: Date, authorizeActor: (actorUserId: string) => Promise<void>) {
    const schedules = await prisma.relayProbeDailySchedule.findMany({
      where: { status: 1, enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: policy.batchSize,
    });
    for (const schedule of schedules) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_probe_daily_schedules WHERE id = ${schedule.id} FOR UPDATE`);
        const current = await tx.relayProbeDailySchedule.findUniqueOrThrow({ where: { id: schedule.id } });
        if (!current.enabled || current.status !== 1 || current.nextRunAt > now) return;
        const occurrence = dueProbeDailyOccurrence(now, current.minuteOfDay);
        let qualified = true;
        try {
          await authorizeActor(current.actorUserId);
        } catch (error) {
          if (!(error instanceof ForbiddenError)) throw error;
          qualified = false;
        }
        if (qualified && occurrence && current.timezone === policy.timezone)
          await tx.relayProbeRound.upsert({
            where: { scheduleId_scheduledFor: { scheduleId: current.id, scheduledFor: occurrence } },
            create: {
              scheduleId: current.id,
              scheduleVersion: current.version,
              actorUserId: current.actorUserId,
              scheduledFor: occurrence,
            },
            update: {},
          });
        await tx.relayProbeDailySchedule.update({
          where: { id: current.id },
          data: { nextRunAt: nextProbeDailyOccurrence(now, current.minuteOfDay) },
        });
      });
    }
  }

  async claimRounds(owner: string, now: Date) {
    const rows = await prisma.relayProbeRound.findMany({
      where: {
        state: { in: ["pending", "running"] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: { createTime: "asc" },
      take: policy.batchSize,
    });
    const claimed = [];
    for (const row of rows) {
      const result = await prisma.relayProbeRound.updateMany({
        where: { id: row.id, state: row.state, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
        data: { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + policy.leaseMs) },
      });
      if (result.count) claimed.push(row);
    }
    return claimed;
  }

  private async owned(tx: Prisma.TransactionClient, roundId: string, owner: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_probe_rounds WHERE id = ${roundId} FOR UPDATE`);
    const round = await tx.relayProbeRound.findUniqueOrThrow({ where: { id: roundId }, include: { schedule: true } });
    if (
      round.leaseOwner !== owner ||
      !round.leaseExpiresAt ||
      round.leaseExpiresAt.getTime() <= Date.now() ||
      !["pending", "running"].includes(round.state)
    )
      throw iamAccountDenied();
    return round;
  }

  /** Uses the exact same discovery rules for release preflight, without creating a round or making upstream requests. */
  async inspectTargets(guard: RelayProbeMutationContext, ready: ProbeTargetReadiness) {
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      guard.principal,
      guard.snapshot,
      guard.recheck,
      (tx) => this.discoverTargets(tx, "preflight", guard, ready, false),
    );
  }

  private async discoverTargets(
    tx: Prisma.TransactionClient,
    roundId: string,
    guard: RelayProbeMutationContext,
    ready: ProbeTargetReadiness,
    persist: boolean,
  ): Promise<number> {
    const profiles = await tx.relayChannelProbeProfile.findMany({
      where: {
        enabled: true,
        relayChannel: {
          channelType: { in: ["standalone", "pooled"] },
          status: RELAY_CHANNEL_STATUS.ENABLED,
          providerServiceEnabled: true,
        },
      },
      select: { id: true, relayChannelId: true },
    });
    let count = 0;
    for (const metadata of profiles) {
      // Authorize before fetching the encrypted profile or account configuration.
      try {
        await guard.authorize([
          platformRelayChannelArn(metadata.relayChannelId),
          platformRelayProbeProfileArn(metadata.relayChannelId, metadata.id),
        ]);
      } catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        continue;
      }
      const channel = await tx.relayChannel.findUniqueOrThrow({
        where: { id: metadata.relayChannelId },
        select: { id: true, name: true, channelType: true, visibilityMode: true, visibilityConfig: true },
      });
      if (!(await guard.visible(channel))) continue;
      const profile = await tx.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: metadata.id } });
      const strict =
        channel.channelType === "pooled" ? await tx.relayChannel.count({ where: { pooledParentId: channel.id } }) : 0;
      const ids =
        channel.channelType !== "pooled"
          ? [channel.id]
          : strict
            ? (await tx.relayChannel.findMany({ where: { pooledParentId: channel.id }, select: { id: true } })).map(
                (row) => row.id,
              )
            : (
                await tx.relayChannelMember.findMany({
                  where: { relayChannelId: channel.id, enabled: true },
                  select: { memberChannelId: true },
                })
              ).map((row) => row.memberChannelId);
      for (const targetId of new Set(ids)) {
        const target = await tx.relayChannel.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            name: true,
            status: true,
            pooledMemberEnabled: true,
            providerServiceEnabled: true,
            visibilityMode: true,
            visibilityConfig: true,
            allowedFormats: true,
            allowedModels: true,
          },
        });
        if (
          !target ||
          target.status !== RELAY_CHANNEL_STATUS.ENABLED ||
          target.pooledMemberEnabled === false ||
          target.providerServiceEnabled === false ||
          !(await guard.visible(target))
        )
          continue;
        const config = await tx.relayChannelProbeTargetConfig.findUnique({
          where: { profileId_targetChannelId: { profileId: profile.id, targetChannelId: targetId } },
        });
        const data = {
          id: createId(),
          roundId,
          channelId: channel.id,
          memberChannelId: channel.channelType === "pooled" ? target.id : "",
          channelName: channel.name,
          memberChannelName: channel.channelType === "pooled" ? target.name : null,
          profileId: profile.id,
          profileUpdatedAt: profile.updateTime,
          targetConfigId: config?.id ?? null,
          targetUpdatedAt: config?.updateTime ?? null,
          accountId: config?.accountId ?? null,
        };
        try {
          await guard.authorize(scheduledProbeResources(data));
        } catch (error) {
          if (!(error instanceof ForbiddenError)) throw error;
          continue;
        }
        const format = config?.probeFormat ?? profile.probeFormat,
          model = config?.probeModel ?? profile.probeModel,
          models = parseAllowedModelsJson(target.allowedModels) ?? [];
        if (
          !supportsRelayRequestFormat(target.allowedFormats, format as RelayRequestFormat) ||
          (models.length && !models.includes(model)) ||
          !(await relayProbeUpstreamConfigured(tx, target.id, format))
        )
          continue;
        const account = data.accountId
          ? await tx.relayChannelProbeAccount.findUnique({
              where: { id: data.accountId },
              select: { encryptedCredentials: true, credentialIv: true, credentialAuthTag: true },
            })
          : null;
        if (data.accountId && !account) continue;
        if (!(await ready(profile, target.id, channel.channelType === "pooled", data.accountId))) continue;
        if (persist)
          await tx.relayProbeRoundTarget.create({
            data: { ...data, accountRevision: account ? probeAccountRevision(account) : null },
          });
        count++;
      }
    }
    return count;
  }

  async snapshotTargets(roundId: string, owner: string, guard: RelayProbeMutationContext, ready: ProbeTargetReadiness) {
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      guard.principal,
      guard.snapshot,
      guard.recheck,
      async (tx) => {
        const round = await this.owned(tx, roundId, owner);
        if (round.state !== "pending") return;
        if (
          !round.schedule.enabled ||
          round.schedule.version !== round.scheduleVersion ||
          round.actorUserId !== guard.principal.subjectUserId
        )
          throw iamAccountDenied();
        const count = await this.discoverTargets(tx, roundId, guard, ready, true);
        await tx.relayProbeRound.update({
          where: { id: roundId },
          data: { state: "running", startedAt: new Date(), targetCount: count },
        });
      },
    );
  }

  async attachRun(
    tx: Prisma.TransactionClient,
    target: RelayProbeRoundTarget,
    owner: string,
    runId: string,
    admission: RelayProbeRunAdmissionTarget,
  ) {
    const round = await this.owned(tx, target.roundId, owner);
    const current = await tx.relayProbeRoundTarget.findUniqueOrThrow({ where: { id: target.id } });
    if (
      current.state !== "pending" ||
      current.runId ||
      !round.schedule.enabled ||
      round.schedule.version !== round.scheduleVersion ||
      admission.profileId !== target.profileId ||
      admission.profileUpdatedAt !== target.profileUpdatedAt.toISOString() ||
      admission.targetConfigId !== target.targetConfigId ||
      admission.targetConfigUpdatedAt !== (target.targetUpdatedAt?.toISOString() ?? null) ||
      admission.accountId !== target.accountId
    )
      throw iamAccountDenied();
    if (target.accountId) {
      const account = await tx.relayChannelProbeAccount.findUnique({
        where: { id: target.accountId },
        select: { encryptedCredentials: true, credentialIv: true, credentialAuthTag: true },
      });
      if (!account || probeAccountRevision(account) !== target.accountRevision) throw iamAccountDenied();
    }
    await tx.relayProbeRoundTarget.update({ where: { id: target.id }, data: { runId, state: "queued" } });
  }

  async targets(roundId: string) {
    const rows = await prisma.relayProbeRoundTarget.findMany({
      where: { roundId, state: { in: ["pending", "queued"] } },
      orderBy: [{ updateTime: "asc" }, { id: "asc" }],
      take: policy.batchSize,
    });
    // Rotate attempts so slow queued tasks and transient failures cannot starve later targets.
    if (rows.length)
      await prisma.relayProbeRoundTarget.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, state: { in: ["pending", "queued"] } },
        data: { updateTime: new Date() },
      });
    return rows;
  }
  execution(runId: string) {
    return prisma.relayProbeRoundTarget.findUnique({
      where: { runId },
      include: { round: { include: { schedule: true } } },
    });
  }
  async release(roundId: string, owner: string) {
    await prisma.relayProbeRound.updateMany({
      where: { id: roundId, leaseOwner: owner },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  }

  async failPending(roundId: string, owner: string, errorCode: string) {
    return prisma.$transaction(async (tx) => {
      await this.owned(tx, roundId, owner);
      await tx.relayProbeRoundTarget.updateMany({
        where: { roundId, state: "pending" },
        data: { state: "cancelled", errorStage: errorCode === "round-timeout" ? "queue" : "authorization", errorCode },
      });
      await tx.relayProbeRound.update({
        where: { id: roundId },
        data: {
          state: "running",
          startedAt: new Date(),
          errorStage: errorCode === "round-timeout" ? "queue" : "authorization",
          errorCode,
        },
      });
    });
  }

  async skipTarget(id: string, errorStage: string, errorCode: string) {
    await prisma.relayProbeRoundTarget.updateMany({
      where: { id, state: "pending", runId: null },
      data: { state: "skipped", errorStage, errorCode },
    });
  }

  async finish(roundId: string, owner: string) {
    return prisma.$transaction(async (tx) => {
      const round = await this.owned(tx, roundId, owner);
      if (
        round.state !== "running" ||
        (await tx.relayProbeRoundTarget.count({ where: { roundId, state: { in: ["pending", "queued"] } } }))
      )
        return;
      await tx.relayProbeRound.update({
        where: { id: roundId },
        data: { state: "completed", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      await tx.relayProbeRoundNotification.upsert({ where: { roundId }, create: { roundId }, update: {} });
    });
  }
}
