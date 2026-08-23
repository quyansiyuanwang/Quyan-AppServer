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
} from "@/api/dto/system/content-safety.dto";
import {
  contentSafetyConfigSchema,
  contentSafetyRuleSchema,
  contentSafetyCsvImportSchema,
} from "@/api/schema/system/content-safety.schema";
import { validateBody } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/content-safety")
@Tags("Content Safety")
@Security("jwt")
export class ContentSafetyController extends Controller {
  private readonly service = ContentSafetyService.getInstance();
  @Get("config")
  @RequirePermission(Permission.SYSTEM_CONFIG)
  async getConfig(): Promise<ContentSafetyConfigDto> {
    return this.service.getPublicConfig();
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
    return this.service.importCsv(body.csv);
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
  async listIncidents(@Query() page = 1, @Query() pageSize = 50) {
    return this.service.listIncidents(page, pageSize);
  }
}
