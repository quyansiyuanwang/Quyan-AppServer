import { PlatformBusinessLogStatsIamService } from "@/services/system/platform-business-log-stats-iam.service";
import { PlatformBusinessLogListIamService } from "@/services/system/platform-business-log-list-iam.service";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { platformBusinessLogOptionsResource } from "@/iam/request/platform-system-resource-resolvers";
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
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:business_log:GetFilterOptions",
      resourceKind: "single-resource",
      resource: platformBusinessLogOptionsResource,
    }),
  )
  public async getBusinessLogFilterOptions(
    @Request() request: TypedRequest,
  ): Promise<BusinessLogFilterOptionsResponse> {
    return this.service.getAuthorizedFilterOptions(request);
  }

  @Get("/stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:business_log:GetLogStatistics",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(businessLogStatsQuerySchema),
  )
  public async getBusinessLogStats(
    @Request() request: TypedRequest,
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
    return PlatformBusinessLogStatsIamService.getInstance().statistics(
      {
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
      },
      request,
    );
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
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:business_log:ListLogs",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(businessLogsQuerySchema),
  )
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
    const result = await PlatformBusinessLogListIamService.getInstance().list(
      page,
      pageSize,
      {
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
      },
      request,
    );

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
