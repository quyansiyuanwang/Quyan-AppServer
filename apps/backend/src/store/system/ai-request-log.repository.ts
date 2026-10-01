import { Prisma, type AIRequestLog } from "@prisma/client";
import { prisma } from "@/config/database";
import type { AIRequestLogContentSide } from "@/api/dto/relay/ai-request-log.dto";
import type {
  AIRequestLogListItem,
  AIRequestLogMetadata,
  AIRequestLogPayload,
  AIRequestLogQuery,
  AIRequestLogStore,
} from "./ai-request-log.store";

export const AI_REQUEST_LOG_METADATA_SELECT = {
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
  isStreaming: true,
  authenticationState: true,
  outcome: true,
  failureStage: true,
  errorCode: true,
  errorSummary: true,
  bodyOmissionReason: true,
  attemptsTruncated: true,
} as const satisfies Prisma.AIRequestLogSelect;
// Only source-controlled column names enter SQL identifiers; all user values are bound parameters.
const metadataColumns = Prisma.raw(
  Object.keys(AI_REQUEST_LOG_METADATA_SELECT)
    .map((key) => "\x60" + key + "\x60")
    .join(", "),
);
function literalPattern(value: string): string {
  return "%" + value.replace(/[=%_]/g, "=$&") + "%";
}
export class AIRequestLogRepository implements AIRequestLogStore {
  private static instance: AIRequestLogRepository;
  public static getInstance(): AIRequestLogRepository {
    return (this.instance ??= new AIRequestLogRepository());
  }
  public async create(input: Prisma.AIRequestLogUncheckedCreateInput): Promise<AIRequestLog | null> {
    try {
      return await prisma.aIRequestLog.create({ data: input });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") return null;
      throw error;
    }
  }
  public async updateByRequestId(requestId: string, data: Prisma.AIRequestLogUpdateManyMutationInput): Promise<void> {
    await prisma.aIRequestLog.updateMany({ where: { requestId, status: 1 }, data });
  }
  public async query(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItem[]; total: number }> {
    if (query.keyword?.trim()) return this.queryKeyword(query);
    const where = this.buildWhere(query);
    const [items, total] = await Promise.all([
      prisma.aIRequestLog.findMany({
        where,
        orderBy: [{ createTime: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: AI_REQUEST_LOG_METADATA_SELECT,
      }),
      prisma.aIRequestLog.count({ where }),
    ]);
    return { items, total };
  }
  public findById(id: string): Promise<AIRequestLog | null> {
    return prisma.aIRequestLog.findFirst({ where: { id, status: 1 } });
  }
  public async findMetadata(id: string): Promise<AIRequestLogMetadata | null> {
    const rows = await prisma.$queryRaw<AIRequestLogMetadata[]>(
      Prisma.sql`SELECT ${metadataColumns}, (requestBody IS NOT NULL AND JSON_TYPE(requestBody) <> 'NULL') AS hasRequestBody, (responseBody IS NOT NULL AND JSON_TYPE(responseBody) <> 'NULL') AS hasResponseBody FROM ai_request_logs WHERE id = ${id} AND status = 1 LIMIT 1`,
    );
    return rows[0] ?? null;
  }
  public async findPayload(id: string, side: AIRequestLogContentSide): Promise<AIRequestLogPayload | null> {
    const row = await prisma.aIRequestLog.findFirst({
      where: { id, status: 1 },
      select: {
        requestTruncated: true,
        responseTruncated: true,
        bodyOmissionReason: true,
        ...(side === "request" ? { requestBody: true } : { responseBody: true }),
      },
    });
    return row ? { requestBody: null, responseBody: null, ...row } : null;
  }
  public findAttempts(id: string): Promise<Pick<AIRequestLog, "attempts" | "attemptsTruncated"> | null> {
    return prisma.aIRequestLog.findFirst({
      where: { id, status: 1 },
      select: { attempts: true, attemptsTruncated: true },
    });
  }
  private buildWhere(query: AIRequestLogQuery): Prisma.AIRequestLogWhereInput {
    const clauses: Prisma.AIRequestLogWhereInput[] = [];
    if (query.user?.trim())
      clauses.push({
        OR: [{ userId: { contains: query.user.trim() } }, { username: { contains: query.user.trim() } }],
      });
    if (query.relayToken?.trim())
      clauses.push({
        OR: [
          { relayTokenId: { contains: query.relayToken.trim() } },
          { relayTokenName: { contains: query.relayToken.trim() } },
        ],
      });
    if (query.truncated === true) clauses.push({ OR: [{ requestTruncated: true }, { responseTruncated: true }] });
    else if (query.truncated === false) clauses.push({ requestTruncated: false, responseTruncated: false });
    return {
      status: 1,
      ...(clauses.length ? { AND: clauses } : {}),
      ...(query.model?.trim() ? { model: { contains: query.model.trim() } } : {}),
      ...(query.requestFormat?.trim() ? { requestFormat: query.requestFormat.trim() } : {}),
      ...(query.requestId?.trim() ? { requestId: { contains: query.requestId.trim() } } : {}),
      ...(query.ipAddress?.trim() ? { ipAddress: { contains: query.ipAddress.trim() } } : {}),
      ...(query.statusCode !== undefined ? { statusCode: query.statusCode } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.failureStage ? { failureStage: query.failureStage } : {}),
      ...(query.bodyOmissionReason ? { bodyOmissionReason: query.bodyOmissionReason } : {}),
      ...(query.isStreaming !== undefined ? { isStreaming: query.isStreaming } : {}),
      ...(query.minDurationMs !== undefined || query.maxDurationMs !== undefined
        ? { durationMs: { gte: query.minDurationMs, lte: query.maxDurationMs } }
        : {}),
      ...(query.startDate || query.endDate ? { createTime: { gte: query.startDate, lte: query.endDate } } : {}),
    };
  }
  private async queryKeyword(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItem[]; total: number }> {
    const clauses: Prisma.Sql[] = [Prisma.sql`status = 1`];
    const like = (column: string, value: string) =>
      Prisma.sql`${Prisma.raw("\x60" + column + "\x60")} LIKE ${literalPattern(value)} ESCAPE '='`;
    if (query.user?.trim())
      clauses.push(Prisma.sql`(${like("userId", query.user.trim())} OR ${like("username", query.user.trim())})`);
    if (query.relayToken?.trim())
      clauses.push(
        Prisma.sql`(${like("relayTokenId", query.relayToken.trim())} OR ${like("relayTokenName", query.relayToken.trim())})`,
      );
    for (const [column, value] of [
      ["model", query.model],
      ["requestId", query.requestId],
      ["ipAddress", query.ipAddress],
    ])
      if (value?.trim()) clauses.push(like(column!, value.trim()));
    for (const [column, value] of [
      ["requestFormat", query.requestFormat],
      ["statusCode", query.statusCode],
      ["outcome", query.outcome],
      ["failureStage", query.failureStage],
      ["isStreaming", query.isStreaming],
      ["bodyOmissionReason", query.bodyOmissionReason],
    ] as const)
      if (value !== undefined) clauses.push(Prisma.sql`${Prisma.raw("\x60" + column + "\x60")} = ${value}`);
    if (query.startDate) clauses.push(Prisma.sql`createTime >= ${query.startDate}`);
    if (query.endDate) clauses.push(Prisma.sql`createTime <= ${query.endDate}`);
    if (query.minDurationMs !== undefined) clauses.push(Prisma.sql`durationMs >= ${query.minDurationMs}`);
    if (query.maxDurationMs !== undefined) clauses.push(Prisma.sql`durationMs <= ${query.maxDurationMs}`);
    if (query.truncated !== undefined)
      clauses.push(
        query.truncated
          ? Prisma.sql`(requestTruncated = TRUE OR responseTruncated = TRUE)`
          : Prisma.sql`(requestTruncated = FALSE AND responseTruncated = FALSE)`,
      );
    const pattern = literalPattern(query.keyword!.trim());
    const keywordClauses = [
      "requestId",
      "userId",
      "username",
      "relayTokenId",
      "relayTokenName",
      "model",
      "errorCode",
      "errorSummary",
    ].map((column) => like(column, query.keyword!.trim()));
    for (const column of ["requestBody", "responseBody"]) {
      const identifier = Prisma.raw("\x60" + column + "\x60");
      // JSON_SEARCH reaches nested decoded strings (including SSE); CAST also matches keys/numeric values.
      keywordClauses.push(
        Prisma.sql`(JSON_SEARCH(${identifier}, 'one', ${pattern}, '=') IS NOT NULL OR LOWER(CAST(${identifier} AS CHAR)) LIKE LOWER(${pattern}) ESCAPE '=')`,
      );
    }
    clauses.push(Prisma.sql`(${Prisma.join(keywordClauses, " OR ")})`);
    const where = Prisma.join(clauses, " AND ");
    const [items, counts] = await Promise.all([
      prisma.$queryRaw<AIRequestLogListItem[]>(
        Prisma.sql`SELECT ${metadataColumns} FROM ai_request_logs WHERE ${where} ORDER BY createTime DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      ),
      prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*) AS total FROM ai_request_logs WHERE ${where}`,
      ),
    ]);
    return { items, total: Number(counts[0]?.total ?? 0) };
  }
}
