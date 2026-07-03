import {
  Body,
  Get,
  Post,
  Path,
  Route,
  Security,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Put,
  Delete,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { JsonEndpointService } from "@/services/json-endpoint/json-endpoint.service";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type {
  CreateJsonEndpointDto,
  UpdateJsonEndpointDto,
  JsonEndpointDto,
} from "@/api/dto/json-endpoint/json-endpoint.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type { ErrorResponse } from "@/api/response";
import {
  createJsonEndpointBodySchema,
  jsonEndpointIdParamsSchema,
  updateJsonEndpointBodySchema,
} from "@/api/schema/json-endpoint/json-endpoint.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";

@Route("v1/json-endpoints")
@Tags("JSON Endpoint Management")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class JsonEndpointController extends Controller {
  private service = JsonEndpointService.getInstance();

  /**
   * 创建 JSON 端点
   */
  @Post("")
  @Security("jwt")
  @RequirePermission(Permission.JSON_ENDPOINT_CREATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "创建失败")
  @Middlewares(replayProtectionMiddleware, validateBody(createJsonEndpointBodySchema))
  public async createEndpoint(
    @Body() body: CreateJsonEndpointDto,
    @Request() request: TypedRequest,
  ): Promise<JsonEndpointDto> {
    const userId = request.user!.userId;
    return this.service.createEndpoint(body, userId, request);
  }

  /**
   * 获取用户的所有端点
   */
  @Get("")
  @Security("jwt")
  @RequirePermission(Permission.JSON_ENDPOINT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(replayProtectionMiddleware)
  public async listEndpoints(@Request() request: TypedRequest): Promise<JsonEndpointDto[]> {
    const userId = request.user!.userId;
    return this.service.listEndpoints(userId);
  }

  /**
   * 获取端点详情
   */
  @Get("{id}")
  @Security("jwt")
  @RequirePermission(Permission.JSON_ENDPOINT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "端点不存在")
  @Middlewares(validateParams(jsonEndpointIdParamsSchema))
  public async getEndpoint(@Path() id: string, @Request() request: TypedRequest): Promise<JsonEndpointDto> {
    const userId = request.user!.userId;
    return this.service.getEndpoint(id, userId);
  }

  /**
   * 更新端点
   */
  @Put("{id}")
  @Security("jwt")
  @RequirePermission(Permission.JSON_ENDPOINT_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "端点不存在")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(jsonEndpointIdParamsSchema),
    validateBody(updateJsonEndpointBodySchema),
  )
  public async updateEndpoint(
    @Path() id: string,
    @Body() body: UpdateJsonEndpointDto,
    @Request() request: TypedRequest,
  ): Promise<JsonEndpointDto> {
    const userId = request.user!.userId;
    return this.service.updateEndpoint(id, body, userId, request);
  }

  /**
   * 删除端点
   */
  @Delete("{id}")
  @Security("jwt")
  @RequirePermission(Permission.JSON_ENDPOINT_DELETE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "端点不存在")
  @Middlewares(replayProtectionMiddleware, validateParams(jsonEndpointIdParamsSchema))
  public async deleteEndpoint(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    const userId = request.user!.userId;
    await this.service.deleteEndpoint(id, userId, request);
    return true;
  }
}
