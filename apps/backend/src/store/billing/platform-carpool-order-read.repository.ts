import type { IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { carpoolOrderInclude, type CarpoolOrderRecord } from "./carpool.repository";
import type { PlatformCarpoolOrderReadStore, PlatformCarpoolOrderFilters } from "./platform-carpool-order-read.store";
const identitySelect = {
  id: true,
  state: true,
  status: true,
  createTime: true,
  updateTime: true,
  submittedAt: true,
} as const satisfies Prisma.CarpoolOrderSelect;
export class PlatformCarpoolOrderReadRepository implements PlatformCarpoolOrderReadStore {
  private static instance: PlatformCarpoolOrderReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolOrderReadRepository());
  }
  async list(
    principal: IamPrincipal,
    filters: PlatformCarpoolOrderFilters,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    const { page, pageSize, state, keyword } = filters,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      // State counters use the same admitted population as the table, before applying the selected state.
      const where: Prisma.CarpoolOrderWhereInput = {
        status: { gte: 0 },
        ...(keyword
          ? {
              OR: [
                { packageName: { contains: keyword } },
                { id: { contains: keyword } },
                { owner: { username: { contains: keyword } } },
              ],
            }
          : {}),
      };
      let after: string | undefined;
      const targets: Prisma.CarpoolOrderGetPayload<{ select: typeof identitySelect }>[] = [],
        stateCounts: Record<string, number> = {};
      for (;;) {
        const rows = await tx.carpoolOrder.findMany({
          where: { ...where, ...(after ? { id: { gt: after } } : {}) },
          select: identitySelect,
          orderBy: { id: "asc" },
          take: limit,
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(rows.map((row) => platformCarpoolOrderArn(row.id)));
        rows.forEach((row, index) => {
          if (outcomes[index] !== "Allow") return;
          stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;
          if (!state || row.state === state) targets.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      targets.sort(
        (a, b) =>
          (a.submittedAt === null && b.submittedAt === null
            ? 0
            : a.submittedAt === null
              ? 1
              : b.submittedAt === null
                ? -1
                : a.submittedAt.getTime() - b.submittedAt.getTime()) ||
          b.createTime.getTime() - a.createTime.getTime() ||
          b.id.localeCompare(a.id),
      );
      const records: CarpoolOrderRecord[] = [];
      for (const target of targets.slice((page - 1) * pageSize, page * pageSize)) {
        const row = await tx.carpoolOrder.findFirst({
          where: { ...where, id: target.id },
          include: carpoolOrderInclude,
        });
        if (
          !row ||
          row.state !== target.state ||
          row.status !== target.status ||
          row.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw iamAccountDenied();
        records.push(row);
      }
      return { total: targets.length, stateCounts, records };
    });
  }
  async get(
    principal: IamPrincipal,
    id: string,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      if ((await checkedDecide([platformCarpoolOrderArn(id)]))[0] !== "Allow") throw iamAccountDenied();
      const row = await tx.carpoolOrder.findFirst({ where: { id, status: { gte: 0 } }, include: carpoolOrderInclude });
      if (!row) throw iamAccountDenied();
      return row;
    });
  }
}
