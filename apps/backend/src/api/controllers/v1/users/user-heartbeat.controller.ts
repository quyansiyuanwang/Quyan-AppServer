import {
  Controller,
  Delete,
  Get,
  Path,
  Query,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { TypedRequest } from "@/types/express";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { ErrorResponse } from "@/api/response";
import type { UserOnlineMonitorOverviewResponse } from "@/api/dto/users/user-online-monitor.dto";
import type {
  ForceOfflineSessionResponse,
  ForceOfflineUserResponse,
  UserOnlineMonitorDetailDto,
  UserOnlineMonitorTimelineGroupedResponse,
} from "@/api/dto/users/user-online-monitor.dto";
import {
  type HeartbeatRuntimeConfigDto,
  type SendHeartbeatResponse,
  type StopHeartbeatResponse,
} from "@/api/dto/users/user-heartbeat.dto";
import { UserHeartbeatService } from "@/services/users/user-heartbeat.service";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { extractAuthSessionId } from "@/util/auth-session";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

@Route("v1/users/me/heartbeat")
@Tags("UserHeartbeat")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class UserHeartbeatController extends Controller {
  private readonly heartbeatService = UserHeartbeatService.getInstance();

  @Get("runtime-config")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  public async getRuntimeConfig(): Promise<HeartbeatRuntimeConfigDto> {
    return this.heartbeatService.getRuntimeConfig();
  }

  @Post("")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  public async sendHeartbeat(@Request() request: TypedRequest): Promise<SendHeartbeatResponse> {
    return this.heartbeatService.recordHeartbeat(request.user!.userId, request);
  }

  @Delete("")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  public async stopHeartbeat(@Request() request: TypedRequest): Promise<StopHeartbeatResponse> {
    return this.heartbeatService.stopHeartbeat(request.user!.userId, request);
  }

  @Get("monitor/overview")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_ONLINE_MONITOR_READ)
  public async getOverview(
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() keyword?: string,
    @Query() ipAddress?: string,
    @Query() location?: string,
    @Query() status?: "online" | "offline",
  ): Promise<UserOnlineMonitorOverviewResponse> {
    return this.heartbeatService.getOverview({ page, pageSize, keyword, ipAddress, location, status });
  }

  @Get("monitor/users/{userId}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_ONLINE_MONITOR_READ)
  public async getUserDetail(@Path() userId: string): Promise<UserOnlineMonitorDetailDto> {
    return this.heartbeatService.getUserDetail(userId);
  }

  @Get("monitor/users/{userId}/timeline")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.USER_ONLINE_MONITOR_READ)
  public async getUserTimeline(
    @Path() userId: string,
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() onlineOnly?: boolean,
    @Query() offlineOnly?: boolean,
    @Query() startDate?: string,
    @Query() endDate?: string,
  ): Promise<UserOnlineMonitorTimelineGroupedResponse> {
    return this.heartbeatService.getUserTimeline({
      userId,
      page,
      pageSize,
      onlineOnly,
      offlineOnly,
      startDate,
      endDate,
    });
  }

  @Post("monitor/sessions/{sessionId}/force-offline")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @RequirePermission(Permission.USER_ONLINE_MONITOR_FORCE_OFFLINE)
  public async forceOfflineSession(
    @Path() sessionId: string,
    @Request() request: TypedRequest,
  ): Promise<ForceOfflineSessionResponse> {
    return this.heartbeatService.forceOfflineSessionWithCurrentSession(sessionId, extractAuthSessionId(request));
  }

  @Post("monitor/users/{userId}/force-offline")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @RequirePermission(Permission.USER_ONLINE_MONITOR_FORCE_OFFLINE)
  public async forceOfflineUser(@Path() userId: string): Promise<ForceOfflineUserResponse> {
    return this.heartbeatService.forceOfflineUser(userId);
  }
}
