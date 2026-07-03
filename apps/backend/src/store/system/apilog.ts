import { APILog } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";
import type {
  APILogStore,
  CreateAPILogParams,
  QueryAPILogParams,
  APILogWithoutResponse,
  APILogStatsRow,
} from "./apilog.store";
import { RECORD_STATUS } from "@/constant/status";

/**
 * APILog without the response field (used for list queries)
 */
export type { APILogWithoutResponse, CreateAPILogParams, QueryAPILogParams } from "./apilog.store";

const logger = getLogger("APILogRepository", LogCategory.STORAGE);

/**
 * APILog Repository - 单例模式
 * 负责 API 日志的数据库操作
 */
export class APILogRepository implements APILogStore {
  private async buildWhere(params: QueryAPILogParams): Promise<any> {
    const where: any = { status: RECORD_STATUS.ACTIVE };

    if (params.user) {
      const users = await prisma.user.findMany({
        where: {
          OR: [{ username: { contains: params.user } }, { id: params.user }],
          status: RECORD_STATUS.ACTIVE,
        },
        select: { id: true },
        take: 100,
      });

      const userIDs = users.map((u) => u.id);
      if (userIDs.length === 0) return { impossible: true };

      where.userID = { in: userIDs };
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
      if (Array.isArray(params.method)) where.method = params.method.length > 0 ? { in: params.method } : undefined;
      else where.method = params.method;

    if (params.statusCode)
      if (Array.isArray(params.statusCode))
        where.statusCode = params.statusCode.length > 0 ? { in: params.statusCode } : undefined;
      else where.statusCode = params.statusCode;

    if (params.startDate || params.endDate) {
      where.createTime = {};
      if (params.startDate) where.createTime.gte = params.startDate;
      if (params.endDate) where.createTime.lte = params.endDate;
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.createTime = { gte: thirtyDaysAgo };
    }

    return where;
  }

  private static instance: APILogRepository;

  /**
   * 获取 APILogRepository 单例实例
   */
  public static getInstance(): APILogRepository {
    if (!APILogRepository.instance) APILogRepository.instance = new APILogRepository();

    return APILogRepository.instance;
  }

  /**
   * 创建 API 日志记录
   * @param params 日志参数
   * @returns 创建的日志记录
   */
  public async create(params: CreateAPILogParams): Promise<APILog> {
    try {
      const log = await prisma.aPILog.create({
        data: {
          requestID: params.requestID,
          userID: params.userID,
          path: params.path,
          method: params.method,
          queryParams: params.queryParams,
          bodyParams: params.bodyParams,
          requestHeaders: params.requestHeaders,
          ipAddress: params.ipAddress,
          response: params.response,
          responseHeaders: params.responseHeaders,
          statusCode: params.statusCode,
        },
      });
      return log;
    } catch (error: any) {
      // Handle unique constraint violation on requestID (P2002)
      // This happens when upstream clients reuse the same x-request-id across multiple requests
      if (error?.code === "P2002" && error?.meta?.target === "api_logs_requestID_key") {
        const uniqueRequestID = `${params.requestID}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        return prisma.aPILog.create({
          data: {
            requestID: uniqueRequestID,
            userID: params.userID,
            path: params.path,
            method: params.method,
            queryParams: params.queryParams,
            bodyParams: params.bodyParams,
            requestHeaders: params.requestHeaders,
            ipAddress: params.ipAddress,
            response: params.response,
            responseHeaders: params.responseHeaders,
            statusCode: params.statusCode,
          },
        });
      }
      logger.error("Failed to create API log", { error, params });
      throw error;
    }
  }

  /**
   * 批量创建 API 日志记录（用于性能优化）
   * @param paramsArray 日志参数数组
   * @returns 创建的日志记录数量
   */
  public async createMany(paramsArray: CreateAPILogParams[]): Promise<number> {
    try {
      const result = await prisma.aPILog.createMany({
        data: paramsArray.map((params) => ({
          requestID: params.requestID,
          userID: params.userID,
          path: params.path,
          method: params.method,
          queryParams: params.queryParams,
          bodyParams: params.bodyParams,
          requestHeaders: params.requestHeaders,
          ipAddress: params.ipAddress,
          response: params.response,
          responseHeaders: params.responseHeaders,
          statusCode: params.statusCode,
        })),
        skipDuplicates: true, // 忽略 requestID 重复冲突，而非报错
      });

      // 如果实际写入数少于提交数，说明有重复 requestID 被跳过，记录告警以便排查
      if (result.count < paramsArray.length)
        logger.warn("API log batch had duplicate requestIDs skipped", {
          submitted: paramsArray.length,
          written: result.count,
          skipped: paramsArray.length - result.count,
        });

      return result.count;
    } catch (error) {
      logger.error("Failed to create API logs in batch", { error, count: paramsArray.length });
      throw error;
    }
  }

  /**
   * 查询 API 日志
   * @param params 查询参数
   * @returns 日志记录和总数
   */
  public async query(params: QueryAPILogParams): Promise<{ logs: APILogWithoutResponse[]; total: number }> {
    try {
      const where = await this.buildWhere(params);
      if (where.impossible) return { logs: [], total: 0 };

      const [logs, total] = await Promise.all([
        prisma.aPILog.findMany({
          where,
          orderBy: { createTime: "desc" },
          take: params.limit || 100,
          skip: params.offset || 0,
          select: {
            id: true,
            status: true,
            createTime: true,
            updateTime: true,
            requestID: true,
            userID: true,
            path: true,
            method: true,
            queryParams: true,
            bodyParams: true,
            requestHeaders: true,
            ipAddress: true,
            statusCode: true,
          },
        }),
        prisma.aPILog.count({ where }),
      ]);

      return { logs, total };
    } catch (error) {
      logger.error("Failed to query API logs", { error, params });
      throw error;
    }
  }

  public async listForStats(params: QueryAPILogParams): Promise<APILogStatsRow[]> {
    try {
      const where = await this.buildWhere(params);
      if (where.impossible) return [];

      return prisma.aPILog.findMany({
        where,
        orderBy: { createTime: "asc" },
        select: {
          createTime: true,
          userID: true,
          method: true,
          path: true,
          statusCode: true,
          ipAddress: true,
        },
      });
    } catch (error) {
      logger.error("Failed to list API logs for stats", { error, params });
      throw error;
    }
  }

  /**
   * 根据 ID 查询单条 API 日志（含 response 字段）
   * @param id 日志 ID
   * @returns 完整的日志记录或 null
   */
  public async findById(id: string): Promise<APILog | null> {
    try {
      return await prisma.aPILog.findFirst({
        where: { id, status: RECORD_STATUS.ACTIVE },
      });
    } catch (error) {
      logger.error("Failed to find API log by ID", { error, id });
      throw error;
    }
  }

  /**
   * 删除旧的 API 日志（用于定期清理）
   * @param daysToKeep 保留天数
   * @returns 删除的记录数量
   */
  public async deleteOldLogs(daysToKeep: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.aPILog.deleteMany({
        where: {
          createTime: {
            lt: cutoffDate,
          },
        },
      });

      logger.info(`Deleted ${result.count} old API logs`, { daysToKeep, cutoffDate });
      return result.count;
    } catch (error) {
      logger.error("Failed to delete old API logs", { error, daysToKeep });
      throw error;
    }
  }
}
