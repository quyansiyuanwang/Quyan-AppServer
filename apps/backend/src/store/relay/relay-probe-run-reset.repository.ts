import type { Prisma, RelayChannelProbeRun } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeQueueSlotArn,
  platformRelayProbeRunArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { mutatePlatformRelayProbe, type RelayProbeMutationContext } from "./platform-relay-probe-mutation";
import { relayProbeReadTarget } from "./relay-probe-read-target";
export interface RelayProbeQueueSnapshot {
  memberChannelId?: string;
  value: string | null;
}
const reservationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class RelayProbeRunResetRepository {
  private static instance: RelayProbeRunResetRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunResetRepository());
  }
  async reset(
    channelId: string,
    memberChannelId: string | undefined,
    message: string,
    guard: RelayProbeMutationContext,
    readSlots: (memberIds: readonly (string | undefined)[]) => Promise<RelayProbeQueueSnapshot[]>,
  ): Promise<RelayProbeQueueSnapshot[]> {
    const { principal, snapshot, authorize, recheck, visible, persist } = guard,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return mutatePlatformRelayProbe(
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      principal,
      snapshot,
      recheck,
      async (tx) => {
        await authorize([platformRelayChannelArn(channelId)]);
        const { members } = await relayProbeReadTarget(tx, channelId, memberChannelId, visible);
        const active: Pick<RelayChannelProbeRun, "id" | "probeMemberChannelId">[] = [];
        let after: string | undefined;
        for (;;) {
          const rows: Pick<RelayChannelProbeRun, "id" | "probeMemberChannelId">[] =
            await tx.relayChannelProbeRun.findMany({
              where: {
                relayChannelId: channelId,
                status: { in: ["queued", "running"] },
                ...(memberChannelId ? { probeMemberChannelId: memberChannelId } : {}),
                ...(after ? { id: { gt: after } } : {}),
              },
              select: { id: true, probeMemberChannelId: true },
              orderBy: { id: "asc" },
              take: limit,
            });
          if (!rows.length) break;
          await authorize(rows.map((row) => platformRelayProbeRunArn(channelId, row.id)));
          active.push(...rows);
          after = rows[rows.length - 1]!.id;
          if (rows.length < limit) break;
        }
        // Whole-pool reset covers current reservations and old members with persisted active work.
        const memberIds = memberChannelId
          ? [memberChannelId]
          : [
              ...new Set([
                ...members,
                ...active.flatMap((row) => (row.probeMemberChannelId ? [row.probeMemberChannelId] : [])),
              ]),
            ];
        for (let offset = 0; offset < memberIds.length; offset += limit)
          await authorize(memberIds.slice(offset, offset + limit).map(platformRelayChannelArn));
        const slots = memberChannelId ? [memberChannelId] : [undefined, ...memberIds];
        for (let offset = 0; offset < slots.length; offset += limit)
          await authorize(
            slots.slice(offset, offset + limit).map((id) => platformRelayProbeQueueSlotArn(channelId, id)),
          );
        // Shadow performs the exact metadata authorization, but no Redis reads or queue mutations.
        if (!persist) return [];
        const observed = await readSlots(slots);
        if (
          observed.length !== slots.length ||
          observed.some(
            (row, index) =>
              row.memberChannelId !== slots[index] || (row.value !== null && typeof row.value !== "string"),
          )
        )
          throw iamAccountDenied();
        for (const slot of observed) {
          if (slot.value === null) continue;
          // A terminal run's queue reference is still a run resource. UUID reservations have no run yet and are controlled by the queue-slot grant.
          const referenced = await tx.relayChannelProbeRun.findUnique({
            where: { id: slot.value },
            select: { id: true, relayChannelId: true, probeMemberChannelId: true },
          });
          if (referenced) {
            if (
              referenced.relayChannelId !== channelId ||
              referenced.probeMemberChannelId !== (slot.memberChannelId ?? null)
            )
              throw iamAccountDenied();
            await authorize([platformRelayProbeRunArn(channelId, referenced.id)]);
          } else if (!reservationPattern.test(slot.value)) throw iamAccountDenied();
        }
        await recheck();
        for (let offset = 0; offset < active.length; offset += limit) {
          const ids = active.slice(offset, offset + limit).map((row) => row.id),
            where: Prisma.RelayChannelProbeRunWhereInput = {
              id: { in: ids },
              relayChannelId: channelId,
              status: { in: ["queued", "running"] },
            };
          await tx.relayChannelProbeRun.updateMany({
            where,
            data: {
              status: "cancelled",
              finishedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              errorMessage: message,
            },
          });
        }
        return observed;
      },
    );
  }
}
