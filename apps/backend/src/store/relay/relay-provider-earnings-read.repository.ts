import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { relayProviderArn, relayProviderEarningArn } from "@/iam/resources/relay-provider-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";

const earningSelect = {
  id: true,
  providerId: true,
  grossAmount: true,
  commissionPercent: true,
  commissionAmount: true,
  settlementId: true,
  createTime: true,
  settledAt: true,
  provider: { select: { userId: true, relayChannel: { select: { id: true, name: true } } } },
} as const satisfies Prisma.RelayChannelProviderEarningSelect;
export type RelayProviderEarningReadRecord = Prisma.RelayChannelProviderEarningGetPayload<{
  select: typeof earningSelect;
}>;
export interface RelayProviderEarningsReadStore {
  list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<{
    total: number;
    records: RelayProviderEarningReadRecord[];
    pendingAmount: Prisma.Decimal;
    settledAmount: Prisma.Decimal;
  }>;
}
export class RelayProviderEarningsReadRepository implements RelayProviderEarningsReadStore {
  private static instance: RelayProviderEarningsReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProviderEarningsReadRepository());
  }
  async list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    const { page, pageSize } = pagination,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      scanSize = Math.max(1, Math.floor(limit / 2));
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)
    )
      throw iamAccountDenied();
    // Disabled providers retain their historical earnings. Ownership is always limited to this user.
    const where = { status: 1, provider: { userId: principal.subjectUserId } };
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const admitted: { id: string; providerId: string; createTime: Date; updateTime: Date }[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await tx.relayChannelProviderEarning.findMany({
          where: { ...where, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: scanSize,
          select: { id: true, providerId: true, createTime: true, updateTime: true },
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(
          rows.flatMap((row) => [
            relayProviderArn(principal.accountOwnerId, principal.subjectUserId, row.providerId),
            relayProviderEarningArn(principal.accountOwnerId, principal.subjectUserId, row.id),
          ]),
        );
        rows.forEach((row, index) => {
          if (outcomes[index * 2] === "Allow" && outcomes[index * 2 + 1] === "Allow") admitted.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < scanSize) break;
      }
      // Amounts, counts and pagination all use the same individually admitted population.
      let pendingAmount = new Prisma.Decimal(0),
        settledAmount = new Prisma.Decimal(0);
      for (let offset = 0; offset < admitted.length; offset += limit) {
        const batch = admitted.slice(offset, offset + limit),
          rows = await tx.relayChannelProviderEarning.findMany({
            where: { ...where, id: { in: batch.map((row) => row.id) } },
            select: { id: true, providerId: true, updateTime: true, commissionAmount: true, settlementId: true },
          });
        const revisions = new Map(batch.map((row) => [row.id, row]));
        if (
          rows.length !== batch.length ||
          rows.some((row) => {
            const prior = revisions.get(row.id);
            return (
              !prior || prior.providerId !== row.providerId || prior.updateTime.getTime() !== row.updateTime.getTime()
            );
          })
        )
          throw iamAccountDenied();
        for (const row of rows) {
          if (row.settlementId) settledAmount = settledAmount.add(row.commissionAmount);
          else pendingAmount = pendingAmount.add(row.commissionAmount);
        }
      }
      admitted.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
      const selected = admitted.slice((page - 1) * pageSize, page * pageSize),
        records: RelayProviderEarningReadRecord[] = [];
      // Load channel names and gross amounts only for authorized records on this page.
      for (const row of selected) {
        const record = await tx.relayChannelProviderEarning.findFirst({
          where: { ...where, id: row.id, providerId: row.providerId, updateTime: row.updateTime },
          select: earningSelect,
        });
        if (!record || record.provider.userId !== principal.subjectUserId) throw iamAccountDenied();
        records.push(record);
      }
      return { total: admitted.length, records, pendingAmount, settledAmount };
    });
  }
}
