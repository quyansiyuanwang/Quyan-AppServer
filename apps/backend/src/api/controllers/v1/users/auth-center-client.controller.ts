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
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import type { TypedRequest } from "@/types/express";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/auth-center/clients")
@Tags("Auth Center Client Management")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class AuthCenterClientController extends Controller {
  private readonly service = AuthCenterClientService.getInstance();

  @Post("")
  @Security("jwt", ["auth_center_client"])
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_CREATE)
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
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  public async listClients(@Request() request: TypedRequest): Promise<AuthCenterClientDto[]> {
    return this.service.listClients(request.user!.userId);
  }

  @Get("review")
  @Security("jwt")
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_REVIEW_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Middlewares(validateQuery(authCenterClientReviewListQuerySchema))
  public async listClientsForReview(
    @Query() page: number = 1,
    @Query() pageSize: number = 10,
    @Query() reviewStatus?: "draft" | "pending" | "approved" | "rejected",
    @Query() keyword?: string,
  ): Promise<AuthCenterClientReviewListResponseDto> {
    return this.service.listClientsForReview({ page, pageSize, reviewStatus, keyword });
  }

  @Get("{id}")
  @Security("jwt", ["auth_center_client"])
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_READ)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(validateParams(authCenterClientIdParamsSchema))
  public async getClient(@Path() id: string, @Request() request: TypedRequest): Promise<AuthCenterClientDto> {
    return this.service.getClient(id, request.user!.userId);
  }

  @Put("{id}")
  @Security("jwt", ["auth_center_client"])
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_UPDATE)
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
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_UPDATE)
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
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE)
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
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE)
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "认证中心应用不存在")
  @Middlewares(validateParams(authCenterClientIdParamsSchema))
  public async deleteClientForReview(@Path() id: string, @Request() request: TypedRequest): Promise<boolean> {
    await this.service.deleteClientForReview(id, request.user!.userId, request);
    return true;
  }

  @Post("{id}/regenerate-secret")
  @Security("jwt", ["auth_center_client"])
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_UPDATE)
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
  @RequirePermission(Permission.AUTH_CENTER_CLIENT_DELETE)
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
