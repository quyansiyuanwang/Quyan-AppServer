import { BusinessLog, Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { getLogger, LogCategory } from "@/util/logger";
import type { OperationType } from "@/constant/operation-type";
import type {
  BusinessLogStore,
  CreateBusinessLogParams,
  QueryBusinessLogParams,
  QueryBusinessLogResult,
} from "./system/businesslog.store";
import { RECORD_STATUS } from "@/constant/status";

const logger = getLogger("BusinessLogRepository", LogCategory.STORAGE);

export type {
  CreateBusinessLogParams,
  QueryBusinessLogParams,
  QueryBusinessLogResult,
} from "./system/businesslog.store";

/**
 * BusinessLog Repository - 单例模式
 * 负责业务日志的数据库操作
 */
export class BusinessLogRepository implements BusinessLogStore {
  private static instance: BusinessLogRepository;

  private async buildWhere(
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
      const actors = await prisma.user.findMany({
        where: {
          OR: [{ username: { contains: actor } }, { id: actor }],
          status: RECORD_STATUS.ACTIVE,
        },
        select: { id: true },
        take: 100,
      });
      const actorUserIds = actors.map((u) => u.id);
      if (actorUserIds.length === 0) return null;

      if (where.actorUserId) {
        if (!actorUserIds.includes(where.actorUserId as string)) return null;
      } else where.actorUserId = { in: actorUserIds };
    }

    if (target) {
      const targets = await prisma.user.findMany({
        where: {
          OR: [{ username: { contains: target } }, { id: target }],
          status: RECORD_STATUS.ACTIVE,
        },
        select: { id: true },
        take: 100,
      });
      const targetUserIds = targets.map((u) => u.id);
      if (targetUserIds.length === 0) return null;

      if (where.targetUserId) {
        if (!targetUserIds.includes(where.targetUserId as string)) return null;
      } else where.targetUserId = { in: targetUserIds };
    }

    return where;
  }

  /**
   * 获取 BusinessLogRepository 单例实例
   */
  public static getInstance(): BusinessLogRepository {
    if (!BusinessLogRepository.instance) BusinessLogRepository.instance = new BusinessLogRepository();

    return BusinessLogRepository.instance;
  }

  /**
   * 创建业务日志记录
   * @param params 日志参数
   * @returns 创建的日志记录
   */
  public async create(params: CreateBusinessLogParams): Promise<BusinessLog> {
    try {
      const log = await prisma.businessLog.create({
        data: {
          operationType: params.operationType,
          operationCategory: params.operationCategory,
          actorUserId: params.actorUserId || null,
          targetUserId: params.targetUserId || null,
          targetResourceId: params.targetResourceId || null,
          targetResourceType: params.targetResourceType || null,
          description: params.description,
          changes: params.changes || null,
          metadata: params.metadata || null,
          success: params.success,
          errorMessage: params.errorMessage || null,
          requestId: params.requestId || null,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent || null,
        },
      });
      return log;
    } catch (error) {
      logger.error("Failed to create business log", { error, params });
      throw error;
    }
  }

  /**
   * 查询业务日志（带分页）
   * @param params 查询参数
   * @returns 日志记录和总数
   */
  public async query(params: QueryBusinessLogParams): Promise<QueryBusinessLogResult> {
    try {
      const { page, pageSize } = params;
      const skip = (page - 1) * pageSize;
      const where = await this.buildWhere(params);
      if (!where) return { logs: [], total: 0 };

      const [logs, total] = await Promise.all([
        prisma.businessLog.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { createTime: "desc" },
        }),
        prisma.businessLog.count({ where }),
      ]);

      return { logs, total };
    } catch (error) {
      logger.error("Failed to query business logs", { error, params });
      throw error;
    }
  }

  public async listForStats(
    params: Omit<QueryBusinessLogParams, "page" | "pageSize">,
  ): Promise<import("./system/businesslog.store").BusinessLogStatsRow[]> {
    try {
      const where = await this.buildWhere(params);
      if (!where) return [];

      return prisma.businessLog.findMany({
        where,
        orderBy: { createTime: "asc" },
        select: {
          createTime: true,
          operationType: true,
          operationCategory: true,
          actorUserId: true,
          targetUserId: true,
          success: true,
          ipAddress: true,
        },
      });
    } catch (error) {
      logger.error("Failed to list business logs for stats", { error, params });
      throw error;
    }
  }

  /**
   * 根据 ID 获取业务日志
   * @param id 日志 ID
   * @returns 日志记录或 null
   */
  public async findById(id: string): Promise<BusinessLog | null> {
    try {
      return await prisma.businessLog.findUnique({
        where: { id, status: RECORD_STATUS.ACTIVE },
      });
    } catch (error) {
      logger.error("Failed to find business log by ID", { error, id });
      throw error;
    }
  }

  /**
   * 根据 where 条件查询首条业务日志
   */
  public async findFirst(where: Prisma.BusinessLogWhereInput): Promise<BusinessLog | null> {
    try {
      return await prisma.businessLog.findFirst({ where });
    } catch (error) {
      logger.error("Failed to find business log by where", { error, where });
      throw error;
    }
  }

  public async findMany(
    where: Prisma.BusinessLogWhereInput,
    options?: {
      orderBy?: Prisma.BusinessLogOrderByWithRelationInput | Prisma.BusinessLogOrderByWithRelationInput[];
      skip?: number;
      take?: number;
    },
  ): Promise<BusinessLog[]> {
    try {
      return await prisma.businessLog.findMany({
        where,
        orderBy: options?.orderBy,
        skip: options?.skip,
        take: options?.take,
      });
    } catch (error) {
      logger.error("Failed to find many business logs", { error, where, options });
      throw error;
    }
  }

  public async count(where: Prisma.BusinessLogWhereInput): Promise<number> {
    try {
      return await prisma.businessLog.count({ where });
    } catch (error) {
      logger.error("Failed to count business logs", { error, where });
      throw error;
    }
  }

  /**
   * 查询用户在指定时间后的最近一次成功操作
   */
  public async findRecentSuccessfulOperation(
    actorUserId: string,
    operationType: OperationType,
    since: Date,
  ): Promise<BusinessLog | null> {
    return this.findFirst({
      status: RECORD_STATUS.ACTIVE,
      actorUserId,
      operationType,
      success: true,
      createTime: { gte: since },
    });
  }

  /**
   * 删除旧的业务日志（用于定期清理）
   * @param daysToKeep 保留天数
   * @returns 删除的记录数量
   */
  public async deleteOldLogs(daysToKeep: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.businessLog.deleteMany({
        where: {
          createTime: {
            lt: cutoffDate,
          },
        },
      });

      logger.info(`Deleted ${result.count} old business logs`, { daysToKeep, cutoffDate });
      return result.count;
    } catch (error) {
      logger.error("Failed to delete old business logs", { error, daysToKeep });
      throw error;
    }
  }
}
