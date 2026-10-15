import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { ProbeChannelVisibilityRecord } from "./relay-probe-latest-run-read.repository";
import { relayProbeReadTarget } from "./relay-probe-read-target";
import { relayProbeRunPublicSelect, type RelayProbeRunPublicRecord } from "./relay-probe-run-public-select";
export interface RelayProbeRunHistoryQuery {
  channelId: string;
  memberChannelId?: string;
  page: number;
  pageSize: number;
}
export class RelayProbeRunHistoryReadRepository {
  private static instance: RelayProbeRunHistoryReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunHistoryReadRepository());
  }
  async list<T>(
    principal: IamPrincipal,
    query: RelayProbeRunHistoryQuery,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
    map: (run: RelayProbeRunPublicRecord) => T,
  ) {
    const { channelId, memberChannelId, page, pageSize } = query,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const targets = [channelId, ...(memberChannelId ? [memberChannelId] : [])];
      if ((await checkedDecide(targets.map(platformRelayChannelArn))).some((value) => value !== "Allow"))
        throw iamAccountDenied();
      const { members } = await relayProbeReadTarget(tx, channelId, memberChannelId, visible);
      let after: { id: string; createTime: Date } | undefined,
        total = 0;
      const selected: { id: string; updateTime: Date }[] = [],
        start = (page - 1) * pageSize;
      for (;;) {
        const rows = await tx.relayChannelProbeRun.findMany({
          where: {
            relayChannelId: channelId,
            ...(memberChannelId ? { probeMemberChannelId: memberChannelId } : {}),
            ...(after
              ? {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                }
              : {}),
          },
          select: { id: true, relayChannelId: true, probeMemberChannelId: true, createTime: true, updateTime: true },
          orderBy: [{ createTime: "desc" }, { id: "desc" }],
          take: limit,
        });
        if (!rows.length) break;
        const current = rows.filter((row) => !row.probeMemberChannelId || members.has(row.probeMemberChannelId)),
          memberIds = [
            ...new Set(current.flatMap((row) => (row.probeMemberChannelId ? [row.probeMemberChannelId] : []))),
          ];
        const memberDecisions = await checkedDecide(memberIds.map(platformRelayChannelArn)),
          allowed = new Set(memberIds.filter((_id, index) => memberDecisions[index] === "Allow"));
        const candidates = current.filter((row) => !row.probeMemberChannelId || allowed.has(row.probeMemberChannelId));
        const outcomes = await checkedDecide(candidates.map((row) => platformRelayProbeRunArn(channelId, row.id)));
        candidates.forEach((row, index) => {
          if (outcomes[index] === "Allow") {
            if (total >= start && selected.length < pageSize) selected.push(row);
            total++;
          }
        });
        after = rows[rows.length - 1]!;
        if (rows.length < limit) break;
      }
      const rows = selected.length
        ? await tx.relayChannelProbeRun.findMany({
            where: { id: { in: selected.map((row) => row.id) } },
            select: relayProbeRunPublicSelect,
          })
        : [];
      if (
        rows.length !== selected.length ||
        rows.some(
          (row) => !selected.some((old) => old.id === row.id && old.updateTime.getTime() === row.updateTime.getTime()),
        )
      )
        throw iamAccountDenied();
      const byId = new Map(rows.map((row) => [row.id, row]));
      return { items: selected.map((row) => map(byId.get(row.id)!)), total, page, pageSize };
    });
  }
}
