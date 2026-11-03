import { prisma } from "@/config/database";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { scheduledProbeResources } from "./relay-probe-round.repository";
import { roundTargetIdentity } from "./relay-probe-round-report.repository";
import type { RelayProbeRoundDto, RelayProbeRoundTargetReportDto } from "@/api/dto/relay/relay-probe-round.dto";
import type { RelayProbeRound } from "@prisma/client";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";

export function projectProbeRound(
  round: RelayProbeRound & { notification?: { state: string } | null },
): RelayProbeRoundDto {
  return {
    id: round.id,
    state: round.state,
    scheduledFor: round.scheduledFor,
    startedAt: round.startedAt ?? undefined,
    finishedAt: round.finishedAt ?? undefined,
    targetCount: round.targetCount,
    notificationState: round.notification?.state,
    errorStage: round.errorStage ?? undefined,
    errorCode: round.errorCode ?? undefined,
  };
}

export class RelayProbeRoundReadRepository {
  private static instance: RelayProbeRoundReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRoundReadRepository());
  }

  /** Reused immediately before email delivery so revoked channel visibility cannot leak an old report. */
  async authorizeTargets(roundId: string, guard: RelayProbeMutationContext) {
    const identities = await prisma.relayProbeRoundTarget.findMany({
      where: { roundId },
      select: { id: true, channelId: true, memberChannelId: true, profileId: true, accountId: true },
    });
    for (const target of identities) {
      await guard.authorize(scheduledProbeResources(target));
      for (const id of new Set([target.channelId, target.memberChannelId || target.channelId])) {
        const channel = await prisma.relayChannel.findFirst({
          where: { id, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
          select: { id: true, visibilityMode: true, visibilityConfig: true },
        });
        if (!channel || !(await guard.visible(channel))) throw iamAccountDenied();
      }
    }
    await guard.recheck();
  }

  async list(guard: RelayProbeMutationContext, page: number, pageSize: number) {
    const authorized: string[] = [];
    let after: string | undefined;
    for (;;) {
      const rows: { id: string }[] = await prisma.relayProbeRound.findMany({
        where: { actorUserId: guard.principal.subjectUserId, ...(after ? { id: { gt: after } } : {}) },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 100,
      });
      for (const row of rows) {
        try {
          await this.authorizeTargets(row.id, guard);
          authorized.push(row.id);
        } catch {
          /* Count only authorized rounds. */
        }
      }
      if (rows.length < 100) break;
      after = rows.at(-1)!.id;
    }
    const items = await prisma.relayProbeRound.findMany({
      where: { id: { in: authorized } },
      orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { notification: { select: { state: true } } },
    });
    for (const item of items) await this.authorizeTargets(item.id, guard);
    await guard.recheck();
    return { items: items.map(projectProbeRound), total: authorized.length, page, pageSize };
  }

  async detail(id: string, guard: RelayProbeMutationContext, page: number, pageSize: number) {
    const round = await prisma.relayProbeRound.findFirst({
      where: { id, actorUserId: guard.principal.subjectUserId },
      include: { notification: { select: { state: true } } },
    });
    if (!round) throw iamAccountDenied();
    await this.authorizeTargets(id, guard);
    const [items, total] = await prisma.$transaction([
      prisma.relayProbeRoundTarget.findMany({
        where: { roundId: id },
        orderBy: [{ channelName: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.relayProbeRoundTarget.count({ where: { roundId: id } }),
    ]);
    await this.authorizeTargets(id, guard);
    await guard.recheck();
    return {
      round: projectProbeRound(round),
      items: items.map((target) =>
        target.report && typeof target.report === "object" && !Array.isArray(target.report)
          ? (target.report as unknown as RelayProbeRoundTargetReportDto)
          : roundTargetIdentity(target),
      ),
      total,
      page,
      pageSize,
    };
  }
}
