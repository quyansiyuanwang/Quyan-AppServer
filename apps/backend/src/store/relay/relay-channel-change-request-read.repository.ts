import type { IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import {
  relayChannelChangeRequestArn,
  platformRelayChannelChangeRequestArn,
} from "@/iam/resources/relay-channel-change-request-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
export const relayChannelChangeRequestPublicSelect = {
  id: true,
  status: true,
  relayChannelId: true,
  submittedByUserId: true,
  reviewStatus: true,
  reviewedAt: true,
  reviewReason: true,
  configSnapshot: true,
  createTime: true,
  updateTime: true,
  relayChannel: { select: { name: true } },
  submittedBy: { select: { username: true } },
} as const satisfies Prisma.RelayChannelChangeRequestSelect;
export interface RelayChannelChangeRequestReadQuery {
  mine: boolean;
  page: number;
  pageSize: number;
  reviewStatus?: string;
}
export class RelayChannelChangeRequestReadRepository {
  private static instance: RelayChannelChangeRequestReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelChangeRequestReadRepository());
  }
  async list(
    principal: IamPrincipal,
    query: RelayChannelChangeRequestReadQuery,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    hydrate = true,
  ) {
    const { mine, page, pageSize, reviewStatus } = query,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize) ||
      (reviewStatus !== undefined && !["pending", "approved", "rejected"].includes(reviewStatus))
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const where: Prisma.RelayChannelChangeRequestWhereInput = {
        status: 1,
        relayChannel: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
        ...(mine ? { submittedByUserId: principal.subjectUserId } : {}),
        ...(reviewStatus ? { reviewStatus } : {}),
      };
      const allowed: string[] = [];
      let after: string | undefined;
      for (;;) {
        await recheck();
        const rows = await tx.relayChannelChangeRequest.findMany({
          where: { ...where, ...(after ? { id: { gt: after } } : {}) },
          select: { id: true, relayChannelId: true, submittedByUserId: true },
          orderBy: { id: "asc" },
          take: limit,
        });
        if (!rows.length) break;
        if (rows.some((row) => mine && row.submittedByUserId !== principal.subjectUserId)) throw iamAccountDenied();
        const outcomes = await checkedDecide(
          rows.map((row) =>
            mine
              ? relayChannelChangeRequestArn(principal.accountOwnerId, row.submittedByUserId, row.id)
              : platformRelayChannelChangeRequestArn(row.relayChannelId, row.id),
          ),
        );
        rows.forEach((row, i) => {
          if (outcomes[i] === "Allow") allowed.push(row.id);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      await recheck();
      if (!hydrate || !allowed.length) return { items: [], total: allowed.length, page, pageSize };
      // Pagination and total are computed only after all resource decisions; no encrypted credential columns.
      const filtered = { ...where, id: { in: allowed } };
      const items = await tx.relayChannelChangeRequest.findMany({
        where: filtered,
        select: relayChannelChangeRequestPublicSelect,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      const expected = JSON.stringify(items);
      await recheck();
      const current = await tx.relayChannelChangeRequest.findMany({
        where: filtered,
        select: relayChannelChangeRequestPublicSelect,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      if (JSON.stringify(current) !== expected) throw iamAccountDenied();
      return { items, total: allowed.length, page, pageSize };
    });
  }
}
