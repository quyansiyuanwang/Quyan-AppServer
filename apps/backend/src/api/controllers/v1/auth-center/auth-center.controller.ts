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
  AuthCenterAuthorizeDecisionDto,
  AuthCenterAuthorizationDecisionResponseDto,
  AuthCenterAuthorizationPreviewDto,
  AuthCenterDiscoveryResponseDto,
  AuthCenterJwksResponseDto,
  AuthCenterRevokeTokenDto,
  AuthCenterRevokeTokenResponseDto,
  AuthCenterTokenDto,
  AuthCenterTokenResponseDto,
} from "@/api/dto/auth-center/auth-center.dto";
import type { ErrorResponse } from "@/api/response";
import {
  authCenterAuthorizeDecisionBodySchema,
  authCenterAuthorizeQuerySchema,
  authCenterRevokeBodySchema,
  authCenterTokenBodySchema,
} from "@/api/schema/auth-center/auth-center.schema";
import { validateBody } from "@/middleware/validation";
import {
  AuthCenterAuthorizationService,
  AuthCenterProtocolError,
} from "@/services/auth-center/auth-center-authorization.service";
import type { TypedRequest } from "@/types/express";
import { skipResponseWrapper } from "@/util/response-wrapper";

@Route("v1/auth-center")
@Tags("Auth Center")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class AuthCenterController extends Controller {
  private readonly authCenterService = AuthCenterAuthorizationService.getInstance();

  @Get("authorize")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Auth Center authorization preview loaded")
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
  ): Promise<AuthCenterAuthorizationPreviewDto> {
    const query = authCenterAuthorizeQuerySchema.parse({
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
      nonce,
    });

    return this.authCenterService.getAuthorizationPreview(String(request.user?.userId || ""), query);
  }

  @Post("authorize")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Auth Center authorization decision accepted")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "Invalid authorization request")
  @Middlewares(validateBody(authCenterAuthorizeDecisionBodySchema))
  public async decideAuthorization(
    @Request() request: TypedRequest<AuthCenterAuthorizeDecisionDto>,
    @Body() body: AuthCenterAuthorizeDecisionDto,
  ): Promise<AuthCenterAuthorizationDecisionResponseDto> {
    return this.authCenterService.decideAuthorization(String(request.user?.userId || ""), body);
  }

  @Post("token")
  @SuccessResponse(HttpStatusCode.Ok, "Auth Center token issued")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "Invalid token request")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "Client authentication failed")
  @Middlewares(validateBody(authCenterTokenBodySchema))
  public async token(
    @Request() request: ExpressRequest,
    @Body() body: AuthCenterTokenDto,
  ): Promise<AuthCenterTokenResponseDto> {
    skipResponseWrapper(request as TypedRequest);

    try {
      return await this.authCenterService.exchangeToken(request, body);
    } catch (error) {
      if (error instanceof AuthCenterProtocolError) {
        this.setStatus(error.statusCode);
        return {
          access_token: error.error,
          token_type: "Bearer",
          expires_in: 0,
          scope: error.errorDescription,
        } as never;
      }
      throw error;
    }
  }

  @Post("revoke")
  @SuccessResponse(HttpStatusCode.Ok, "Auth Center token revoked")
  @Middlewares(validateBody(authCenterRevokeBodySchema))
  public async revoke(
    @Request() request: ExpressRequest,
    @Body() body: AuthCenterRevokeTokenDto,
  ): Promise<AuthCenterRevokeTokenResponseDto> {
    skipResponseWrapper(request as TypedRequest);
    await this.authCenterService.revokeToken(request, body);
    return { revoked: true };
  }
}

@Route("v1/auth-center/.well-known")
@Tags("Auth Center")
export class AuthCenterWellKnownController extends Controller {
  private readonly authCenterService = AuthCenterAuthorizationService.getInstance();

  @Get("jwks.json")
  @SuccessResponse(HttpStatusCode.Ok, "JWKS loaded")
  public async getJwks(): Promise<AuthCenterJwksResponseDto> {
    return this.authCenterService.getJwks();
  }

  @Get("openid-configuration")
  @SuccessResponse(HttpStatusCode.Ok, "OpenID configuration loaded")
  public async getOpenIdConfiguration(): Promise<AuthCenterDiscoveryResponseDto> {
    return this.authCenterService.getDiscoveryDocument();
  }
}
