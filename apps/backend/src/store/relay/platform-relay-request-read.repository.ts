import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
const targetSelect = {
  id: true,
  requestId: true,
  relayTokenId: true,
  createTime: true,
  updateTime: true,
  relayToken: {
    select: {
      id: true,
      userId: true,
      status: true,
      updateTime: true,
      user: { select: { id: true, status: true, updateTime: true } },
    },
  },
} as const satisfies Prisma.RelayLogicalRequestSelect;
const attemptSelect = {
  id: true,
  status: true,
  updateTime: true,
  statusCode: true,
  method: true,
  path: true,
  totalTokens: true,
  timeToFirstByte: true,
  totalOutputTime: true,
  createTime: true,
} as const satisfies Prisma.RelayUsageSelect;
export type RelayRequestReadTarget = Prisma.RelayLogicalRequestGetPayload<{ select: typeof targetSelect }>;
export type RelayRequestReadQuery = {
  page: number;
  pageSize: number;
  requestId?: string;
  keyword?: string;
  outcome?: "success" | "client-error" | "server-error";
  startDate?: string;
  endDate?: string;
};
export class PlatformRelayRequestReadRepository {
  private static instance: PlatformRelayRequestReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayRequestReadRepository());
  }
  async scan(query: RelayRequestReadQuery, after?: string) {
    const attempt: Prisma.RelayUsageWhereInput | undefined =
      query.outcome === "success"
        ? { statusCode: { gte: 200, lt: 400 } }
        : query.outcome === "client-error"
          ? { statusCode: { gte: 400, lt: 500 } }
          : query.outcome === "server-error"
            ? { statusCode: { gte: 500 } }
            : undefined;
    return prisma.relayLogicalRequest.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        ...(query.requestId ? { requestId: { contains: query.requestId } } : {}),
        ...(query.startDate || query.endDate
          ? {
              createTime: {
                ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
                ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
              },
            }
          : {}),
        ...(query.keyword
          ? {
              relayToken: {
                OR: [{ name: { contains: query.keyword } }, { user: { username: { contains: query.keyword } } }],
              },
            }
          : {}),
        ...(attempt
          ? {
              OR: [
                { relayUsages: { some: { ...attempt, status: 1 } } },
                { tokenAttributions: { some: { status: 1, relayUsage: { ...attempt, status: 1 } } } },
              ],
            }
          : {}),
      },
      select: targetSelect,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async traceTarget(requestId: string) {
    let rows = await prisma.relayLogicalRequest.findMany({
      where: { requestId, tokenAttributions: { some: { depth: 0, status: 1 } } },
      select: targetSelect,
      take: 2,
    });
    if (!rows.length)
      rows = await prisma.relayLogicalRequest.findMany({
        where: { requestId },
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        select: targetSelect,
        take: 2,
      });
    if (rows.length !== 1 || rows[0]!.requestId !== requestId) throw iamAccountDenied();
    return rows[0]!;
  }
  async hydrate(target: RelayRequestReadTarget, trace: boolean) {
    const attempt = { ...attemptSelect, ...(trace ? { executionChannelId: true as const } : {}) };
    const row = await prisma.relayLogicalRequest.findUnique({
      where: { id: target.id },
      select: {
        ...targetSelect,
        relayToken: {
          select: {
            ...targetSelect.relayToken.select,
            name: true,
            user: { select: { ...targetSelect.relayToken.select.user.select, username: true } },
          },
        },
        relayUsages: { where: { status: 1 }, select: attempt, orderBy: [{ createTime: "asc" }, { id: "asc" }] },
        tokenAttributions: {
          where: { status: 1, relayUsage: { status: 1 } },
          select: { id: true, depth: true, updateTime: true, relayUsage: { select: attempt } },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!row) throw iamAccountDenied();
    const {
      relayUsages,
      tokenAttributions,
      relayToken: {
        name: _name,
        user: { username: _username, ...user },
        ...token
      },
      ...metadata
    } = row;
    if (JSON.stringify({ ...metadata, relayToken: { ...token, user } }) !== JSON.stringify(target))
      throw iamAccountDenied();
    const usages = [
      ...new Map(
        [...relayUsages, ...tokenAttributions.map((item) => item.relayUsage)].map((usage) => [usage.id, usage]),
      ).values(),
    ].sort((a, b) => a.createTime.getTime() - b.createTime.getTime() || a.id.localeCompare(b.id));
    return { row, usages };
  }
  async channels(ids: readonly string[]) {
    const rows = [];
    for (let i = 0; i < ids.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      rows.push(
        ...(await prisma.relayChannel.findMany({
          where: { id: { in: [...ids.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)] } },
          select: { id: true, name: true, status: true, updateTime: true },
          orderBy: { id: "asc" },
        })),
      );
    }
    if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id))) throw iamAccountDenied();
    return rows;
  }
}
