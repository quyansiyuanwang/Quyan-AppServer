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
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type {
  AssignUserMonthlyPassRequest,
  AssignBatchUserMonthlyPassRequest,
  BatchAssignUserMonthlyPassResponse,
  ClaimMonthlyPassResultDto,
  ClaimMonthlyPassTemplateRequest,
  MonthlyPassFilterOptionsDto,
  CreateMonthlyPassTemplateRequest,
  MonthlyPassTemplateDto,
  MonthlyPassTemplateListResponse,
  MonthlyPassUsageListResponse,
  UpdateMonthlyPassTemplateRequest,
  UpdateUserMonthlyPassRequest,
  UserMonthlyPassDto,
  UserMonthlyPassListResponse,
} from "@/api/dto/billing/monthly-pass.dto";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { RequireAnyPermission, RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import {
  assignUserMonthlyPassBodySchema,
  assignBatchUserMonthlyPassBodySchema,
  claimMonthlyPassTemplateBodySchema,
  createMonthlyPassTemplateBodySchema,
  listMonthlyPassTemplatesQuerySchema,
  listMonthlyPassUsagesQuerySchema,
  listMyMonthlyPassesQuerySchema,
  listUserMonthlyPassesQuerySchema,
  monthlyPassTemplateIdParamsSchema,
  updateMonthlyPassTemplateBodySchema,
  updateUserMonthlyPassBodySchema,
  userMonthlyPassIdParamsSchema,
} from "@/api/schema/billing/monthly-pass.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import type { TypedRequest } from "@/types/express";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/monthly-passes")
@Tags("MonthlyPass")
export class MonthlyPassController extends Controller {
  private readonly monthlyPassService = MonthlyPassService.getInstance();

  @Get("filter-options")
  @Security("jwt")
  @RequireAnyPermission([
    Permission.MONTHLY_PASS_TEMPLATE_READ,
    Permission.MONTHLY_PASS_ASSIGNMENT_READ,
    Permission.MONTHLY_PASS_USAGE_READ,
  ])
  public async getFilterOptions(@Request() request: TypedRequest): Promise<MonthlyPassFilterOptionsDto> {
    return this.monthlyPassService.getFilterOptions(request.user!.userId);
  }

  @Get("templates/published")
  @Security("jwt")
  public async listPublishedTemplates(): Promise<MonthlyPassTemplateDto[]> {
    return this.monthlyPassService.listPublishedTemplates();
  }

  @Get("templates")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_TEMPLATE_READ)
  @Middlewares(validateQuery(listMonthlyPassTemplatesQuerySchema))
  public async listTemplates(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: number,
    @Query() keyword?: string,
  ): Promise<MonthlyPassTemplateListResponse> {
    return this.monthlyPassService.listTemplates(page, pageSize, status, keyword);
  }

  @Post("templates")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createMonthlyPassTemplateBodySchema),
  )
  public async createTemplate(
    @Body() body: CreateMonthlyPassTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<MonthlyPassTemplateDto> {
    return this.monthlyPassService.createTemplate(body, request.user!.userId, request);
  }

  @Post("templates/{id}/publish")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(monthlyPassTemplateIdParamsSchema),
  )
  public async publishTemplate(@Path() id: string, @Request() request: TypedRequest): Promise<MonthlyPassTemplateDto> {
    return this.monthlyPassService.publishTemplate(id, request.user!.userId, request);
  }

  @Post("templates/{id}/unpublish")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(monthlyPassTemplateIdParamsSchema),
  )
  public async unpublishTemplate(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<MonthlyPassTemplateDto> {
    return this.monthlyPassService.unpublishTemplate(id, request.user!.userId, request);
  }

  @Put("templates/{id}")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(monthlyPassTemplateIdParamsSchema),
    validateBody(updateMonthlyPassTemplateBodySchema),
  )
  public async updateTemplate(
    @Path() id: string,
    @Body() body: UpdateMonthlyPassTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<MonthlyPassTemplateDto> {
    return this.monthlyPassService.updateTemplate(id, body, request.user!.userId, request);
  }

  @Delete("templates/{id}")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(monthlyPassTemplateIdParamsSchema),
  )
  public async deleteTemplate(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.monthlyPassService.deleteTemplate(id, request.user!.userId, request);
    return { message: "Monthly pass template deleted" };
  }

  @Get("user-passes")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_ASSIGNMENT_READ)
  @Middlewares(validateQuery(listUserMonthlyPassesQuerySchema))
  public async listUserPasses(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
    @Query() templateId?: string,
    @Query() status?: number,
  ): Promise<UserMonthlyPassListResponse> {
    return this.monthlyPassService.listUserPasses(page, pageSize, userId, templateId, status);
  }

  @Get("me")
  @Security("jwt")
  @Middlewares(validateQuery(listMyMonthlyPassesQuerySchema))
  public async listCurrentUserPasses(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: number,
  ): Promise<UserMonthlyPassListResponse> {
    return this.monthlyPassService.listUserPasses(page, pageSize, request.user!.userId, undefined, status);
  }

  @Post("me/claim")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(claimMonthlyPassTemplateBodySchema))
  public async claimPublishedTemplate(
    @Body() body: ClaimMonthlyPassTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<ClaimMonthlyPassResultDto> {
    return this.monthlyPassService.claimPublishedTemplate(body, request.user!.userId, request);
  }

  @Post("user-passes")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_ASSIGNMENT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(assignUserMonthlyPassBodySchema),
  )
  public async assignUserPass(
    @Body() body: AssignUserMonthlyPassRequest,
    @Request() request: TypedRequest,
  ): Promise<UserMonthlyPassDto> {
    return this.monthlyPassService.assignUserPass(body, request.user!.userId, request);
  }

  @Post("user-passes/batch")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_ASSIGNMENT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(assignBatchUserMonthlyPassBodySchema),
  )
  public async assignUserPassBatch(
    @Body() body: AssignBatchUserMonthlyPassRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchAssignUserMonthlyPassResponse> {
    return this.monthlyPassService.assignUserPassBatch(body, request.user!.userId, request);
  }

  @Put("user-passes/{id}")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_ASSIGNMENT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(userMonthlyPassIdParamsSchema),
    validateBody(updateUserMonthlyPassBodySchema),
  )
  public async updateUserPass(
    @Path() id: string,
    @Body() body: UpdateUserMonthlyPassRequest,
    @Request() request: TypedRequest,
  ): Promise<UserMonthlyPassDto> {
    return this.monthlyPassService.updateUserPass(id, body, request.user!.userId, request);
  }

  @Delete("user-passes/{id}")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_ASSIGNMENT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(userMonthlyPassIdParamsSchema),
  )
  public async deleteUserPass(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.monthlyPassService.deleteUserPass(id, request.user!.userId, request);
    return { message: "User monthly pass deleted" };
  }

  @Get("usages")
  @Security("jwt")
  @RequirePermission(Permission.MONTHLY_PASS_USAGE_READ)
  @Middlewares(validateQuery(listMonthlyPassUsagesQuerySchema))
  public async listUsages(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
    @Query() templateId?: string,
    @Query() model?: string,
    @Query() startTime?: string,
    @Query() endTime?: string,
  ): Promise<MonthlyPassUsageListResponse> {
    return this.monthlyPassService.listUsages(page, pageSize, userId, templateId, model, startTime, endTime);
  }
}
