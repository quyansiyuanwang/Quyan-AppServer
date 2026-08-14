import { prisma } from "@/config/database";
import type { SupportAiAnalyticsDto, SupportAiAnalyticsQueryDto } from "@/api/dto/support/support.dto";

export class SupportAiUsageRepository {
  private static instance: SupportAiUsageRepository;

  static getInstance() {
    if (!this.instance) this.instance = new SupportAiUsageRepository();
    return this.instance;
  }

  async create(data: {
    userId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    durationMs?: number;
  }) {
    return prisma.supportAiUsageRecord.create({ data: { ...data, totalTokens: data.inputTokens + data.outputTokens } });
  }

  async getAnalytics(query: SupportAiAnalyticsQueryDto): Promise<SupportAiAnalyticsDto> {
    const endAt = query.endAt ? new Date(query.endAt) : new Date();
    const requestedStartAt = query.startAt ? new Date(query.startAt) : new Date(endAt.getTime() - 30 * 86400000);
    if (Number.isNaN(endAt.getTime()) || Number.isNaN(requestedStartAt.getTime()) || requestedStartAt > endAt)
      throw new Error("Support analytics date range is invalid");
    const startAt = new Date(Math.max(requestedStartAt.getTime(), endAt.getTime() - 90 * 86400000));
    const page = Math.max(1, Math.floor(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize || 20)));
    const where = { createTime: { gte: startAt, lte: endAt }, ...(query.userId ? { userId: query.userId } : {}) };
    const [records, groupedUsers, allUserGroups] = await Promise.all([
      prisma.supportAiUsageRecord.findMany({
        where,
        select: {
          userId: true,
          createTime: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
      }),
      prisma.supportAiUsageRecord.groupBy({
        by: ["userId"],
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _max: { createTime: true },
        orderBy: { _sum: { totalTokens: "desc" } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.supportAiUsageRecord.groupBy({ by: ["userId"], where }),
    ]);
    const users = await prisma.user.findMany({
      where: { id: { in: groupedUsers.map((item) => item.userId) } },
      select: { id: true, username: true },
    });
    const usernames = new Map(users.map((user) => [user.id, user.username]));
    const trends = new Map<string, any>();
    for (const record of records) {
      const date = record.createTime.toISOString().slice(0, 10);
      const trend = trends.get(date) ?? {
        date,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      };
      trend.requestCount += 1;
      trend.inputTokens += record.inputTokens;
      trend.outputTokens += record.outputTokens;
      trend.totalTokens += record.totalTokens;
      trend.estimatedCost += Number(record.estimatedCost);
      trends.set(date, trend);
    }
    const totals = records.reduce(
      (total, record) => ({
        totalRequests: total.totalRequests + 1,
        totalInputTokens: total.totalInputTokens + record.inputTokens,
        totalOutputTokens: total.totalOutputTokens + record.outputTokens,
        totalTokens: total.totalTokens + record.totalTokens,
        totalEstimatedCost: total.totalEstimatedCost + Number(record.estimatedCost),
      }),
      { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalEstimatedCost: 0 },
    );
    return {
      ...totals,
      trends: [...trends.values()].sort((left, right) => left.date.localeCompare(right.date)),
      users: groupedUsers.map((item) => ({
        userId: item.userId,
        username: usernames.get(item.userId) ?? item.userId,
        requestCount: item._count._all,
        inputTokens: item._sum.inputTokens ?? 0,
        outputTokens: item._sum.outputTokens ?? 0,
        totalTokens: item._sum.totalTokens ?? 0,
        estimatedCost: Number(item._sum.estimatedCost ?? 0),
        lastRequestAt: item._max.createTime ?? startAt,
      })),
      totalUsers: allUserGroups.length,
    };
  }
}
