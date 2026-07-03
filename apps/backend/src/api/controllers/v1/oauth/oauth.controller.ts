import {
  Body,
  Controller,
  Get,
  Middlewares,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { Request as ExpressRequest } from "express";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type {
  OAuthAuthorizeDecisionDto,
  OAuthAuthorizationDecisionResponseDto,
  OAuthAuthorizationPreviewDto,
  OAuthErrorResponseDto,
  OAuthRevokeTokenDto,
  OAuthRevokeTokenResponseDto,
  OAuthTokenDto,
  OAuthTokenResponseDto,
} from "@/api/dto/oauth/oauth.dto";
import {
  oauthAuthorizeDecisionBodySchema,
  oauthAuthorizeQuerySchema,
  oauthRevokeBodySchema,
  oauthTokenBodySchema,
} from "@/api/schema/oauth/oauth.schema";
import type { ErrorResponse } from "@/api/response";
import { validateBody, validateQuery as _validateQuery } from "@/middleware/validation";
import { OAuthAuthorizationService, OAuthProtocolError } from "@/services/oauth/oauth-authorization.service";
import type { TypedRequest } from "@/types/express";
import { skipResponseWrapper } from "@/util/response-wrapper";

@Route("v1/oauth")
@Tags("OAuth 2.0")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class OAuthController extends Controller {
  private readonly oauthService = OAuthAuthorizationService.getInstance();

  @Get("authorize")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "OAuth authorization preview loaded")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "Invalid authorization request")
  public async authorize(
    @Request() request: TypedRequest,
    @Query() response_type: "code",
    @Query() client_id: string,
    @Query() redirect_uri: string,
    @Query() scope?: string,
    @Query() state?: string,
    @Query() code_challenge?: string,
    @Query() code_challenge_method?: "S256" | "plain",
    @Query() nonce?: string,
  ): Promise<OAuthAuthorizationPreviewDto> {
    const query = oauthAuthorizeQuerySchema.parse({
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
      nonce,
    });

    return this.oauthService.getAuthorizationPreview(String(request.user?.userId || ""), query);
  }

  @Post("authorize")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "OAuth authorization decision accepted")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "Invalid authorization request")
  @Middlewares(validateBody(oauthAuthorizeDecisionBodySchema))
  public async decideAuthorization(
    @Request() request: TypedRequest<OAuthAuthorizeDecisionDto>,
    @Body() body: OAuthAuthorizeDecisionDto,
  ): Promise<OAuthAuthorizationDecisionResponseDto> {
    return this.oauthService.decideAuthorization(String(request.user?.userId || ""), body);
  }

  @Post("token")
  @SuccessResponse(HttpStatusCode.Ok, "OAuth token issued")
  @Response<OAuthErrorResponseDto>(HttpStatusCode.BadRequest, "Invalid token request")
  @Response<OAuthErrorResponseDto>(HttpStatusCode.Unauthorized, "Client authentication failed")
  @Middlewares(validateBody(oauthTokenBodySchema))
  public async token(
    @Request() request: ExpressRequest,
    @Body() body: OAuthTokenDto,
  ): Promise<OAuthTokenResponseDto | OAuthErrorResponseDto> {
    skipResponseWrapper(request as TypedRequest);

    try {
      return await this.oauthService.exchangeToken(request, body);
    } catch (error) {
      if (error instanceof OAuthProtocolError) {
        this.setStatus(error.statusCode);
        return {
          error: error.error,
          error_description: error.errorDescription,
        };
      }
      throw error;
    }
  }

  @Post("revoke")
  @SuccessResponse(HttpStatusCode.Ok, "OAuth token revoked")
  @Middlewares(validateBody(oauthRevokeBodySchema))
  public async revoke(
    @Request() request: ExpressRequest,
    @Body() body: OAuthRevokeTokenDto,
  ): Promise<OAuthRevokeTokenResponseDto> {
    skipResponseWrapper(request as TypedRequest);
    await this.oauthService.revokeToken(request, body);
    return { revoked: true };
  }
}
