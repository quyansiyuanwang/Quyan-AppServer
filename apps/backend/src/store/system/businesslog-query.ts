import type { Prisma } from "@prisma/client";
import type { QueryBusinessLogParams } from "./businesslog.store";
import { RECORD_STATUS } from "@/constant/status";
const BUSINESS_LOG_QUERY_LIMITS = { userMatches: 100 } as const;
export async function resolveBusinessLogWhere(
  client: Pick<Prisma.TransactionClient, "user">,
  params: Omit<QueryBusinessLogParams, "page" | "pageSize">,
): Promise<Prisma.BusinessLogWhereInput | null> {
  const {
    operationType,
    operationCategory,
    actorUserId,
    actor,
    targetUserId,
    target,
    startDate,
    endDate,
    success,
    ip,
  } = params;

  const where: Prisma.BusinessLogWhereInput = {
    status: RECORD_STATUS.ACTIVE,
    ...(operationType && { operationType }),
    ...(operationCategory && { operationCategory }),
    ...(actorUserId && { actorUserId }),
    ...(targetUserId && { targetUserId }),
    ...(success !== undefined && { success }),
    ...(ip && {
      ipAddress: {
        contains: (() => {
          if (ip === "::1") return "127.0.0.1";
          if (ip.startsWith("::ffff:")) return ip.substring(7);
          return ip;
        })(),
      },
    }),
    ...(startDate || endDate
      ? {
          createTime: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  if (actor) {
    const actors = await client.user.findMany({
      where: {
        OR: [{ username: { contains: actor } }, { id: actor }],
        status: RECORD_STATUS.ACTIVE,
      },
      select: { id: true },
      take: BUSINESS_LOG_QUERY_LIMITS.userMatches,
    });
    const actorUserIds = actors.map((u) => u.id);

    if (actorUserIds.length === 0) return null;

    if (where.actorUserId) {
      if (!actorUserIds.includes(where.actorUserId as string)) return null;
    } else where.actorUserId = { in: actorUserIds };
  }

  if (target) {
    const targets = await client.user.findMany({
      where: {
        OR: [{ username: { contains: target } }, { id: target }],
        status: RECORD_STATUS.ACTIVE,
      },
      select: { id: true },
      take: BUSINESS_LOG_QUERY_LIMITS.userMatches,
    });
    const targetUserIds = targets.map((u) => u.id);

    if (targetUserIds.length === 0) return null;

    if (where.targetUserId) {
      if (!targetUserIds.includes(where.targetUserId as string)) return null;
    } else where.targetUserId = { in: targetUserIds };
  }

  return where;
}
