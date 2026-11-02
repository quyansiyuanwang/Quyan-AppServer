import { Prisma, type RelayProbeRoundTarget } from "@prisma/client";
import { prisma } from "@/config/database";
import { probeRoundChanges, probeRoundFailure } from "@/services/relay/relay-probe-round-report";
import type { RelayProbeRoundTargetReportDto } from "@/api/dto/relay/relay-probe-round.dto";
import { RELAY_PROBE_ROUND_POLICY } from "@/services/relay/relay-probe-round-policy";
import { iamAccountDenied } from "../users/iam-account-principal";

const numberValue = (value: Prisma.Decimal | number | null | undefined) => (value == null ? undefined : Number(value));
export function roundTargetIdentity(target: RelayProbeRoundTarget): RelayProbeRoundTargetReportDto {
  return {
    id: target.id,
    channelId: target.channelId,
    memberChannelId: target.memberChannelId || undefined,
    channelName: target.channelName,
    memberChannelName: target.memberChannelName ?? undefined,
    runId: target.runId ?? undefined,
    state: target.state,
    errorStage: target.errorStage ?? undefined,
    errorCode: target.errorCode ?? undefined,
  };
}

export class RelayProbeRoundReportRepository {
  private static instance: RelayProbeRoundReportRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRoundReportRepository());
  }

  async reconcile(target: RelayProbeRoundTarget, expired: boolean) {
    if (!target.runId) {
      if (expired)
        await prisma.relayProbeRoundTarget.updateMany({
          where: { id: target.id, state: "pending" },
          data: { state: "timed_out", errorStage: "queue", errorCode: "round-timeout" },
        });
      return;
    }
    if (expired)
      await prisma.relayChannelProbeRun.updateMany({
        where: { id: target.runId, status: { in: ["queued", "running"] } },
        data: {
          status: "timed_out",
          errorMessage: "Scheduled round timeout",
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    const run = await prisma.relayChannelProbeRun.findUnique({
      where: { id: target.runId },
      select: {
        id: true,
        status: true,
        createTime: true,
        upstreamBalanceBefore: true,
        upstreamBalanceAfter: true,
        upstreamBalanceDelta: true,
        localBalanceBefore: true,
        localBalanceAfter: true,
        localBalanceDelta: true,
        requestTokens: true,
        responseTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        baseLocalCost: true,
        sourceChannelMultiplier: true,
        suggestedMultiplier: true,
        calibrationStatus: true,
        errorMessage: true,
        profile: { select: { upstreamCurrency: true, localCurrency: true } },
      },
    });
    if (run && ["queued", "running"].includes(run.status)) return;
    const previous = run
      ? await prisma.relayChannelProbeRun.findFirst({
          where: {
            relayChannelId: target.channelId,
            probeMemberChannelId: target.memberChannelId || null,
            id: { not: run.id },
            createTime: { lt: run.createTime },
            status: "succeeded",
            calibrationStatus: "verified",
            suggestedMultiplier: { not: null },
          },
          orderBy: [{ createTime: "desc" }, { id: "desc" }],
          select: { suggestedMultiplier: true },
        })
      : null;
    const channel = await prisma.relayChannel.findUnique({
      where: { id: target.channelId },
      select: { multiplier: true },
    });
    const state = run?.status ?? "cancelled",
      measured = numberValue(run?.sourceChannelMultiplier),
      suggested = numberValue(run?.suggestedMultiplier),
      prior = numberValue(previous?.suggestedMultiplier);
    const failure = run
      ? probeRoundFailure(state, run.errorMessage)
      : { errorStage: "history", errorCode: "run-unavailable" };
    const report: RelayProbeRoundTargetReportDto = {
      ...roundTargetIdentity(target),
      state,
      upstreamCurrency: run?.profile?.upstreamCurrency,
      localCurrency: run?.profile?.localCurrency,
      balanceBefore: numberValue(run?.upstreamBalanceBefore),
      balanceAfter: numberValue(run?.upstreamBalanceAfter),
      balanceDelta: numberValue(run?.upstreamBalanceDelta),
      localBalanceBefore: numberValue(run?.localBalanceBefore),
      localBalanceAfter: numberValue(run?.localBalanceAfter),
      localBalanceDelta: numberValue(run?.localBalanceDelta),
      inputTokens: run?.requestTokens ?? undefined,
      outputTokens: run?.responseTokens ?? undefined,
      cacheReadTokens: run?.cacheReadTokens ?? undefined,
      cacheCreationTokens: run?.cacheCreationTokens ?? undefined,
      baseLocalCost: numberValue(run?.baseLocalCost),
      measuredMultiplier: measured,
      currentMultiplier: numberValue(channel?.multiplier),
      suggestedMultiplier: suggested,
      previousSuggestedMultiplier: prior,
      ...probeRoundChanges(measured, suggested, prior),
      calibrationStatus: run?.calibrationStatus,
      ...failure,
    };
    await prisma.relayProbeRoundTarget.updateMany({
      where: { id: target.id, state: "queued", runId: target.runId },
      data: { state, ...failure, report: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue },
    });
  }

  async claimNotifications(owner: string, now: Date) {
    const rows = await prisma.relayProbeRoundNotification.findMany({
      where: {
        state: { in: ["pending", "sending"] },
        nextAttemptAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: { nextAttemptAt: "asc" },
      take: RELAY_PROBE_ROUND_POLICY.batchSize,
    });
    const claimed = [];
    for (const row of rows) {
      const changed = await prisma.relayProbeRoundNotification.updateMany({
        where: {
          id: row.id,
          state: { in: ["pending", "sending"] },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          state: "sending",
          leaseOwner: owner,
          leaseExpiresAt: new Date(now.getTime() + RELAY_PROBE_ROUND_POLICY.leaseMs),
          attempts: { increment: 1 },
        },
      });
      if (changed.count) claimed.push(row);
    }
    return claimed;
  }
  async notificationData(roundId: string) {
    return prisma.relayProbeRound.findUniqueOrThrow({
      where: { id: roundId },
      include: { targets: { orderBy: [{ channelId: "asc" }, { memberChannelId: "asc" }] } },
    });
  }
  async delivered(id: string, owner: string, state: "delivered" | "unsubscribed", inboxItemId: string) {
    await prisma.relayProbeRoundNotification.updateMany({
      where: { id, leaseOwner: owner, state: "sending" },
      data: { state, inboxItemId, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null },
    });
  }
  async recheckDelivery(id: string, owner: string) {
    const result = await prisma.relayProbeRoundNotification.updateMany({
      where: { id, state: "sending", leaseOwner: owner, leaseExpiresAt: { gt: new Date() } },
      data: { leaseExpiresAt: new Date(Date.now() + RELAY_PROBE_ROUND_POLICY.leaseMs) },
    });
    if (result.count !== 1) throw iamAccountDenied();
  }
  async deliveryFailed(id: string, owner: string, attempts: number) {
    await prisma.relayProbeRoundNotification.updateMany({
      where: { id, leaseOwner: owner, state: "sending" },
      data: {
        state: attempts >= RELAY_PROBE_ROUND_POLICY.maxDeliveryAttempts ? "failed" : "pending",
        lastErrorCode: "notification-delivery-failed",
        nextAttemptAt: new Date(
          Date.now() +
            RELAY_PROBE_ROUND_POLICY.deliveryRetryMs * Math.min(attempts, RELAY_PROBE_ROUND_POLICY.maxDeliveryAttempts),
        ),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }
}
