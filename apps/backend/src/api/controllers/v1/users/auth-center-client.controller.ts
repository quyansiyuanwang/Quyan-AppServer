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
  AuthCenterClientDto,
  AuthCenterClientReviewListResponseDto,
  AuthCenterClientWithSecretDto,
  CreateAuthCenterClientDto,
  ReviewAuthCenterClientDto,
  UpdateAuthCenterClientDto,
} from "@/api/dto/users/auth-center-client.dto";
import {
  authCenterClientIdParamsSchema,
  authCenterClientReviewListQuerySchema,
  createAuthCenterClientBodySchema,
  reviewAuthCenterClientBodySchema,
  updateAuthCenterClientBodySchema,
} from "@/api/schema/users/auth-center-client.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import {
  iamCollectionAuthorizationMiddleware,
  iamAuthenticatedAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver, ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { authCenterClientResourceResolver } from "@/iam/request/auth-center-client-resource-resolvers";
import { platformAuthCenterReviewClientResourceResolver } from "@/iam/request/platform-auth-center-resource-resolvers";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import type { TypedRequest } from "@/types/express";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/auth-center/clients")
@Tags("Auth Center Client Management")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class AuthCenterClientController extends Controller {
  private readonly service = AuthCenterClientService.getInstance();

  @Post("")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:CreateClient",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "创建失败")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createAuthCenterClientBodySchema),
  )
  public async createClient(
    @Body() body: CreateAuthCenterClientDto,
    @Request() request: TypedRequest,
  ): Promise<AuthCenterClientWithSecretDto> {
    return this.service.createClient(request.user!.userId, body, request);
  }

  @Get("")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:auth_center:ListClients",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listClients(@Request() request: TypedRequest): Promise<AuthCenterClientDto[]> {
    return this.service.listClients(request.user!.userId, request);
  }

  @Get("review")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:auth_center:ListClientReviews",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(authCenterClientReviewListQuerySchema))
  public async listClientsForReview(
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() reviewStatus?: "draft" | "pending" | "approved" | "rejected",
    @Query() keyword?: string,
    @Request() request?: TypedRequest,
  ): Promise<AuthCenterClientReviewListResponseDto> {
    return this.service.listClientsForReview({ page, pageSize, reviewStatus, keyword }, request);
  }

  @Get("{id}")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:GetClient",
      resourceKind: "single-resource",
      resource: authCenterClientResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(validateParams(authCenterClientIdParamsSchema))
  public async getClient(@Path() id: string, @Request() request: TypedRequest): Promise<AuthCenterClientDto> {
    return this.service.getClient(id, request.user!.userId, request);
  }

  @Put("{id}")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:UpdateClient",
      resourceKind: "single-resource",
      resource: authCenterClientResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(authCenterClientIdParamsSchema),
    validateBody(updateAuthCenterClientBodySchema),
  )
  public async updateClient(
    @Path() id: string,
    @Body() body: UpdateAuthCenterClientDto,
    @Request() request: TypedRequest,
  ): Promise<AuthCenterClientDto> {
    return this.service.updateClient(id, request.user!.userId, body, request);
  }

  @Post("{id}/submit-review")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:SubmitClientReview",
      resourceKind: "single-resource",
      resource: authCenterClientResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(authCenterClientIdParamsSchema),
  )
  public async submitReview(@Path() id: string, @Request() request: TypedRequest): Promise<AuthCenterClientDto> {
    return this.service.submitForReview(id, request.user!.userId, request);
  }

  @Post("{id}/review")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:ReviewClient",
      resourceKind: "single-resource",
      resource: platformAuthCenterReviewClientResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(validateParams(authCenterClientIdParamsSchema), validateBody(reviewAuthCenterClientBodySchema))
  public async reviewClient(
    @Path() id: string,
    @Body() body: ReviewAuthCenterClientDto,
    @Request() request: TypedRequest,
  ): Promise<AuthCenterClientDto> {
    return this.service.reviewClient(id, request.user!.userId, body, request);
  }

  @Delete("{id}/review")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:DeleteReviewedClient",
      resourceKind: "single-resource",
      resource: platformAuthCenterReviewClientResourceResolver,
    }),
  )
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(validateParams(authCenterClientIdParamsSchema))
  public async deleteClientForReview(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteClientForReview(id, request.user!.userId, request);
    return true;
  }

  @Post("{id}/regenerate-secret")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:RotateClientSecret",
      resourceKind: "single-resource",
      resource: authCenterClientResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(authCenterClientIdParamsSchema),
  )
  public async regenerateSecret(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<AuthCenterClientWithSecretDto> {
    return this.service.regenerateSecret(id, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt", ["auth_center_client"])
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:auth_center:DeleteClient",
      resourceKind: "single-resource",
      resource: authCenterClientResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(authCenterClientIdParamsSchema),
  )
  public async deleteClient(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteClient(id, request.user!.userId, request);
    return true;
  }
}
