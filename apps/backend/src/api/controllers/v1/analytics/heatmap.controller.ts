import { Route, Tags, Controller, SuccessResponse, Response, Post, Body, Request, Security } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { ErrorResponse } from "@/api/response";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import HeatmapService from "@/services/analytics/heatmap.service";
import type { BatchHeatmapBody, HeatmapQuery, HeatmapQueryResponse } from "@/api/dto/analytics/heatmap.dto";

@Route("v1/heatmap")
@Tags("Analytics")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class HeatmapController extends Controller {
  private service = HeatmapService.getInstance();

  @Post("/collect")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async collect(
    @Body() body: BatchHeatmapBody,
    @Request() _request: TypedRequest,
  ): Promise<{ success: boolean }> {
    await this.service.batchCollect(body.points ?? []);
    return { success: true };
  }

  @Post("/query")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.ANALYTICS_READ)
  public async query(@Body() body: HeatmapQuery): Promise<HeatmapQueryResponse> {
    return this.service.query(body);
  }
}
