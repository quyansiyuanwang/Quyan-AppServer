import { Body, Controller, Delete, Get, Middlewares, Path, Post, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import type { DeveloperQuotaOverrideDto, UpsertDeveloperQuotaOverrideDto } from "@/api/dto/developer/developer.dto";
import { quotaOverrideIdParamsSchema, upsertQuotaOverrideBodySchema } from "@/api/schema/developer/developer.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";

@Route("v1/products/admin/quota-overrides")
@Tags("Developer Quota Administration")
@Security("jwt")
export class DeveloperQuotaAdminController extends Controller {
  private readonly service = DeveloperProjectService.getInstance();

  @Get()
  @RequirePermission(Permission.DEVELOPER_QUOTA_MANAGE)
  public async list(): Promise<DeveloperQuotaOverrideDto[]> {
    return this.service.listQuotaOverrides();
  }

  @Post()
  @RequirePermission(Permission.DEVELOPER_QUOTA_MANAGE)
  @Middlewares(replayProtectionMiddleware, validateBody(upsertQuotaOverrideBodySchema))
  public async upsert(
    @Body() body: UpsertDeveloperQuotaOverrideDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperQuotaOverrideDto> {
    return this.service.upsertQuotaOverride(body, request.user!.userId);
  }

  @Delete("{id}")
  @RequirePermission(Permission.DEVELOPER_QUOTA_MANAGE)
  @Middlewares(replayProtectionMiddleware, validateParams(quotaOverrideIdParamsSchema))
  public async remove(@Path() id: string): Promise<{ success: true }> {
    await this.service.deleteQuotaOverride(id);
    return { success: true };
  }
}
