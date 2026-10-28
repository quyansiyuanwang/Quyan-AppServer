import {
  platformTrackingStatisticsResource,
  platformFunnelStatisticsResource,
} from "@/iam/request/platform-system-resource-resolvers";
import { Route, Tags, Controller, SuccessResponse, Response, Post, Body, Request, Security } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { ErrorResponse } from "@/api/response";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import { extractClientIp } from "@/util/ip-extractor";
import TrackService from "@/services/analytics/track.service";
import type {
  BatchTrackBody,
  TrackStatsQuery,
  FunnelQuery,
  TrackStatsResponse,
  FunnelResponse,
} from "@/api/dto/analytics/track.dto";

@Route("v1/track")
@Tags("Analytics")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class TrackController extends Controller {
  private service = TrackService.getInstance();

  @Post("/batch")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async batchTrack(
    @Body() body: BatchTrackBody,
    @Request() request: TypedRequest,
  ): Promise<{ success: boolean }> {
    await this.service.batchTrack(body.events ?? [], extractClientIp(request));
    return { success: true };
  }

  @Post("/stats")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @CheckPermission(Permission.ANALYTICS_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:analytics:GetTrackingStatistics",
    resourceKind: "single-resource",
    resource: platformTrackingStatisticsResource,
  })
  public async getStats(@Body() body: TrackStatsQuery, @Request() request: TypedRequest): Promise<TrackStatsResponse> {
    return this.service.getManagedStats(body, request);
  }

  @Post("/funnel")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @CheckPermission(Permission.ANALYTICS_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:analytics:GetFunnelStatistics",
    resourceKind: "single-resource",
    resource: platformFunnelStatisticsResource,
  })
  public async getFunnel(@Body() body: FunnelQuery, @Request() request: TypedRequest): Promise<FunnelResponse> {
    return this.service.getManagedFunnel(body, request);
  }
}
