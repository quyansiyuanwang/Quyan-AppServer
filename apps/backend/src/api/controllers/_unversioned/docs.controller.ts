import { Get, Route, SuccessResponse, Tags, Controller, Security, Request } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { OpenApiDocumentService } from "@/services/system/openapi-document.service";
import { platformOpenApiSpecificationResource } from "@/iam/request/platform-system-resource-resolvers";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import { skipResponseWrapper } from "@/util/response-wrapper";

/**
 * API 文档相关接口
 */
@Route("docs")
@Tags("Documentation")
export class DocsController extends Controller {
  private readonly service = OpenApiDocumentService.getInstance();
  /**
   * 获取 OpenAPI 规范文档
   * @summary 获取 OpenAPI JSON
   * @returns OpenAPI 3.0 规范文档
   * @note 此接口返回原始 OpenAPI 文档，不进行响应包装
   */
  @Get("openapi.json")
  @Security("local-or-jwt")
  @SuccessResponse(HttpStatusCode.Ok, "成功获取 OpenAPI 规范")
  @CheckPermission(Permission.DEBUG_OPENAPI_READ, PermissionCheckMode.ALL, "local-or-jwt", {
    action: "quyan:system:GetOpenApiSpecification",
    resourceKind: "single-resource",
    resource: platformOpenApiSpecificationResource,
  })
  public async getOpenApiSpec(@Request() request: TypedRequest): Promise<Record<string, any>> {
    // 跳过响应包装，返回原始 OpenAPI 文档
    skipResponseWrapper(request);

    const swaggerDocument = await this.service.read(request);
    this.setStatus(HttpStatusCode.Ok);
    return swaggerDocument;
  }
}
