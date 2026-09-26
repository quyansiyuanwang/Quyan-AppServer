import type { AIRequestLog, Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type { AIRequestLogListItem, AIRequestLogQuery, AIRequestLogStore } from "./ai-request-log.store";

export class AIRequestLogRepository implements AIRequestLogStore {
  private static instance: AIRequestLogRepository;

  public static getInstance(): AIRequestLogRepository {
    if (!this.instance) this.instance = new AIRequestLogRepository();
    return this.instance;
  }

  public async create(input: Prisma.AIRequestLogUncheckedCreateInput): Promise<AIRequestLog | null> {
    try {
      return await prisma.aIRequestLog.create({ data: input });
    } catch (error: any) {
      if (error?.code === "P2002") return null;
      throw error;
    }
  }

  public async query(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItem[]; total: number }> {
    const where = this.buildWhere(query);
    const [items, total] = await Promise.all([
      prisma.aIRequestLog.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          createTime: true,
          updateTime: true,
          requestId: true,
          userId: true,
          username: true,
          relayTokenId: true,
          relayTokenName: true,
          model: true,
          requestFormat: true,
          path: true,
          method: true,
          statusCode: true,
          ipAddress: true,
          userAgent: true,
          durationMs: true,
          requestSizeBytes: true,
          responseSizeBytes: true,
          requestTruncated: true,
          responseTruncated: true,
        },
      }),
      prisma.aIRequestLog.count({ where }),
    ]);
    return { items, total };
  }

  public findById(id: string): Promise<AIRequestLog | null> {
    return prisma.aIRequestLog.findFirst({ where: { id, status: 1 } });
  }

  private buildWhere(query: AIRequestLogQuery): Prisma.AIRequestLogWhereInput {
    const where: any = { status: 1 };
    if (query.user?.trim())
      where.OR = [{ userId: { contains: query.user.trim() } }, { username: { contains: query.user.trim() } }];
    if (query.relayToken?.trim())
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { relayTokenId: { contains: query.relayToken.trim() } },
            { relayTokenName: { contains: query.relayToken.trim() } },
          ],
        },
      ];
    if (query.model?.trim()) where.model = { contains: query.model.trim() };
    if (query.requestFormat?.trim()) where.requestFormat = query.requestFormat.trim();
    if (query.statusCode !== undefined) where.statusCode = query.statusCode;
    if (query.requestId?.trim()) where.requestId = { contains: query.requestId.trim() };
    if (query.truncated === true)
      where.AND = [...(where.AND || []), { OR: [{ requestTruncated: true }, { responseTruncated: true }] }];
    else if (query.truncated === false)
      where.AND = [...(where.AND || []), { requestTruncated: false, responseTruncated: false }];
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { requestId: { contains: keyword } },
            { requestBody: { string_contains: keyword } },
            { responseBody: { string_contains: keyword } },
          ],
        },
      ];
    }
    if (query.startDate || query.endDate)
      where.createTime = {
        ...(query.startDate ? { gte: query.startDate } : {}),
        ...(query.endDate ? { lte: query.endDate } : {}),
      };
    return where;
  }
}
