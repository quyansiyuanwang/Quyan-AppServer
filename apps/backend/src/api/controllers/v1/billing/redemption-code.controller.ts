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
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type { CreateRedemptionCodeDto, RedemptionCodeDto, RedeemCodeDto } from "@/api/dto/billing/redemption-code.dto";
import { RedemptionCodeService } from "@/services/billing/redemption-code.service";
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

  @Post("create")
  @Security("jwt")
  @RequirePermission(Permission.REDEMPTION_CODE_CREATE)
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
  @RequirePermission(Permission.REDEMPTION_CODE_READ)
  @Middlewares(validateQuery(redemptionCodeListQuerySchema))
  async listCodes(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<{ total: number; records: RedemptionCodeDto[]; page: number; pageSize: number }> {
    void request;
    return await this.redemptionCodeService.listCodes(page, pageSize);
  }

  @Post("redeem")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(redeemCodeBodySchema))
  async redeemCode(@Body() body: RedeemCodeDto, @Request() request: TypedRequest): Promise<{ balance: number }> {
    return await this.redemptionCodeService.redeemCode(body.code, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt")
  @RequirePermission(Permission.REDEMPTION_CODE_DELETE)
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
