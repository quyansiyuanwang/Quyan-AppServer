import type { Prisma } from "@prisma/client";
import type { QueryAPILogParams } from "./apilog.store";
const API_LOG_QUERY_LIMITS = Object.freeze({ userMatches: 100, defaultRangeDays: 30 });
/** Shared legacy/native predicate. Returning undefined means a user search matched no active identity. */
export async function resolveApiLogWhere(
  client: Pick<Prisma.TransactionClient, "user">,
  params: QueryAPILogParams,
): Promise<Prisma.APILogWhereInput | undefined> {
  const where: Prisma.APILogWhereInput = { status: 1 };
  if (params.user) {
    const users = await client.user.findMany({
      where: { OR: [{ username: { contains: params.user } }, { id: params.user }], status: 1 },
      select: { id: true },
      take: API_LOG_QUERY_LIMITS.userMatches,
    });
    if (!users.length) return undefined;
    where.userID = { in: users.map((user) => user.id) };
  }
  if (params.search)
    where.OR = [
      { path: { contains: params.search } },
      { requestID: { contains: params.search } },
      { ipAddress: { contains: params.search } },
      { queryParams: { string_contains: params.search } },
      { bodyParams: { string_contains: params.search } },
    ];
  else {
    if (params.requestID) where.requestID = { contains: params.requestID };
    if (params.path) where.path = { contains: params.path };
    if (params.ip) where.ipAddress = { contains: params.ip };
  }
  if (params.method)
    where.method = Array.isArray(params.method)
      ? params.method.length
        ? { in: params.method }
        : undefined
      : params.method;
  if (params.statusCode)
    where.statusCode = Array.isArray(params.statusCode)
      ? params.statusCode.length
        ? { in: params.statusCode }
        : undefined
      : params.statusCode;
  if (params.startDate || params.endDate)
    where.createTime = {
      ...(params.startDate ? { gte: params.startDate } : {}),
      ...(params.endDate ? { lte: params.endDate } : {}),
    };
  else {
    const start = new Date();
    start.setDate(start.getDate() - API_LOG_QUERY_LIMITS.defaultRangeDays);
    where.createTime = { gte: start };
  }
  return where;
}
