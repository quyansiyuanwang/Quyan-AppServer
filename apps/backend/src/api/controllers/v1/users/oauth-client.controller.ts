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
  CreateSystemOAuthClientDto,
  OAuthClientDto,
  OAuthClientReviewListResponseDto,
  OAuthClientWithSecretDto,
  ReviewOAuthClientDto,
  UpdateOAuthClientDto,
  UpdateSystemOAuthClientDto,
} from "@/api/dto/users/oauth-client.dto";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import type { TypedRequest } from "@/types/express";
import { CheckPermission, PermissionCheckMode, RequirePermission } from "@/util/permission/permission-decorator";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver, ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  platformOAuthClientResourceResolver,
  platformOAuthControlResourceResolver,
} from "@/iam/request/platform-oauth-resource-resolvers";
import { oauthClientResourceResolver } from "@/iam/request/oauth-client-resource-resolvers";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { OAuthClientService } from "@/services/users/oauth-client.service";
import {
  createOAuthClientBodySchema,
  createSystemOAuthClientBodySchema,
  oauthClientIdParamsSchema,
  oauthClientReviewListQuerySchema,
  reviewOAuthClientBodySchema,
  updateOAuthClientBodySchema,
  updateSystemOAuthClientBodySchema,
} from "@/api/schema/users/oauth-client.schema";

@Route("v1/oauth-clients")
@Tags("OAuth Client Management")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class OAuthClientController extends Controller {
  private readonly service = OAuthClientService.getInstance();

  @Post("")
  @Security("jwt", ["oauth_client"])
  @CheckPermission(Permission.OAUTH_CLIENT_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:CreateClient",
    resourceKind: "single-resource",
    resource: iamAuthenticatedUserResourceResolver,
  })
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

  @Get("system")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:oauth:ListSystemClients",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listSystemClients(@Request() request: TypedRequest): Promise<OAuthClientDto[]> {
    return this.service.listSystemClients(request);
  }

  @Post("system")
  @Security("jwt")
  @CheckPermission(Permission.OAUTH_CLIENT_SYSTEM_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:CreateSystemClient",
    resourceKind: "single-resource",
    resource: platformOAuthControlResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "创建失败")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createSystemOAuthClientBodySchema),
  )
  public async createSystemClient(
    @Body() body: CreateSystemOAuthClientDto,
    @Request() request: TypedRequest,
  ): Promise<OAuthClientWithSecretDto> {
    return this.service.createSystemClient(request.user!.userId, body, request);
  }

  @Put("system/{id}")
  @Security("jwt")
  @CheckPermission(Permission.OAUTH_CLIENT_SYSTEM_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:UpdateSystemClient",
    resourceKind: "single-resource",
    resource: platformOAuthClientResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "系统 OAuth 应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(oauthClientIdParamsSchema),
    validateBody(updateSystemOAuthClientBodySchema),
  )
  public async updateSystemClient(
    @Path() id: string,
    @Body() body: UpdateSystemOAuthClientDto,
    @Request() request: TypedRequest,
  ): Promise<OAuthClientDto> {
    return this.service.updateSystemClient(id, request.user!.userId, body, request);
  }

  @Get("")
  @Security("jwt", ["oauth_client"])
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:oauth:ListClients",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listClients(@Request() request: TypedRequest): Promise<OAuthClientDto[]> {
    return this.service.listClients(request.user!.userId, request);
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
  @CheckPermission(Permission.OAUTH_CLIENT_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:GetClient",
    resourceKind: "single-resource",
    resource: oauthClientResourceResolver,
  })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "OAuth 应用不存在")
  @Middlewares(validateParams(oauthClientIdParamsSchema))
  public async getClient(@Path() id: string, @Request() request: TypedRequest): Promise<OAuthClientDto> {
    return this.service.getClient(id, request.user!.userId, request);
  }

  @Put("{id}")
  @Security("jwt", ["oauth_client"])
  @CheckPermission(Permission.OAUTH_CLIENT_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:UpdateClient",
    resourceKind: "single-resource",
    resource: oauthClientResourceResolver,
  })
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
  @CheckPermission(Permission.OAUTH_CLIENT_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:SubmitClientReview",
    resourceKind: "single-resource",
    resource: oauthClientResourceResolver,
  })
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
  @CheckPermission(Permission.OAUTH_CLIENT_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:RotateClientSecret",
    resourceKind: "single-resource",
    resource: oauthClientResourceResolver,
  })
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
  @CheckPermission(Permission.OAUTH_CLIENT_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:oauth:DeleteClient",
    resourceKind: "single-resource",
    resource: oauthClientResourceResolver,
  })
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
