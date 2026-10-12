import { Permission, isDeveloperProductCode, type DeveloperProductCode } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { DeveloperProductPlatformService } from "./developer-product-platform.service";
import { PermissionService } from "@/services/users/permission.service";
import { PlatformDeveloperAccountReadIamService } from "./platform-developer-account-read-iam.service";
import { updateProductAccountBodySchema } from "@/api/schema/developer/product-platform.schema";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { DeveloperProductAccountDto } from "@/api/dto/developer/product-platform.dto";
import type { DeveloperAccountReadRow } from "@/store/developer/platform-developer-account-read.store";
export class DeveloperProductAccountAdminService {
  private static instance: DeveloperProductAccountAdminService;
  private constructor(
    private readonly legacy = DeveloperProductPlatformService.getInstance(),
    private readonly iamReads = PlatformDeveloperAccountReadIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new DeveloperProductAccountAdminService());
  }
  private dto(row: DeveloperAccountReadRow): DeveloperProductAccountDto {
    const parsed = updateProductAccountBodySchema
      .strict()
      .safeParse({
        dailyFreeQuota: row.dailyFreeQuota,
        overageEnabled: row.overageEnabled,
        instanceLimit: row.instanceLimit,
      });
    if (!parsed.success || !isDeveloperProductCode(row.productCode)) throw iamAccountDenied();
    return {
      id: row.id,
      accountOwnerId: row.accountOwnerId,
      accountOwnerUsername: row.accountOwner.username,
      accountOwnerDisplayName: row.accountOwner.displayName ?? undefined,
      productCode: row.productCode,
      dailyFreeQuota: parsed.data.dailyFreeQuota ?? undefined,
      overageEnabled: parsed.data.overageEnabled,
      instanceLimit: parsed.data.instanceLimit,
      createTime: row.createTime.toISOString(),
      updateTime: row.updateTime.toISOString(),
    };
  }
  async list(request: TypedRequest, product?: DeveloperProductCode) {
    if (product !== undefined && !isDeveloperProductCode(product)) throw iamAccountDenied();
    const project = (rows: DeveloperAccountReadRow[]) => rows.map((row) => this.dto(row));
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamReads.list(request, project, true, product);
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
          [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE],
          { assumedRoleSessionId: principal.roleSessionId },
        )
      ).hasPermission
    )
      throw iamAccountDenied();
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        await this.iamReads.list(request, project, false, product);
      } catch {
        getLogger("DeveloperProductAccount", LogCategory.SECURITY).warn(
          "Product account list shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    return this.legacy.listAccounts(product);
  }
}
