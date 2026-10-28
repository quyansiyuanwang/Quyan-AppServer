import type { DeveloperProductConfig } from "@prisma/client";
import { Permission, isDeveloperProductCode, type DeveloperProductCode } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { DeveloperProductPlatformService } from "./developer-product-platform.service";
import { PermissionService } from "@/services/users/permission.service";
import { PlatformDeveloperConfigReadIamService } from "./platform-developer-config-read-iam.service";
import { updateProductConfigBodySchema } from "@/api/schema/developer/product-platform.schema";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import { PlatformDeveloperConfigWriteIamService } from "./platform-developer-config-write-iam.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { UpdateDeveloperProductConfigDto } from "@/api/dto/developer/product-platform.dto";
import type { DeveloperProductConfigDto } from "@/api/dto/developer/product-platform.dto";
export class DeveloperProductConfigAdminService {
  private static instance: DeveloperProductConfigAdminService;
  private constructor(
    private readonly legacy = DeveloperProductPlatformService.getInstance(),
    private readonly iamReads = PlatformDeveloperConfigReadIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly iamWrites = PlatformDeveloperConfigWriteIamService.getInstance(),
    private readonly businessLog = BusinessLogService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new DeveloperProductConfigAdminService());
  }
  private dto(row: DeveloperProductConfig): DeveloperProductConfigDto {
    const parsed = updateProductConfigBodySchema.strict().safeParse({
      enabled: row.enabled,
      defaultDailyQuota: row.defaultDailyQuota,
      overagePrice: Number(row.overagePrice),
      defaultInstanceLimit: row.defaultInstanceLimit,
      retentionDays: row.retentionDays,
      resourceLimits: row.resourceLimits ?? undefined,
      settings: row.settings ?? undefined,
    });
    if (!parsed.success || !isDeveloperProductCode(row.productCode)) throw iamAccountDenied();
    return { productCode: row.productCode, ...parsed.data };
  }
  async update(
    product: DeveloperProductCode,
    body: UpdateDeveloperProductConfigDto,
    userId: string,
    request: TypedRequest,
  ) {
    if (env.security.iamAuthorizationMode === "enforce") {
      const row = await this.iamWrites.upsert(product, body, userId, request);
      if (!row) throw iamAccountDenied();
      const dto = this.dto(row);
      await this.businessLog.logOperation({
        operationType: OperationType.DEVELOPER_PRODUCT_CONFIG_UPDATE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: userId,
        targetResourceId: row.id,
        targetResourceType: "DEVELOPER_PRODUCT_CONFIG",
        description: "Developer product configuration update",
        success: true,
        changes: {
          productCode: row.productCode,
          enabled: row.enabled,
          defaultDailyQuota: row.defaultDailyQuota,
          overagePrice: Number(row.overagePrice),
          defaultInstanceLimit: row.defaultInstanceLimit,
          retentionDays: row.retentionDays,
        },
        ...buildBusinessLogRequestContext(request),
      });
      return dto;
    }
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== userId ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
      !(
        await this.permissions.checkUserPermissions(userId, [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamWrites.upsert(product, body, userId, request, false);
      } catch {
        getLogger("DeveloperProductConfig", LogCategory.SECURITY).warn(
          "Product configuration write shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    return this.legacy.updateConfig(product, body);
  }
  async list(request: TypedRequest) {
    const project = (rows: DeveloperProductConfig[]) => rows.map((row) => this.dto(row));
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamReads.list(request, project);
      if (!result) throw iamAccountDenied();
      return result;
    }
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== principal.principalUserId ||
      !["legacy", "shadow"].includes(env.security.iamAuthorizationMode) ||
      !(
        await this.permissions.checkUserPermissions(
          principal.subjectUserId,
          [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.list(request, project, false);
      } catch {
        getLogger("DeveloperProductConfig", LogCategory.SECURITY).warn(
          "Product configuration list shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    return this.legacy.listConfigs();
  }
}
