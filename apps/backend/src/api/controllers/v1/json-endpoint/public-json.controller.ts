import {
  Get,
  Path,
  Route,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Header,
  Middlewares,
  Request,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import { JsonEndpointService } from "@/services/json-endpoint/json-endpoint.service";
import type { PublicJsonData } from "@/api/dto/json-endpoint/json-endpoint.dto";
import type { ErrorResponse } from "@/api/response";
import {
  publicJsonNamespaceParamsSchema,
  publicJsonSlugParamsSchema,
} from "@/api/schema/json-endpoint/json-endpoint.schema";
import { validateParams } from "@/middleware/validation";
import type { TypedRequest } from "@/types/express";

@Route("v1/json")
@Tags("Public JSON Access")
export class PublicJsonController extends Controller {
  private service = JsonEndpointService.getInstance();

  /**
   * 公开访问 JSON 数据
   * @param slug URL Slug
   * 非公开端点可通过 X-Access-Password 使用静态密码，或使用 Ed25519 签名请求头：
   * X-Json-Timestamp、X-Json-Nonce、X-Json-Signature。
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
    @Header("X-Json-Timestamp") timestamp?: string,
    @Header("X-Json-Nonce") nonce?: string,
    @Header("X-Json-Signature") signature?: string,
    @Request() request?: TypedRequest,
  ): Promise<PublicJsonData> {
    return this.service.accessRootEndpoint(slug, {
      password,
      timestamp,
      nonce,
      signature,
      pathname: request?.path,
      originalUrl: request?.originalUrl,
    });
  }

  @Get("{username}/{slug}")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "端点不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "需要访问密码")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "密码错误")
  @Middlewares(validateParams(publicJsonNamespaceParamsSchema))
  public async accessNamespacedEndpoint(
    @Path() username: string,
    @Path() slug: string,
    @Header("X-Access-Password") password?: string,
    @Header("X-Json-Timestamp") timestamp?: string,
    @Header("X-Json-Nonce") nonce?: string,
    @Header("X-Json-Signature") signature?: string,
    @Request() request?: TypedRequest,
  ): Promise<PublicJsonData> {
    return this.service.accessNamespacedEndpoint(username, slug, {
      password,
      timestamp,
      nonce,
      signature,
      pathname: request?.path,
      originalUrl: request?.originalUrl,
    });
  }
}
