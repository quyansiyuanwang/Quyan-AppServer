import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { ErrorResponse } from "@/api/response";
import type {
  CreateOAuthClientDto,
  OAuthClientDto,
  OAuthClientReviewListResponseDto,
  OAuthClientWithSecretDto,
  ReviewOAuthClientDto,
  UpdateOAuthClientDto,
} from "@/api/dto/users/oauth-client.dto";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import type { TypedRequest } from "@/types/express";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { OAuthClientService } from "@/services/users/oauth-client.service";
import {
  createOAuthClientBodySchema,
  oauthClientIdParamsSchema,
  oauthClientReviewListQuerySchema,
  reviewOAuthClientBodySchema,
  updateOAuthClientBodySchema,
} from "@/api/schema/users/oauth-client.schema";

@Route("v1/oauth-clients")
@Tags("OAuth Client Management")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class OAuthClientController extends Controller {
  private readonly service = OAuthClientService.getInstance();

  @Post("")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "创建失败")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createOAuthClientBodySchema),
  )
  public async createClient(
    @Body() body: CreateOAuthClientDto,
    @Request() request: TypedRequest,
  ): Promise<OAuthClientWithSecretDto> {
    return this.service.createClient(request.user!.userId, body, request);
  }

  @Get("")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listClients(@Request() request: TypedRequest): Promise<OAuthClientDto[]> {
    return this.service.listClients(request.user!.userId);
  }

  @Get("review")
  @Security("jwt")
  @RequirePermission(Permission.OAUTH_CLIENT_REVIEW_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(oauthClientReviewListQuerySchema))
  public async listClientsForReview(
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() reviewStatus?: "draft" | "pending" | "approved" | "rejected",
    @Query() keyword?: string,
  ): Promise<OAuthClientReviewListResponseDto> {
    return this.service.listClientsForReview({ page, pageSize, reviewStatus, keyword });
  }

  @Get("{id}")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(validateParams(oauthClientIdParamsSchema))
  public async getClient(@Path() id: string, @Request() request: TypedRequest): Promise<OAuthClientDto> {
    return this.service.getClient(id, request.user!.userId);
  }

  @Put("{id}")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(oauthClientIdParamsSchema),
    validateBody(updateOAuthClientBodySchema),
  )
  public async updateClient(
    @Path() id: string,
    @Body() body: UpdateOAuthClientDto,
    @Request() request: TypedRequest,
  ): Promise<OAuthClientDto> {
    return this.service.updateClient(id, request.user!.userId, body, request);
  }

  @Post("{id}/submit-review")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(oauthClientIdParamsSchema),
  )
  public async submitReview(@Path() id: string, @Request() request: TypedRequest): Promise<OAuthClientDto> {
    return this.service.submitForReview(id, request.user!.userId, request);
  }

  @Post("{id}/review")
  @Security("jwt")
  @RequirePermission(Permission.OAUTH_CLIENT_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(validateParams(oauthClientIdParamsSchema), validateBody(reviewOAuthClientBodySchema))
  public async reviewClient(
    @Path() id: string,
    @Body() body: ReviewOAuthClientDto,
    @Request() request: TypedRequest,
  ): Promise<OAuthClientDto> {
    return this.service.reviewClient(id, request.user!.userId, body, request);
  }

  @Delete("{id}/review")
  @Security("jwt")
  @RequirePermission(Permission.OAUTH_CLIENT_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(validateParams(oauthClientIdParamsSchema))
  public async deleteClientForReview(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteClientForReview(id, request.user!.userId, request);
    return true;
  }

  @Post("{id}/regenerate-secret")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(oauthClientIdParamsSchema),
  )
  public async regenerateSecret(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<OAuthClientWithSecretDto> {
    return this.service.regenerateSecret(id, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt", ["oauth_client"])
  @RequirePermission(Permission.OAUTH_CLIENT_DELETE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(oauthClientIdParamsSchema),
  )
  public async deleteClient(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteClient(id, request.user!.userId, request);
    return true;
  }
}
