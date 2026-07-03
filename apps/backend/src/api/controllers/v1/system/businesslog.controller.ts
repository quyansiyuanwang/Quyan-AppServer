import {
  Get,
  Route,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Query,
  Security,
  Request,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import BusinessLogService from "@/services/system/businesslog.service";
import type {
  BusinessLogFilterOptionsResponse,
  BusinessLogListResponse,
  BusinessLogStatsResponse,
} from "@/api/dto/system/businesslog.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import type { ErrorResponse } from "@/api/response";
import { businessLogsQuerySchema, businessLogStatsQuerySchema } from "@/api/schema/system/businesslog.schema";
import { validateQuery } from "@/middleware/validation";
import { OperationCategory, OperationType } from "@/constant/operation-type";

@Route("v1/business-logs")
@Tags("BusinessLog")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class BusinessLogController extends Controller {
  private service = BusinessLogService.getInstance();

  /**
   * 获取业务日志筛选项
   */
  @Get("/options")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.SYSTEM_BUSINESS_LOG_READ)
  public async getBusinessLogFilterOptions(): Promise<BusinessLogFilterOptionsResponse> {
    return this.service.getFilterOptions();
  }

  @Get("/stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.SYSTEM_BUSINESS_LOG_READ)
  @Middlewares(validateQuery(businessLogStatsQuerySchema))
  public async getBusinessLogStats(
    @Query() operationType?: OperationType,
    @Query() operationCategory?: OperationCategory,
    @Query() actorUserId?: string,
    @Query() actor?: string,
    @Query() targetUserId?: string,
    @Query() target?: string,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() success?: boolean,
    @Query() ip?: string,
  ): Promise<BusinessLogStatsResponse> {
    return this.service.getStats({
      operationType,
      operationCategory,
      actorUserId,
      actor,
      targetUserId,
      target,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      success,
      ip,
    });
  }

  /**
   * 获取业务日志列表
   * @param page 页码（从 1 开始）
   * @param pageSize 每页数量
   * @param operationType 操作类型过滤
   * @param operationCategory 操作类别过滤
   * @param actorUserId 操作者用户 ID 过滤
   * @param actor 操作者统一搜索（支持用户名或用户 ID）
   * @param targetUserId 目标用户 ID 过滤
   * @param target 目标统一搜索（支持用户名或用户 ID）
   * @param startDate 开始时间
   * @param endDate 结束时间
   * @param success 成功状态过滤
   * @param ip IP 地址过滤
   */
  @Get("/")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.SYSTEM_BUSINESS_LOG_READ)
  @Middlewares(validateQuery(businessLogsQuerySchema))
  public async getBusinessLogs(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() operationType?: OperationType,
    @Query() operationCategory?: OperationCategory,
    @Query() actorUserId?: string,
    @Query() actor?: string,
    @Query() targetUserId?: string,
    @Query() target?: string,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() success?: boolean,
    @Query() ip?: string,
  ): Promise<BusinessLogListResponse> {
    const result = await this.service.getLogs(page, pageSize, {
      operationType,
      operationCategory,
      actorUserId,
      actor,
      targetUserId,
      target,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      success,
      ip,
    });

    return {
      logs: result.logs.map((log) => ({
        ...log,
        changes: maskSensitiveData(log.changes),
        metadata: maskSensitiveData(log.metadata),
      })),
      total: result.total,
      page,
      pageSize,
    };
  }
}
