import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { buildErrorGroupWhere, type ErrorGroupQuery } from "./observability.repository";
import {
  PLATFORM_ERROR_GROUP_COLLECTION_SELECT,
  type PlatformErrorGroupCollectionStore,
  type PlatformErrorGroupCollectionCursor,
  type PlatformErrorGroupCollectionTarget,
} from "./platform-error-group-read.store";
import { prisma } from "@/config/database";
import { isErrorGroupResourceId } from "@/iam/resources/platform-error-group-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import {
  PLATFORM_ERROR_GROUP_TARGET_SELECT,
  type PlatformErrorGroupReadStore,
} from "./platform-error-group-read.store";
export class PlatformErrorGroupReadRepository
  implements PlatformErrorGroupReadStore, PlatformErrorGroupCollectionStore
{
  private static instance: PlatformErrorGroupReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformErrorGroupReadRepository());
  }
  target(id: string) {
    if (!isErrorGroupResourceId(id)) throw iamAccountDenied();
    return prisma.errorGroup.findFirst({ where: { id, status: 1 }, select: PLATFORM_ERROR_GROUP_TARGET_SELECT });
  }
  private validCursor(cursor: PlatformErrorGroupCollectionCursor) {
    if (
      !isErrorGroupResourceId(cursor.id) ||
      !(cursor.lastSeenAt instanceof Date) ||
      !Number.isFinite(cursor.lastSeenAt.getTime())
    )
      throw iamAccountDenied();
  }
  scan(
    query: ErrorGroupQuery,
    after?: PlatformErrorGroupCollectionCursor,
    boundary?: PlatformErrorGroupCollectionCursor,
  ) {
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    return prisma.errorGroup.findMany({
      where: {
        AND: [
          buildErrorGroupWhere(query, true),
          ...(after
            ? [
                {
                  OR: [
                    { lastSeenAt: { lt: after.lastSeenAt } },
                    { lastSeenAt: after.lastSeenAt, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
          ...(boundary
            ? [
                {
                  OR: [
                    { lastSeenAt: { lt: boundary.lastSeenAt } },
                    { lastSeenAt: boundary.lastSeenAt, id: { lte: boundary.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      select: PLATFORM_ERROR_GROUP_COLLECTION_SELECT,
    });
  }
  async hydrate(
    targets: readonly PlatformErrorGroupCollectionTarget[],
  ): ReturnType<PlatformErrorGroupCollectionStore["hydrate"]> {
    if (!targets.length) return [];
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(targets.map((t) => t.id)).size !== targets.length ||
      targets.some(
        (t) =>
          !isErrorGroupResourceId(t.id) ||
          t.status !== 1 ||
          !(t.lastSeenAt instanceof Date) ||
          !Number.isFinite(t.lastSeenAt.getTime()) ||
          !(t.updateTime instanceof Date) ||
          !Number.isFinite(t.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    return prisma.errorGroup.findMany({
      where: { status: 1, OR: targets.map((t) => ({ id: t.id, lastSeenAt: t.lastSeenAt, updateTime: t.updateTime })) },
    });
  }
}
