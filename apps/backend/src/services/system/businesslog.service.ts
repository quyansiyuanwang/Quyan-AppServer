import { BusinessLogStatisticsAccumulator } from "./business-log-statistics";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import type { TypedRequest } from "@/types/express";
import { BusinessLogRepository, CreateBusinessLogParams, QueryBusinessLogParams } from "@/store/system/businesslog";
import {
  ALL_OPERATION_CATEGORIES,
  ALL_OPERATION_TYPES,
  OperationType,
  OperationCategory,
} from "@/constant/operation-type";
import { getLogger, LogCategory } from "@/util/logger";
import type { BusinessLog, Prisma } from "@prisma/client";
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
   * 普通调用为 best-effort；传入事务时日志必须与业务变更一起成功或回滚
   * @param params 操作参数
   */
  public async logOperation(params: LogOperationParams, tx?: Prisma.TransactionClient): Promise<void> {
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

      await this.repository.create(logParams, tx);
    } catch (error) {
      if (tx) throw error;
      // 非事务日志失败不应该影响业务操作，只记录错误
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

    return { logs: await this.mapLogListRows(result.logs), total: result.total };
  }
  public async mapLogListRows(rows: readonly BusinessLog[]) {
    // Batch fetch usernames for actorUserId and targetUserId
    const actorUserIds = [...new Set(rows.filter((log) => log.actorUserId).map((log) => log.actorUserId!))];
    const targetUserIds = [...new Set(rows.filter((log) => log.targetUserId).map((log) => log.targetUserId!))];
    const allUserIds = [...new Set([...actorUserIds, ...targetUserIds])];

    const usernameMap = new Map<string, string>();
    if (allUserIds.length > 0) {
      const users = await this.userRepository.findUsernamesByIds(allUserIds);
      users.forEach((user) => usernameMap.set(user.id, user.username));
    }

    // Attach usernames to logs
    const logsWithUsernames = rows.map((log) => ({
      ...log,
      actorUsername: log.actorUserId ? usernameMap.get(log.actorUserId) || null : null,
      targetUsername: log.targetUserId ? usernameMap.get(log.targetUserId) || null : null,
    }));

    return logsWithUsernames;
  }

  /**
   * 获取业务日志筛选项
   */
  public async getAuthorizedFilterOptions(request: TypedRequest): Promise<BusinessLogFilterOptionsResponse> {
    // PermissionService records business logs during singleton initialization. Resolve its read guard after initialization.
    const { PlatformManagementReadIamService } = await import("./platform-management-read-iam.service");
    return PlatformManagementReadIamService.getInstance().read(
      "quyan:system:business_log:GetFilterOptions",
      platformSystemArn("business-log-options"),
      request,
      async () => this.getFilterOptions(),
    );
  }

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

    const accumulator = new BusinessLogStatisticsAccumulator(filters);
    for (const row of rows) accumulator.add(row);
    return accumulator.result();
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
