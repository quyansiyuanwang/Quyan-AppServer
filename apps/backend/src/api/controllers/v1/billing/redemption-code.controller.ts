import {
  platformRedemptionCodeCreationResourceResolver,
  platformRedemptionCodeResourceResolver,
} from "@/iam/request/redemption-code-resource-resolvers";
import { PlatformRedemptionCodeReadIamService } from "@/services/billing/platform-redemption-code-read-iam.service";
import { platformRedemptionCodeCollectionArn } from "@/iam/resources/platform-redemption-code-resources";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import {
  Controller,
  Get,
  Post,
  Delete,
  Route,
  Security,
  Tags,
  Request,
  Body,
  Path,
  Query,
  Middlewares,
} from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import type { CreateRedemptionCodeDto, RedemptionCodeDto, RedeemCodeDto } from "@/api/dto/billing/redemption-code.dto";
import { RedemptionCodeService } from "@/services/billing/redemption-code.service";
import { BalanceTransferService } from "@/services/billing/balance-transfer.service";
import {
  createRedemptionCodeBodySchema,
  redeemCodeBodySchema,
  redemptionCodeDeleteParamsSchema,
  redemptionCodeListQuerySchema,
} from "@/api/schema/billing/redemption-code.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

@Route("v1/redemption-codes")
@Tags("RedemptionCode")
export class RedemptionCodeController extends Controller {
  private redemptionCodeService = RedemptionCodeService.getInstance();
  private balanceTransferService = BalanceTransferService.getInstance();

  @Post("create")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:redemption_code:CreateCodes",
      resourceKind: "batch",
      resource: platformRedemptionCodeCreationResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRedemptionCodeBodySchema),
  )
  async createCodes(
    @Body() body: CreateRedemptionCodeDto,
    @Request() request: TypedRequest,
  ): Promise<RedemptionCodeDto[]> {
    return await this.redemptionCodeService.createCodes(body, request.user!.userId, request);
  }

  @Get("list")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:redemption_code:ListCodes",
      resourceKind: "collection",
      resource: platformRedemptionCodeCollectionArn,
    }),
  )
  @Middlewares(validateQuery(redemptionCodeListQuerySchema))
  async listCodes(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<{ total: number; records: RedemptionCodeDto[]; page: number; pageSize: number }> {
    return PlatformRedemptionCodeReadIamService.getInstance().list(request, { page, pageSize });
  }

  @Post("redeem")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:RedeemCode",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @Middlewares(replayProtectionMiddleware, validateBody(redeemCodeBodySchema))
  async redeemCode(@Body() body: RedeemCodeDto, @Request() request: TypedRequest): Promise<{ balance: number }> {
    if (body.code.startsWith("ugc_"))
      return await this.balanceTransferService.redeemGiftCode(body.code, request.user!.userId, request);
    return await this.redemptionCodeService.redeemCode(body.code, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:redemption_code:DeleteCode",
      resourceKind: "single-resource",
      resource: platformRedemptionCodeResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(redemptionCodeDeleteParamsSchema),
  )
  async deleteCode(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.redemptionCodeService.deleteCode(id, request.user!.userId, request);
    setResponseMessageKey(request, "billing.redemptionCodeDeleted");
    return { message: "删除成功" };
  }
}
