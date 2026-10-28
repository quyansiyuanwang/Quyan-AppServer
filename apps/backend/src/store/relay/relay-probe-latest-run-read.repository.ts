import type { Prisma, RelayChannel } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { RelayChannelProbeTargetDto } from "@/api/dto/relay/relay-channel-probe.dto";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayProbeRunPublicSelect, type RelayProbeRunPublicRecord } from "./relay-probe-run-public-select";
export type ProbeChannelVisibilityRecord = Pick<RelayChannel, "visibilityMode" | "visibilityConfig">;
export interface RelayProbeLatestRunReadStore {
  latest<T>(
    principal: IamPrincipal,
    targets: readonly RelayChannelProbeTargetDto[],
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
    map: (run: RelayProbeRunPublicRecord) => T,
  ): Promise<(RelayChannelProbeTargetDto & { latestRun?: T })[]>;
}
const targetKey = (target: RelayChannelProbeTargetDto) =>
  JSON.stringify([target.channelId, target.memberChannelId ?? null]);
export class RelayProbeLatestRunReadRepository implements RelayProbeLatestRunReadStore {
  private static instance: RelayProbeLatestRunReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeLatestRunReadRepository());
  }
  async latest<T>(
    principal: IamPrincipal,
    targets: readonly RelayChannelProbeTargetDto[],
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
    map: (run: RelayProbeRunPublicRecord) => T,
  ) {
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const identifiers = [
          ...new Set(
            targets.flatMap((target) => [
              target.channelId,
              ...(target.memberChannelId ? [target.memberChannelId] : []),
            ]),
          ),
        ],
        decisions = await checkedDecide(identifiers.map(platformRelayChannelArn)),
        allowed = new Set(identifiers.filter((_id, index) => decisions[index] === "Allow")),
        admitted = targets.filter(
          (target) => allowed.has(target.channelId) && (!target.memberChannelId || allowed.has(target.memberChannelId)),
        );
      if (!admitted.length) return [];
      const parentIds = [...new Set(admitted.map((target) => target.channelId))],
        channels = await tx.relayChannel.findMany({
          where: { id: { in: parentIds }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
          select: { id: true, channelType: true, visibilityMode: true, visibilityConfig: true },
        });
      if (channels.length !== parentIds.length) throw iamAccountDenied();
      for (const channel of channels) if (!(await visible(channel))) throw iamAccountDenied();
      const memberIds = [
        ...new Set(admitted.flatMap((target) => (target.memberChannelId ? [target.memberChannelId] : []))),
      ];
      if (memberIds.length) {
        const members = await tx.relayChannel.findMany({
            where: { id: { in: memberIds }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
            select: { id: true },
          }),
          children = await tx.relayChannel.findMany({
            where: { pooledParentId: { in: parentIds } },
            select: { id: true, pooledParentId: true },
          }),
          edges = await tx.relayChannelMember.findMany({
            where: { relayChannelId: { in: parentIds } },
            select: { relayChannelId: true, memberChannelId: true },
          });
        for (const target of admitted) {
          if (!target.memberChannelId) continue;
          const parent = channels.find((channel) => channel.id === target.channelId),
            strict = children.filter((child) => child.pooledParentId === target.channelId);
          if (
            parent?.channelType !== "pooled" ||
            !members.some((member) => member.id === target.memberChannelId) ||
            !(strict.length
              ? strict.some((child) => child.id === target.memberChannelId)
              : edges.some(
                  (edge) => edge.relayChannelId === target.channelId && edge.memberChannelId === target.memberChannelId,
                ))
          )
            throw iamAccountDenied();
        }
      }
      const where: Prisma.RelayChannelProbeRunWhereInput = {
          OR: admitted.map((target) => ({
            relayChannelId: target.channelId,
            probeMemberChannelId: target.memberChannelId ?? null,
          })),
        },
        latest = await tx.relayChannelProbeRun.findMany({
          where,
          select: { id: true, relayChannelId: true, probeMemberChannelId: true, updateTime: true },
          orderBy: [{ createTime: "desc" }, { id: "desc" }],
          distinct: ["relayChannelId", "probeMemberChannelId"],
        }),
        runDecisions = await checkedDecide(latest.map((run) => platformRelayProbeRunArn(run.relayChannelId, run.id))),
        granted = latest.filter((_row, index) => runDecisions[index] === "Allow"),
        rows = granted.length
          ? await tx.relayChannelProbeRun.findMany({
              where: { id: { in: granted.map((row) => row.id) } },
              select: relayProbeRunPublicSelect,
            })
          : [];
      if (
        rows.length !== granted.length ||
        rows.some(
          (row) =>
            !granted.some(
              (old) =>
                old.id === row.id &&
                old.relayChannelId === row.relayChannelId &&
                old.probeMemberChannelId === row.probeMemberChannelId &&
                old.updateTime.getTime() === row.updateTime.getTime(),
            ),
        )
      )
        throw iamAccountDenied();
      const byTarget = new Map(
        rows.map((row) => [
          targetKey({ channelId: row.relayChannelId, memberChannelId: row.probeMemberChannelId ?? undefined }),
          row,
        ]),
      );
      return admitted.map((target) => {
        const run = byTarget.get(targetKey(target));
        return { ...target, ...(run ? { latestRun: map(run) } : {}) };
      });
    });
  }
}
