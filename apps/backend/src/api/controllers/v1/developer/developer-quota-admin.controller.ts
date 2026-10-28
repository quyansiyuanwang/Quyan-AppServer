import {
  platformDeveloperQuotaUpsertResources,
  platformDeveloperQuotaDeleteResource,
} from "@/iam/request/platform-developer-quota-resource-resolvers";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { Body, Controller, Delete, Get, Middlewares, Path, Post, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperQuotaAdminService } from "@/services/developer/developer-quota-admin.service";
import type { DeveloperQuotaOverrideDto, UpsertDeveloperQuotaOverrideDto } from "@/api/dto/developer/developer.dto";
import { quotaOverrideIdParamsSchema, upsertQuotaOverrideBodySchema } from "@/api/schema/developer/developer.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";

@Route("v1/products/admin/quota-overrides")
@Tags("Developer Quota Administration")
@Security("jwt")
export class DeveloperQuotaAdminController extends Controller {
  private readonly service = DeveloperQuotaAdminService.getInstance();

  @Get()
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListQuotaOverrides",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async list(@Request() request: TypedRequest): Promise<DeveloperQuotaOverrideDto[]> {
    return this.service.list(request);
  }

  @Post()
  @CheckPermission(Permission.DEVELOPER_QUOTA_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:developer:UpsertQuotaOverride",
    resourceKind: "batch",
    resource: platformDeveloperQuotaUpsertResources,
  })
  @Middlewares(replayProtectionMiddleware, validateBody(upsertQuotaOverrideBodySchema))
  public async upsert(
    @Body() body: UpsertDeveloperQuotaOverrideDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperQuotaOverrideDto> {
    return this.service.upsertManaged(body, request.user!.userId, request);
  }

  @Delete("{id}")
  @CheckPermission(Permission.DEVELOPER_QUOTA_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:developer:DeleteQuotaOverride",
    resourceKind: "single-resource",
    resource: platformDeveloperQuotaDeleteResource,
  })
  @Middlewares(replayProtectionMiddleware, validateParams(quotaOverrideIdParamsSchema))
  public async remove(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: true }> {
    await this.service.removeManaged(id, request.user!.userId, request);
    return { success: true };
  }
}
