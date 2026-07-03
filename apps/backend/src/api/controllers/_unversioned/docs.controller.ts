import { Get, Route, SuccessResponse, Tags, Controller, Security, Request } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import fs from "fs-extra";
import { SWAGGER_PATH } from "@/constant/file-path";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import { skipResponseWrapper } from "@/util/response-wrapper";

/**
 * API 文档相关接口
 */
@Route("docs")
@Tags("Documentation")
export class DocsController extends Controller {
  /**
   * 获取 OpenAPI 规范文档
   * @summary 获取 OpenAPI JSON
   * @returns OpenAPI 3.0 规范文档
   * @note 此接口返回原始 OpenAPI 文档，不进行响应包装
   */
  @Get("openapi.json")
  @Security("local-or-jwt")
  @SuccessResponse(HttpStatusCode.Ok, "成功获取 OpenAPI 规范")
  @RequirePermission(Permission.DEBUG_OPENAPI_READ, "local-or-jwt")
  public async getOpenApiSpec(@Request() request: TypedRequest): Promise<Record<string, any>> {
    // 跳过响应包装，返回原始 OpenAPI 文档
    skipResponseWrapper(request);

    const swaggerDocument: Record<string, any> = fs.readJsonSync(SWAGGER_PATH);
    this.setStatus(HttpStatusCode.Ok);
    return swaggerDocument;
  }
}
