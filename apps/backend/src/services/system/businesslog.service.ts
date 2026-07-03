import { BusinessLogRepository, CreateBusinessLogParams, QueryBusinessLogParams } from "@/store/system/businesslog";
import {
  ALL_OPERATION_CATEGORIES,
  ALL_OPERATION_TYPES,
  OperationType,
  OperationCategory,
} from "@/constant/operation-type";
import { getLogger, LogCategory } from "@/util/logger";
import type { BusinessLog } from "@prisma/client";
import { UserRepository } from "@/store/users/user.repository";
import type { BusinessLogStore } from "@/store/system/businesslog.store";
import type { UserStore } from "@/store/users/user.store";
import type { BusinessLogFilterOptionsResponse, BusinessLogStatsResponse } from "@/api/dto/system/businesslog.dto";

const logger = getLogger("BusinessLogService", LogCategory.BUSINESS);

/**
 * 业务日志操作参数
 */
export interface LogOperationParams {
  operationType: OperationType;
  operationCategory: OperationCategory;
  actorUserId?: string;
  targetUserId?: string;
  targetResourceId?: string;
  targetResourceType?: string;
  description: string;
  changes?: any;
  metadata?: any;
  success: boolean;
  errorMessage?: string;
  requestId?: string;
  ipAddress: string;
  userAgent?: string;
}

/**
 * BusinessLog Service - 单例模式
 * 负责业务日志的业务逻辑
 */
class BusinessLogService {
  private static instance: BusinessLogService;

  private constructor(
    private readonly repository: BusinessLogStore = BusinessLogRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
  ) {}

  /**
   * 获取 BusinessLogService 单例实例
   */
  public static getInstance(): BusinessLogService {
    if (!BusinessLogService.instance) BusinessLogService.instance = new BusinessLogService();

    return BusinessLogService.instance;
  }

  /**
   * 记录业务操作日志
   * 使用 fire-and-forget 模式，日志失败不影响业务操作
   * @param params 操作参数
   */
  public async logOperation(params: LogOperationParams): Promise<void> {
    try {
      const logParams: CreateBusinessLogParams = {
        operationType: params.operationType,
        operationCategory: params.operationCategory,
        actorUserId: params.actorUserId,
        targetUserId: params.targetUserId,
        targetResourceId: params.targetResourceId,
        targetResourceType: params.targetResourceType,
        description: params.description,
        changes: params.changes,
        metadata: params.metadata,
        success: params.success,
        errorMessage: params.errorMessage,
        requestId: params.requestId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      };

      await this.repository.create(logParams);
    } catch (error) {
      // 日志失败不应该影响业务操作，只记录错误
      logger.error("Failed to create business log", { error, params });
    }
  }

  /**
   * 获取业务日志列表
   * @param page 页码
   * @param pageSize 每页数量
   * @param filters 过滤条件
   * @returns 日志列表和总数
   */
  public async getLogs(
    page: number,
    pageSize: number,
    filters?: {
      operationType?: OperationType;
      operationCategory?: OperationCategory;
      actorUserId?: string;
      actor?: string;
      targetUserId?: string;
      target?: string;
      startDate?: Date;
      endDate?: Date;
      success?: boolean;
      ip?: string;
    },
  ) {
    const params: QueryBusinessLogParams = {
      page,
      pageSize,
      ...filters,
    };

    const result = await this.repository.query(params);

    // Batch fetch usernames for actorUserId and targetUserId
    const actorUserIds = [...new Set(result.logs.filter((log) => log.actorUserId).map((log) => log.actorUserId!))];
    const targetUserIds = [...new Set(result.logs.filter((log) => log.targetUserId).map((log) => log.targetUserId!))];
    const allUserIds = [...new Set([...actorUserIds, ...targetUserIds])];

    const usernameMap = new Map<string, string>();
    if (allUserIds.length > 0) {
      const users = await this.userRepository.findUsernamesByIds(allUserIds);
      users.forEach((user) => usernameMap.set(user.id, user.username));
    }

    // Attach usernames to logs
    const logsWithUsernames = result.logs.map((log) => ({
      ...log,
      actorUsername: log.actorUserId ? usernameMap.get(log.actorUserId) || null : null,
      targetUsername: log.targetUserId ? usernameMap.get(log.targetUserId) || null : null,
    }));

    return {
      logs: logsWithUsernames,
      total: result.total,
    };
  }

  /**
   * 获取业务日志筛选项
   */
  public getFilterOptions(): BusinessLogFilterOptionsResponse {
    return {
      operationTypes: ALL_OPERATION_TYPES,
      operationCategories: ALL_OPERATION_CATEGORIES,
    };
  }

  public async getStats(filters?: {
    operationType?: OperationType;
    operationCategory?: OperationCategory;
    actorUserId?: string;
    actor?: string;
    targetUserId?: string;
    target?: string;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    ip?: string;
  }): Promise<BusinessLogStatsResponse> {
    const rows = await this.repository.listForStats({
      operationType: filters?.operationType,
      operationCategory: filters?.operationCategory,
      actorUserId: filters?.actorUserId,
      actor: filters?.actor,
      targetUserId: filters?.targetUserId,
      target: filters?.target,
      startDate: filters?.startDate,
      endDate: filters?.endDate,
      success: filters?.success,
      ip: filters?.ip,
    });

    const summary = {
      totalLogs: 0,
      successLogs: 0,
      failedLogs: 0,
      uniqueActors: new Set<string>(),
      systemTriggeredLogs: 0,
      uniqueTargets: new Set<string>(),
      uniqueIPs: new Set<string>(),
    };
    const dailyMap = new Map<string, { date: string; totalLogs: number; successLogs: number; failedLogs: number }>();
    const typeMap = new Map<string, number>();
    const categoryMap = new Map<string, number>();
    const successMap = new Map<string, number>();
    const typeDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();
    const categoryDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();

    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const row of rows) {
      const createTime = new Date(row.createTime);
      const dateKey = createTime.toISOString().slice(0, 10);
      const typeKey = row.operationType || "UNKNOWN";
      const categoryKey = row.operationCategory || "UNKNOWN";
      const successKey = row.success ? "success" : "failed";

      summary.totalLogs += 1;
      if (row.success) summary.successLogs += 1;
      else summary.failedLogs += 1;
      if (row.actorUserId) summary.uniqueActors.add(row.actorUserId);
      else summary.systemTriggeredLogs += 1;
      if (row.targetUserId) summary.uniqueTargets.add(row.targetUserId);
      if (row.ipAddress) summary.uniqueIPs.add(row.ipAddress);

      const daily = dailyMap.get(dateKey) || {
        date: dateKey,
        totalLogs: 0,
        successLogs: 0,
        failedLogs: 0,
      };
      daily.totalLogs += 1;
      if (row.success) daily.successLogs += 1;
      else daily.failedLogs += 1;
      dailyMap.set(dateKey, daily);

      typeMap.set(typeKey, (typeMap.get(typeKey) || 0) + 1);
      categoryMap.set(categoryKey, (categoryMap.get(categoryKey) || 0) + 1);
      successMap.set(successKey, (successMap.get(successKey) || 0) + 1);

      const typeDailyComposite = `${dateKey}::${typeKey}`;
      const typeDaily = typeDailyMap.get(typeDailyComposite) || {
        date: dateKey,
        key: typeKey,
        label: typeKey,
        count: 0,
      };
      typeDaily.count += 1;
      typeDailyMap.set(typeDailyComposite, typeDaily);

      const categoryDailyComposite = `${dateKey}::${categoryKey}`;
      const categoryDaily = categoryDailyMap.get(categoryDailyComposite) || {
        date: dateKey,
        key: categoryKey,
        label: categoryKey,
        count: 0,
      };
      categoryDaily.count += 1;
      categoryDailyMap.set(categoryDailyComposite, categoryDaily);

      if (!minDate || createTime < minDate) minDate = createTime;
      if (!maxDate || createTime > maxDate) maxDate = createTime;
    }

    const totalLogs = summary.totalLogs;
    const finalizeBreakdown = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([key, count]) => ({
          key,
          label: key,
          count,
          share: totalLogs > 0 ? Math.round((count / totalLogs) * 10000) / 100 : 0,
        }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.label.localeCompare(b.label);
        });

    const resolvedStart = filters?.startDate
      ? new Date(new Date(filters.startDate).setHours(0, 0, 0, 0))
      : minDate
        ? new Date(new Date(minDate).setHours(0, 0, 0, 0))
        : new Date(new Date().setHours(0, 0, 0, 0));
    const resolvedEnd = filters?.endDate
      ? new Date(new Date(filters.endDate).setHours(23, 59, 59, 999))
      : maxDate
        ? new Date(new Date(maxDate).setHours(23, 59, 59, 999))
        : new Date(new Date().setHours(23, 59, 59, 999));

    return {
      range: {
        startDate: resolvedStart.toISOString(),
        endDate: resolvedEnd.toISOString(),
        days: Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / (24 * 60 * 60 * 1000)) + 1),
      },
      summary: {
        totalLogs: summary.totalLogs,
        successLogs: summary.successLogs,
        failedLogs: summary.failedLogs,
        uniqueActors: summary.uniqueActors.size,
        systemTriggeredLogs: summary.systemTriggeredLogs,
        uniqueTargets: summary.uniqueTargets.size,
        uniqueIPs: summary.uniqueIPs.size,
      },
      daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byOperationType: finalizeBreakdown(typeMap),
      byOperationCategory: finalizeBreakdown(categoryMap),
      bySuccess: finalizeBreakdown(successMap).map((item) => ({
        ...item,
        label: item.key === "success" ? "success" : "failed",
      })),
      operationTypeDailyDistribution: [...typeDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      categoryDailyDistribution: [...categoryDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 根据 ID 获取业务日志
   * @param id 日志 ID
   * @returns 日志记录或 null
   */
  public async getLogById(id: string): Promise<BusinessLog | null> {
    return this.repository.findById(id);
  }

  /**
   * 清理旧日志
   * @param daysToKeep 保留天数
   * @returns 删除的记录数量
   */
  public async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    return this.repository.deleteOldLogs(daysToKeep);
  }
}

export default BusinessLogService;
