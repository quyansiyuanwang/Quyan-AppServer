import { Get, Path, Route, SuccessResponse, Response, Tags, Controller, Header, Middlewares } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { JsonEndpointService } from "@/services/json-endpoint/json-endpoint.service";
import type { PublicJsonData } from "@/api/dto/json-endpoint/json-endpoint.dto";
import type { ErrorResponse } from "@/api/response";
import { publicJsonSlugParamsSchema } from "@/api/schema/json-endpoint/json-endpoint.schema";
import { validateParams } from "@/middleware/validation";

@Route("v1/json")
@Tags("Public JSON Access")
export class PublicJsonController extends Controller {
  private service = JsonEndpointService.getInstance();

  /**
   * 公开访问 JSON 数据
   * @param slug URL Slug
   * @param password 可选的访问密码 (通过 X-Access-Password header 传递)
   */
  @Get("{slug}")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "端点不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "需要访问密码")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "密码错误")
  @Middlewares(validateParams(publicJsonSlugParamsSchema))
  public async accessEndpoint(
    @Path() slug: string,
    @Header("X-Access-Password") password?: string,
  ): Promise<PublicJsonData> {
    return this.service.accessEndpoint(slug, password);
  }
}
