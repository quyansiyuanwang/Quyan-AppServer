import { Permission, isDeveloperProductCode, type DeveloperProductCode } from "@quyan/shared";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { DeveloperProductPlatformService } from "./developer-product-platform.service";
import { PermissionService } from "@/services/users/permission.service";
import { PlatformDeveloperAccountWriteIamService } from "./platform-developer-account-write-iam.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import type { UpdateDeveloperProductAccountDto } from "@/api/dto/developer/product-platform.dto";
import { PlatformDeveloperInstanceReadIamService } from "./platform-developer-instance-read-iam.service";
import { PlatformDeveloperCallLogReadIamService } from "./platform-developer-call-log-read-iam.service";
import { PlatformDeveloperUsageReadIamService } from "./platform-developer-usage-read-iam.service";
import type { DeveloperUsageLocator } from "@/store/developer/platform-developer-usage-read.store";
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
    private readonly iamUsage = PlatformDeveloperUsageReadIamService.getInstance(),
    private readonly iamCalls = PlatformDeveloperCallLogReadIamService.getInstance(),
    private readonly iamInstances = PlatformDeveloperInstanceReadIamService.getInstance(),
    private readonly iamWrites = PlatformDeveloperAccountWriteIamService.getInstance(),
    private readonly businessLog = BusinessLogService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new DeveloperProductAccountAdminService());
  }
  private dto(row: DeveloperAccountReadRow): DeveloperProductAccountDto {
    const parsed = updateProductAccountBodySchema.strict().safeParse({
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
  async update(
    request: TypedRequest,
    actorId: string,
    product: DeveloperProductCode,
    ownerId: string,
    body: UpdateDeveloperProductAccountDto,
  ) {
    if (env.security.iamAuthorizationMode === "enforce") {
      const row = await this.iamWrites.upsert(product, ownerId, body, actorId, request);
      if (!row) throw iamAccountDenied();
      const account = this.dto(row);
      await this.businessLog.logOperation({
        operationType: OperationType.DEVELOPER_PRODUCT_ACCOUNT_UPDATE,
        operationCategory: OperationCategory.SYSTEM,
        actorUserId: actorId,
        targetResourceId: row.id,
        targetResourceType: "DEVELOPER_PRODUCT_ACCOUNT",
        description: "Developer product account update",
        changes: {
          accountOwnerId: row.accountOwnerId,
          productCode: row.productCode,
          dailyFreeQuota: row.dailyFreeQuota,
          overageEnabled: row.overageEnabled,
          instanceLimit: row.instanceLimit,
        },
        success: true,
        ...buildBusinessLogRequestContext(request),
      });
      return {
        userId: row.accountOwnerId,
        username: row.accountOwner.username,
        displayName: row.accountOwner.displayName ?? undefined,
        account,
      };
    }
    const principal = request && getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== actorId ||
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
        await this.iamWrites.upsert(product, ownerId, body, actorId, request, false);
      } catch {
        getLogger("DeveloperProductAccount", LogCategory.SECURITY).warn(
          "Product account update shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    return this.legacy.updateManagedAccount(actorId, product, ownerId, body);
  }
  async instances(request: TypedRequest, product: DeveloperProductCode, userId: string) {
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamInstances.list(request, product, { userId });
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
        await this.iamInstances.list(request, product, { userId }, false);
      } catch {
        getLogger("DeveloperProductAccount", LogCategory.SECURITY).warn(
          "Product account instance shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    return this.legacy.listManagedInstances(product, userId);
  }
  async calls(request: TypedRequest, product: DeveloperProductCode, locator: DeveloperUsageLocator) {
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamCalls.list(request, product, locator);
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
        await this.iamCalls.list(request, product, locator, false);
      } catch {
        getLogger("DeveloperProductAccount", LogCategory.SECURITY).warn(
          "Product account call log shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    if (locator.accountId) return this.legacy.listCallLogs(product, locator.accountId);
    if (locator.userId) return this.legacy.listManagedCallLogs(product, locator.userId);
    throw iamAccountDenied();
  }
  async usage(request: TypedRequest, product: DeveloperProductCode, locator: DeveloperUsageLocator) {
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.iamUsage.get(request, product, locator);
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
        await this.iamUsage.get(request, product, locator, false);
      } catch {
        getLogger("DeveloperProductAccount", LogCategory.SECURITY).warn(
          "Product account usage shadow evaluation failed",
          { reason: "iam-evaluation-denied-or-unavailable" },
        );
      }
    }
    if (locator.accountId) return this.legacy.getUsageForProduct(product, locator.accountId);
    if (locator.userId) return this.legacy.getManagedUsage(product, locator.userId);
    throw iamAccountDenied();
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
