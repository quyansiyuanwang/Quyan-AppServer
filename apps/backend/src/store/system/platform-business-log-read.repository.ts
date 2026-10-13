import type { Prisma, BusinessLog } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformLogCollectionStore, PlatformLogCursor, PlatformLogTarget } from "./platform-log-collection.store";
import { resolveBusinessLogWhere } from "./businesslog-query";
import type { QueryBusinessLogParams } from "./businesslog.store";
export type BusinessLogFilters = Omit<QueryBusinessLogParams, "page" | "pageSize">;
export interface PlatformBusinessLogReadStore
  extends PlatformLogCollectionStore<BusinessLogFilters, Prisma.BusinessLogWhereInput> {
  hydrate(targets: readonly PlatformLogTarget[]): Promise<BusinessLog[]>;
}
const metadata = { id: true, status: true, createTime: true, updateTime: true } as const;
export class PlatformBusinessLogReadRepository implements PlatformBusinessLogReadStore {
  private static instance: PlatformBusinessLogReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformBusinessLogReadRepository());
  }
  where(filters: BusinessLogFilters) {
    return resolveBusinessLogWhere(prisma, filters);
  }
  private validCursor(cursor: PlatformLogCursor) {
    if (
      !isPlatformLogResourceId(cursor.id) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  scan(where: Prisma.BusinessLogWhereInput, after?: PlatformLogCursor, boundary?: PlatformLogCursor) {
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    return prisma.businessLog.findMany({
      where: {
        AND: [
          where,
          { status: 1 },
          ...(after
            ? [
                {
                  OR: [
                    { createTime: { lt: after.createTime } },
                    { createTime: after.createTime, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
          ...(boundary
            ? [
                {
                  OR: [
                    { createTime: { lt: boundary.createTime } },
                    { createTime: boundary.createTime, id: { lte: boundary.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      select: metadata,
    });
  }
  hydrate(targets: readonly PlatformLogTarget[]): Promise<BusinessLog[]> {
    if (!targets.length) return Promise.resolve([]);
    this.validateTargets(targets);
    return prisma.businessLog.findMany({
      where: {
        status: 1,
        OR: targets.map((target) => ({ id: target.id, createTime: target.createTime, updateTime: target.updateTime })),
      },
    });
  }
  private validateTargets(targets: readonly PlatformLogTarget[]) {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(targets.map((target) => target.id)).size !== targets.length ||
      targets.some(
        (target) =>
          !isPlatformLogResourceId(target.id) ||
          target.status !== 1 ||
          !(target.createTime instanceof Date) ||
          !Number.isFinite(target.createTime.getTime()) ||
          !(target.updateTime instanceof Date) ||
          !Number.isFinite(target.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
  }
}
