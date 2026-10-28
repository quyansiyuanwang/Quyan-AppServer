import { prisma } from "@/config/database";
import type { Prisma, IPBlackList } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import type {
  PlatformCollectionStore,
  PlatformCollectionCursor,
  PlatformCollectionTarget,
} from "../system/platform-collection.store";
export interface PlatformIPBlacklistTarget extends PlatformCollectionTarget {
  ipAddress: string;
}
export interface PlatformIPBlacklistCollectionStore
  extends PlatformCollectionStore<Record<string, never>, Prisma.IPBlackListWhereInput, PlatformIPBlacklistTarget> {
  hydrate(targets: readonly PlatformIPBlacklistTarget[]): Promise<IPBlackList[]>;
}
export class PlatformIPBlacklistCollectionRepository implements PlatformIPBlacklistCollectionStore {
  private static instance: PlatformIPBlacklistCollectionRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIPBlacklistCollectionRepository());
  }
  async where(_filters: Record<string, never>) {
    return { status: 1 };
  }
  private validCursor(cursor: PlatformCollectionCursor) {
    if (
      !isPlatformLogResourceId(cursor.id) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  scan(where: Prisma.IPBlackListWhereInput, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor) {
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    return prisma.iPBlackList.findMany({
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
      select: { id: true, ipAddress: true, status: true, createTime: true, updateTime: true },
    });
  }
  hydrate(targets: readonly PlatformIPBlacklistTarget[]): Promise<IPBlackList[]> {
    if (!targets.length) return Promise.resolve([]);
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(targets.map((row) => row.id)).size !== targets.length ||
      targets.some(
        (row) =>
          !isPlatformLogResourceId(row.id) ||
          !platformIpAddressIdentifier(row.ipAddress) ||
          row.status !== 1 ||
          !(row.createTime instanceof Date) ||
          !Number.isFinite(row.createTime.getTime()) ||
          !(row.updateTime instanceof Date) ||
          !Number.isFinite(row.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    return prisma.iPBlackList.findMany({
      where: {
        status: 1,
        OR: targets.map((row) => ({
          id: row.id,
          ipAddress: row.ipAddress,
          createTime: row.createTime,
          updateTime: row.updateTime,
        })),
      },
    });
  }
}
