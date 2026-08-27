import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Put,
  Delete,
  Query,
  Request,
  Route,
  Security,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import type {
  ContentSafetyConfigDto,
  ContentSafetyConfigRequest,
  ContentSafetyRuleRequest,
  ContentSafetyCsvImportRequest,
  ContentSafetyCsvImportResponse,
  ContentSafetyUserConfigRequest,
  ContentSafetyRuleOverrideRequest,
  ContentSafetyBatchUpdateRequest,
  ContentSafetyBatchUpdateResponse,
  ContentSafetyExportDto,
  ContentSafetyExportRequest,
} from "@/api/dto/system/content-safety.dto";
import {
  contentSafetyConfigSchema,
  contentSafetyRuleSchema,
  contentSafetyCsvImportSchema,
  contentSafetyUserConfigSchema,
  contentSafetyRuleOverrideSchema,
  contentSafetyBatchUpdateSchema,
  contentSafetyExportSchema,
} from "@/api/schema/system/content-safety.schema";
import { validateBody } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { PermissionService } from "@/services/users/permission.service";
import { ForbiddenError } from "@/util/errors";

@Route("v1/content-safety")
@Tags("Content Safety")
@Security("jwt")
export class ContentSafetyController extends Controller {
  private readonly service = ContentSafetyService.getInstance();
  private readonly permissionService = PermissionService.getInstance();

  private async resolveUserScope(request: TypedRequest, targetUserId?: string) {
    const actorUserId = request.user!.userId;
    if (!targetUserId || targetUserId === actorUserId) return actorUserId;
    if (!(await this.permissionService.hasPermission(actorUserId, Permission.SYSTEM_CONFIG)))
      throw new ForbiddenError("Access denied");
    return targetUserId;
  }
  @Get("config")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  async getConfig(): Promise<ContentSafetyConfigDto> {
    return this.service.getPublicConfig();
  }

  @Get("user-config")
  async getUserConfig(@Request() request: TypedRequest, @Query() targetUserId?: string) {
    return this.service.getUserConfig(await this.resolveUserScope(request, targetUserId));
  }

  @Put("user-config")
  @Middlewares(validateBody(contentSafetyUserConfigSchema))
  async updateUserConfig(@Body() body: ContentSafetyUserConfigRequest, @Request() request: TypedRequest) {
    const userId = await this.resolveUserScope(request, body.targetUserId);
    return this.service.updateUserConfig(body, userId);
  }

  @Put("rule-overrides")
  @Middlewares(validateBody(contentSafetyRuleOverrideSchema))
  async updateRuleOverride(@Body() body: ContentSafetyRuleOverrideRequest, @Request() request: TypedRequest) {
    return this.service.setRuleOverride(
      await this.resolveUserScope(request, body.targetUserId),
      body.ruleId,
      body.enabled,
    );
  }

  @Delete("rule-overrides/{id}")
  async deleteRuleOverride(@Path() id: string, @Request() request: TypedRequest, @Query() targetUserId?: string) {
    return this.service.clearRuleOverride(await this.resolveUserScope(request, targetUserId), id);
  }

  @Get("user-rules")
  async listUserRules(
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 50,
    @Query() targetUserId?: string,
  ) {
    return this.service.listEffectiveRules(await this.resolveUserScope(request, targetUserId), page, pageSize);
  }

  @Post("user-rules")
  @Middlewares(validateBody(contentSafetyRuleSchema))
  async createUserRule(@Body() body: ContentSafetyRuleRequest, @Request() request: TypedRequest) {
    return this.service.createUserRule(await this.resolveUserScope(request, body.targetUserId), body);
  }

  @Put("user-rules/{id}")
  @Middlewares(validateBody(contentSafetyRuleSchema))
  async updateUserRule(@Path() id: string, @Body() body: ContentSafetyRuleRequest, @Request() request: TypedRequest) {
    return this.service.updateUserRule(await this.resolveUserScope(request, body.targetUserId), id, body);
  }

  @Delete("user-rules/{id}")
  async deleteUserRule(@Path() id: string, @Request() request: TypedRequest, @Query() targetUserId?: string) {
    await this.service.deleteUserRule(await this.resolveUserScope(request, targetUserId), id);
    return { success: true };
  }

  @Post("user-rules/import-csv")
  @Middlewares(validateBody(contentSafetyCsvImportSchema))
  async importUserCsv(@Body() body: ContentSafetyCsvImportRequest, @Request() request: TypedRequest) {
    return this.service.importUserCsv(
      await this.resolveUserScope(request, body.targetUserId),
      body.csv,
      body.mode ?? "apply",
      body.overwrite === true,
    );
  }
  @Post("user-rules/batch-update")
  @Middlewares(validateBody(contentSafetyBatchUpdateSchema))
  async batchUpdateUserRules(
    @Body() body: ContentSafetyBatchUpdateRequest,
    @Request() request: TypedRequest,
  ): Promise<ContentSafetyBatchUpdateResponse> {
    return this.service.batchUpdateUserRules(
      await this.resolveUserScope(request, body.targetUserId),
      body.ids,
      body.changes,
    );
  }
  @Post("user-rules/export")
  @Middlewares(validateBody(contentSafetyExportSchema))
  async exportUserRules(
    @Body() body: ContentSafetyExportRequest,
    @Request() request: TypedRequest,
  ): Promise<ContentSafetyExportDto> {
    return this.service.exportPolicy(
      await this.resolveUserScope(request, body.targetUserId),
      body.format ?? "json",
      "user",
    );
  }
  @Put("config")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(contentSafetyConfigSchema),
  )
  async updateConfig(
    @Body() body: ContentSafetyConfigRequest,
    @Request() request: TypedRequest,
  ): Promise<ContentSafetyConfigDto> {
    return this.service.updateConfig(body, request.user!.userId, request);
  }
  @Get("rules")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  async listRules(@Query() page = 1, @Query() pageSize = 50) {
    return this.service.listRules(page, pageSize);
  }
  @Post("rules/import-defaults")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), replayProtectionMiddleware)
  async importDefaults() {
    return this.service.importDefaults();
  }
  @Post("rules/import-csv")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(contentSafetyCsvImportSchema),
  )
  async importCsv(@Body() body: ContentSafetyCsvImportRequest): Promise<ContentSafetyCsvImportResponse> {
    return this.service.importCsv(body.csv, body.mode ?? "apply", body.overwrite === true);
  }
  @Post("rules/batch-update")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(contentSafetyBatchUpdateSchema),
  )
  async batchUpdateRules(@Body() body: ContentSafetyBatchUpdateRequest): Promise<ContentSafetyBatchUpdateResponse> {
    return this.service.batchUpdateRules(body.ids, body.changes);
  }
  @Post("rules/export")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(validateBody(contentSafetyExportSchema))
  async exportRules(@Body() body: ContentSafetyExportRequest): Promise<ContentSafetyExportDto> {
    return this.service.exportPolicy(undefined, body.format ?? "json", "system");
  }
  @Post("rules")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(contentSafetyRuleSchema),
  )
  async createRule(@Body() body: ContentSafetyRuleRequest) {
    return this.service.createRule(body);
  }
  @Put("rules/{id}")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(contentSafetyRuleSchema),
  )
  async updateRule(@Path() id: string, @Body() body: ContentSafetyRuleRequest) {
    return this.service.updateRule(id, body);
  }
  @Delete("rules/{id}")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), replayProtectionMiddleware)
  async deleteRule(@Path() id: string) {
    await this.service.deleteRule(id);
    return { success: true };
  }
  @Get("incidents")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  async listIncidents(
    @Query() page = 1,
    @Query() pageSize = 50,
    @Query() userId?: string,
    @Query() startTime?: string,
    @Query() endTime?: string,
    @Query() direction?: "request" | "response",
    @Query() source?: "rule" | "ai",
    @Query() processingStatus?: "allow" | "replaced" | "blocked",
    @Query() requestId?: string,
    @Query() relayTokenName?: string,
    @Query() channelName?: string,
    @Query() sortBy?: "createTime" | "requestId" | "action" | "source" | "statusCode",
    @Query() sortOrder?: "asc" | "desc",
  ) {
    return this.service.listIncidents({
      page,
      pageSize,
      userId,
      startTime,
      endTime,
      direction,
      source,
      processingStatus,
      requestId,
      relayTokenName,
      channelName,
      sortBy,
      sortOrder,
    });
  }

  @Get("user-incidents")
  async listUserIncidents(
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 50,
    @Query() startTime?: string,
    @Query() endTime?: string,
    @Query() direction?: "request" | "response",
    @Query() source?: "rule" | "ai",
    @Query() processingStatus?: "allow" | "replaced" | "blocked",
    @Query() requestId?: string,
    @Query() relayTokenName?: string,
    @Query() channelName?: string,
    @Query() sortBy?: "createTime" | "requestId" | "action" | "source" | "statusCode",
    @Query() sortOrder?: "asc" | "desc",
  ) {
    return this.service.listIncidents({
      page,
      pageSize,
      userId: request.user!.userId,
      startTime,
      endTime,
      direction,
      source,
      processingStatus,
      requestId,
      relayTokenName,
      channelName,
      sortBy,
      sortOrder,
    });
  }
}
