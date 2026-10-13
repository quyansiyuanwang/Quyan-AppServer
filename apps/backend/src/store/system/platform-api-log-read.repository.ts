import type { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { resolveApiLogWhere } from "./apilog-query";
import { API_LOG_LIST_SELECT, type ApiLogFilters, type APILogWithoutResponse } from "./apilog.store";
import { prisma } from "@/config/database";
import { isApiLogResourceId } from "@/iam/resources/platform-api-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import {
  PLATFORM_API_LOG_TARGET_SELECT,
  PLATFORM_API_LOG_COLLECTION_SELECT,
  type PlatformApiLogReadStore,
  type PlatformApiLogCollectionStore,
  type PlatformApiLogCollectionCursor,
  type PlatformApiLogCollectionTarget,
} from "./platform-api-log-read.store";
export class PlatformApiLogReadRepository implements PlatformApiLogReadStore, PlatformApiLogCollectionStore {
  private static instance: PlatformApiLogReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformApiLogReadRepository());
  }
  target(id: string) {
    if (!isApiLogResourceId(id)) throw iamAccountDenied();
    return prisma.aPILog.findFirst({ where: { id, status: 1 }, select: PLATFORM_API_LOG_TARGET_SELECT });
  }
  where(query: ApiLogFilters) {
    return resolveApiLogWhere(prisma, query);
  }
  private validCursor(cursor: PlatformApiLogCollectionCursor) {
    if (
      !isApiLogResourceId(cursor.id) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  scan(
    where: Prisma.APILogWhereInput,
    after?: PlatformApiLogCollectionCursor,
    boundary?: PlatformApiLogCollectionCursor,
  ) {
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    return prisma.aPILog.findMany({
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
      select: PLATFORM_API_LOG_COLLECTION_SELECT,
    });
  }
  hydrate(targets: readonly PlatformApiLogCollectionTarget[]): Promise<APILogWithoutResponse[]> {
    if (!targets.length) return Promise.resolve([]);
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(targets.map((target) => target.id)).size !== targets.length ||
      targets.some(
        (target) =>
          !isApiLogResourceId(target.id) ||
          target.status !== 1 ||
          !(target.createTime instanceof Date) ||
          !Number.isFinite(target.createTime.getTime()) ||
          !(target.updateTime instanceof Date) ||
          !Number.isFinite(target.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    return prisma.aPILog.findMany({
      where: {
        status: 1,
        OR: targets.map((target) => ({ id: target.id, createTime: target.createTime, updateTime: target.updateTime })),
      },
      select: API_LOG_LIST_SELECT,
    });
  }
}
