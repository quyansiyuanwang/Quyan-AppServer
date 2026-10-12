import {
  platformDeveloperUsageAccountResource,
  platformDeveloperUsageUserResource,
} from "@/iam/request/platform-developer-usage-resource-resolvers";
import { DeveloperProductAccountAdminService } from "@/services/developer/developer-product-account-admin.service";
import { DeveloperProductConfigAdminService } from "@/services/developer/developer-product-config-admin.service";
import { platformDeveloperConfigUpsertResources } from "@/iam/request/platform-developer-config-resource-resolvers";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { Body, Controller, Get, Middlewares, Path, Put, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import type {
  DeveloperProductCallLogDto,
  DeveloperProductConfigDto,
  DeveloperProductAccountDto,
  DeveloperProductManagedAccountDto,
  DeveloperProductManagedAccountsDto,
  DeveloperProductInstanceDto,
  DeveloperProductUsageDto,
  UpdateDeveloperProductAccountDto,
  UpdateDeveloperProductConfigDto,
} from "@/api/dto/developer/product-platform.dto";
import {
  productCodeParamsSchema,
  productAccountParamsSchema,
  updateProductConfigBodySchema,
  productUserParamsSchema,
  managedProductAccountsQuerySchema,
  updateProductAccountBodySchema,
} from "@/api/schema/developer/product-platform.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { CheckPermission, PermissionCheckMode, RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { DeveloperProductCode } from "@quyan/shared";

@Route("v1/admin/products")
@Tags("Developer Product Administration")
@Security("jwt")
export class DeveloperProductAdminController extends Controller {
  private readonly accounts = DeveloperProductAccountAdminService.getInstance();
  private readonly configurations = DeveloperProductConfigAdminService.getInstance();
  private readonly service = DeveloperProductPlatformService.getInstance();

  @Get("configs")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProductConfigurations",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listConfigs(@Request() request: TypedRequest): Promise<DeveloperProductConfigDto[]> {
    return this.configurations.list(request);
  }

  @Put("{product}/config")
  @CheckPermission(Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:developer:UpsertProductConfiguration",
    resourceKind: "batch",
    resource: platformDeveloperConfigUpsertResources,
  })
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productCodeParamsSchema),
    validateBody(updateProductConfigBodySchema),
  )
  public async updateConfig(
    @Path() product: DeveloperProductCode,
    @Body() body: UpdateDeveloperProductConfigDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductConfigDto> {
    return this.configurations.update(product, body, request.user!.userId, request);
  }

  @Get("accounts")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProductAccounts",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listAccounts(@Request() request: TypedRequest): Promise<DeveloperProductAccountDto[]> {
    return this.accounts.list(request);
  }

  @Get("{product}/accounts")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProductAccounts",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateParams(productCodeParamsSchema),
  )
  public async listProductAccounts(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductAccountDto[]> {
    return this.accounts.list(request, product);
  }

  @Get("{product}/users")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productCodeParamsSchema), validateQuery(managedProductAccountsQuerySchema))
  public async listManagedAccounts(
    @Path() product: DeveloperProductCode,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
  ): Promise<DeveloperProductManagedAccountsDto> {
    return this.service.listManagedAccounts(product, page ?? 1, pageSize ?? 20, keyword);
  }

  @Put("{product}/users/{userId}/account")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productUserParamsSchema),
    validateBody(updateProductAccountBodySchema),
  )
  public async updateManagedAccount(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
    @Body() body: UpdateDeveloperProductAccountDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductManagedAccountDto> {
    return this.service.updateManagedAccount(request.user!.userId, product, userId, body);
  }

  @Get("{product}/users/{userId}/instances")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProductAccountInstances",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateParams(productUserParamsSchema),
  )
  public async listManagedInstances(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto[]> {
    return this.accounts.instances(request, product, userId);
  }

  @Get("{product}/users/{userId}/usage")
  @CheckPermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:developer:GetProductAccountUsage",
    resourceKind: "single-resource",
    resource: platformDeveloperUsageUserResource,
  })
  @Middlewares(validateParams(productUserParamsSchema))
  public async getManagedUsage(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductUsageDto> {
    return this.accounts.usage(request, product, { userId });
  }

  @Get("{product}/users/{userId}/calls")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProductAccountCalls",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateParams(productUserParamsSchema),
  )
  public async listManagedCallLogs(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.accounts.calls(request, product, { userId });
  }

  @Get("{product}/accounts/{accountId}/usage")
  @CheckPermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:developer:GetProductAccountUsage",
    resourceKind: "single-resource",
    resource: platformDeveloperUsageAccountResource,
  })
  @Middlewares(validateParams(productAccountParamsSchema))
  public async getUsage(
    @Path() product: DeveloperProductCode,
    @Path() accountId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductUsageDto> {
    return this.accounts.usage(request, product, { accountId });
  }

  @Get("{product}/accounts/{accountId}/calls")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProductAccountCalls",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateParams(productAccountParamsSchema),
  )
  public async listCallLogs(
    @Path() product: DeveloperProductCode,
    @Path() accountId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.accounts.calls(request, product, { accountId });
  }
}
