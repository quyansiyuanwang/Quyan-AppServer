import { Body, Controller, Get, Middlewares, Post, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { BalanceManagementService } from "@/services/billing/balance-management.service";
import type {
  AdjustBalanceAccountRequest,
  BalanceAdjustmentResultDto,
  BalanceOverdraftDefaultDto,
  ManagedBalanceAccountDto,
  ManagedBalanceListDto,
  PreviewOverdraftRequest,
  SetDefaultOverdraftRequest,
  SetUserOverdraftRequest,
} from "@/api/dto/billing/balance-management.dto";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { platformBalanceManagementResource } from "@/iam/request/platform-system-resource-resolvers";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { validateBody, validateQuery } from "@/middleware/validation";
import {
  managementQuerySchema,
  defaultOverdraftSchema,
  batchOverdraftSchema,
  previewOverdraftSchema,
  adjustAccountSchema,
} from "@/api/schema/billing/balance-management.schema";
import type { BalanceAdjustmentPreviewDto } from "@/api/dto/billing/balance-management.dto";

@Route("v1/balance-management")
@Tags("BalanceManagement")
export class BalanceManagementController extends Controller {
  private service = BalanceManagementService.getInstance();
  @Get("accounts")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:ListManagedAccounts",
      resourceKind: "collection",
      resource: platformBalanceManagementResource,
    }),
    validateQuery(managementQuerySchema),
  )
  async listManagedAccounts(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
  ): Promise<ManagedBalanceListDto> {
    return this.service.list({ page, pageSize, userId }, request);
  }
  @Get("defaults")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:GetOverdraftDefaults",
      resourceKind: "single-resource",
      resource: platformBalanceManagementResource,
    }),
  )
  async getOverdraftDefaults(@Request() request: TypedRequest): Promise<BalanceOverdraftDefaultDto> {
    return this.service.defaults(request);
  }
  @Post("defaults")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:SetOverdraftDefaults",
      resourceKind: "single-resource",
      resource: platformBalanceManagementResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(defaultOverdraftSchema),
  )
  async setOverdraftDefaults(
    @Body() body: SetDefaultOverdraftRequest,
    @Request() request: TypedRequest,
  ): Promise<BalanceOverdraftDefaultDto> {
    return this.service.saveDefaults(body, request);
  }
  @Post("preview")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:PreviewOverdraft",
      resourceKind: "single-resource",
      resource: platformBalanceManagementResource,
    }),
  )
  @Middlewares(replayProtectionMiddleware, validateBody(previewOverdraftSchema))
  async previewOverdraft(
    @Body() body: PreviewOverdraftRequest,
    @Request() request: TypedRequest,
  ): Promise<ManagedBalanceAccountDto[]> {
    return this.service.preview(body, request);
  }
  @Post("overdraft")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:SetUserOverdraft",
      resourceKind: "single-resource",
      resource: platformBalanceManagementResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchOverdraftSchema),
  )
  async setUserOverdraft(
    @Body() body: SetUserOverdraftRequest,
    @Request() request: TypedRequest,
  ): Promise<{ updated: number }> {
    return this.service.saveUsers(body, request);
  }
  @Post("adjust")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:AdjustAccount",
      resourceKind: "single-resource",
      resource: platformBalanceManagementResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(adjustAccountSchema),
  )
  async adjustBalanceAccount(
    @Body() body: AdjustBalanceAccountRequest,
    @Request() request: TypedRequest,
  ): Promise<BalanceAdjustmentResultDto> {
    return this.service.adjust(body, request);
  }
  @Post("adjust/preview")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:balance:PreviewAccountAdjustment",
      resourceKind: "single-resource",
      resource: platformBalanceManagementResource,
    }),
  )
  @Middlewares(replayProtectionMiddleware, validateBody(adjustAccountSchema))
  async previewBalanceAccountAdjustment(
    @Body() body: AdjustBalanceAccountRequest,
    @Request() request: TypedRequest,
  ): Promise<BalanceAdjustmentPreviewDto> {
    return this.service.previewAdjustment(body, request);
  }
}
