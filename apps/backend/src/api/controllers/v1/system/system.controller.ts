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
  Path,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import { SystemService } from "@/services/system/system.service";
import { PlatformApiLogListIamService } from "@/services/system/platform-api-log-list-iam.service";
import { PlatformApiLogReadIamService } from "@/services/system/platform-api-log-read-iam.service";
import { platformApiLogResourceResolver } from "@/iam/request/platform-api-log-resource-resolvers";
import { PlatformServerLogReadIamService } from "@/services/system/platform-server-log-read-iam.service";
import { platformServerLogFileResourceResolver } from "@/iam/request/platform-server-log-resource-resolvers";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver, iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import type {
  BuildInfoDTO,
  ConsumptionStatsDTO,
  ServerLogContentDTO,
  ServerLogFilesDTO,
  ServerLogType,
  SystemLogDTO,
  SystemLogDetailDTO,
  SystemLogStatsDTO,
  SystemStatsDTO,
} from "@/api/dto/system/system.dto";
import { CheckPermission, PermissionCheckMode, RequireAnyPermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type { ErrorResponse } from "@/api/response";
import {
  platformBuildInfoResource,
  platformSystemStatisticsResource,
  platformConsumptionStatisticsResource,
} from "@/iam/request/platform-system-resource-resolvers";
import { LogRoute } from "@/util/logger-decorator";
import { extractClientIp } from "@/util/ip-extractor";
import {
  consumptionStatsQuerySchema,
  serverLogContentQuerySchema,
  serverLogFileParamsSchema,
  serverLogFilesQuerySchema,
  systemLogDetailParamsSchema,
  systemLogStatsQuerySchema,
  systemLogsQuerySchema,
} from "@/api/schema/system/system.schema";
import { validateParams, validateQuery } from "@/middleware/validation";

@Route("v1/system")
@Tags("System")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class SystemController extends Controller {
  private systemService = SystemService.getInstance();

  @Get("build-info")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @CheckPermission(Permission.DEBUG_ACCESS, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:system:GetBuildInfo",
    resourceKind: "single-resource",
    resource: platformBuildInfoResource,
  })
  public async getBuildInfo(@Request() request: TypedRequest): Promise<BuildInfoDTO> {
    return this.systemService.getManagedBuildInfo(request);
  }

  @Get("stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @CheckPermission(Permission.SYSTEM_STATS_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:system:GetStatistics",
    resourceKind: "single-resource",
    resource: platformSystemStatisticsResource,
  })
  @LogRoute({ message: "获取系统统计信息", logResponse: true })
  public async getSystemStats(@Request() _request: TypedRequest): Promise<SystemStatsDTO> {
    const stats = await this.systemService.getManagedSystemStats(_request);
    return stats;
  }

  @Get("consumption-stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @CheckPermission(Permission.SYSTEM_CONSUMPTION_STATS_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:system:GetConsumptionStatistics",
    resourceKind: "single-resource",
    resource: platformConsumptionStatisticsResource,
  })
  @Middlewares(validateQuery(consumptionStatsQuerySchema))
  @LogRoute({ message: "获取消费统计信息", logResponse: true })
  public async getConsumptionStats(
    @Request() request: TypedRequest,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() userIds?: string[],
    @Query() models?: string[],
    @Query() channels?: string[],
    @Query() relayTokenIds?: string[],
  ): Promise<ConsumptionStatsDTO> {
    return this.systemService.getManagedConsumptionStats(
      {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        userIds,
        models,
        channels,
        relayTokenIds,
      },
      request,
    );
  }

  @Get("logs")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:log:ListLogs",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(systemLogsQuerySchema),
  )
  public async getSystemLogs(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() user?: string,
    @Query() requestID?: string,
    @Query() path?: string,
    @Query() ip?: string,
    @Query() method?: string[],
    @Query() statusCode?: number[],
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() search?: string,
  ): Promise<SystemLogDTO> {
    const filters = {
      user,
      requestID,
      path,
      ip,
      method,
      statusCode,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      search,
    };

    return PlatformApiLogListIamService.getInstance().list(page, pageSize, filters, request);
  }

  @Get("logs/stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequireAnyPermission([Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ])
  @Middlewares(validateQuery(systemLogStatsQuerySchema))
  public async getSystemLogStats(
    @Query() user?: string,
    @Query() requestID?: string,
    @Query() path?: string,
    @Query() ip?: string,
    @Query() method?: string[],
    @Query() statusCode?: number[],
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() search?: string,
  ): Promise<SystemLogStatsDTO> {
    return this.systemService.getLogStats({
      user,
      requestID,
      path,
      ip,
      method,
      statusCode,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      search,
    });
  }

  @Get("client-ip")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:GetClientIp",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async getClientIp(@Request() request: TypedRequest): Promise<{ ip: string }> {
    return { ip: extractClientIp(request) };
  }

  @Get("logs/{logId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "日志不存在")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:log:GetLogDetail",
      resourceKind: "single-resource",
      resource: platformApiLogResourceResolver,
    }),
    validateParams(systemLogDetailParamsSchema),
  )
  public async getSystemLogDetail(
    @Request() request: TypedRequest,
    @Path() logId: string,
  ): Promise<SystemLogDetailDTO> {
    return PlatformApiLogReadIamService.getInstance().read(logId, request, () =>
      this.systemService.getLogDetail(logId),
    );
  }

  @Get("server-log-files")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:server_log:ListFiles",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(serverLogFilesQuerySchema),
  )
  public async getServerLogFiles(
    @Request() request: TypedRequest,
    @Query() type?: ServerLogType,
  ): Promise<ServerLogFilesDTO> {
    return PlatformServerLogReadIamService.getInstance().list(request, () =>
      this.systemService.getServerLogFiles(type),
    );
  }

  @Get("server-log-files/{fileName}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "日志文件不存在")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:server_log:GetFileContent",
      resourceKind: "single-resource",
      resource: platformServerLogFileResourceResolver,
    }),
    validateParams(serverLogFileParamsSchema),
    validateQuery(serverLogContentQuerySchema),
  )
  public async getServerLogContent(
    @Path() fileName: string,
    @Request() request: TypedRequest,
    @Query() lines: number = 200,
    @Query() search?: string,
  ): Promise<ServerLogContentDTO> {
    return PlatformServerLogReadIamService.getInstance().content(fileName, request, () =>
      this.systemService.getServerLogContent(fileName, lines, search),
    );
  }
}
