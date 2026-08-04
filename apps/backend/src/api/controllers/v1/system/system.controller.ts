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
import { RequireAnyPermission, RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import { NotFoundError } from "@/util/errors";
import type { ErrorResponse } from "@/api/response";
import { BUILD_INFO } from "@/generated/buildInfo";
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
  @RequirePermission(Permission.DEBUG_ACCESS)
  public async getBuildInfo(): Promise<BuildInfoDTO> {
    return BUILD_INFO;
  }

  @Get("stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.SYSTEM_STATS_READ)
  @LogRoute({ message: "获取系统统计信息", logResponse: true })
  public async getSystemStats(@Request() _request: TypedRequest): Promise<SystemStatsDTO> {
    const stats = await this.systemService.getSystemStats();
    return stats;
  }

  @Get("consumption-stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.SYSTEM_CONSUMPTION_STATS_READ)
  @Middlewares(validateQuery(consumptionStatsQuerySchema))
  @LogRoute({ message: "获取消费统计信息", logResponse: true })
  public async getConsumptionStats(
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() userIds?: string[],
    @Query() models?: string[],
    @Query() channels?: string[],
    @Query() relayTokenIds?: string[],
  ): Promise<ConsumptionStatsDTO> {
    return this.systemService.getConsumptionStats({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      userIds,
      models,
      channels,
      relayTokenIds,
    });
  }

  @Get("logs")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequireAnyPermission([Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ])
  @Middlewares(validateQuery(systemLogsQuerySchema))
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

    const result = await this.systemService.getLogs(page, pageSize, filters);
    return result;
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
  public async getClientIp(@Request() request: TypedRequest): Promise<{ ip: string }> {
    return { ip: extractClientIp(request) };
  }

  @Get("logs/{logId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "日志不存在")
  @RequireAnyPermission([Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ])
  @Middlewares(validateParams(systemLogDetailParamsSchema))
  public async getSystemLogDetail(
    @Request() request: TypedRequest,
    @Path() logId: string,
  ): Promise<SystemLogDetailDTO> {
    const detail = await this.systemService.getLogDetail(logId);
    if (!detail) throw new NotFoundError("Log not found");
    return detail;
  }

  @Get("server-log-files")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.SYSTEM_SERVER_LOG_READ)
  @Middlewares(validateQuery(serverLogFilesQuerySchema))
  public async getServerLogFiles(@Query() type?: ServerLogType): Promise<ServerLogFilesDTO> {
    return this.systemService.getServerLogFiles(type);
  }

  @Get("server-log-files/{fileName}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "日志文件不存在")
  @RequirePermission(Permission.SYSTEM_SERVER_LOG_READ)
  @Middlewares(validateParams(serverLogFileParamsSchema), validateQuery(serverLogContentQuerySchema))
  public async getServerLogContent(
    @Path() fileName: string,
    @Query() lines: number = 200,
    @Query() search?: string,
  ): Promise<ServerLogContentDTO> {
    const content = await this.systemService.getServerLogContent(fileName, lines, search);
    if (!content) throw new NotFoundError("Log file not found");
    return content;
  }
}
