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
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { DeveloperProductCode } from "@appserver/shared";

@Route("v1/admin/products")
@Tags("Developer Product Administration")
@Security("jwt")
export class DeveloperProductAdminController extends Controller {
  private readonly service = DeveloperProductPlatformService.getInstance();

  @Get("configs")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE)
  public async listConfigs(): Promise<DeveloperProductConfigDto[]> {
    return this.service.listConfigs();
  }

  @Put("{product}/config")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productCodeParamsSchema),
    validateBody(updateProductConfigBodySchema),
  )
  public async updateConfig(
    @Path() product: DeveloperProductCode,
    @Body() body: UpdateDeveloperProductConfigDto,
  ): Promise<DeveloperProductConfigDto> {
    return this.service.updateConfig(product, body);
  }

  @Get("accounts")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  public async listAccounts(): Promise<DeveloperProductAccountDto[]> {
    return this.service.listAccounts();
  }

  @Get("{product}/accounts")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productCodeParamsSchema))
  public async listProductAccounts(@Path() product: DeveloperProductCode): Promise<DeveloperProductAccountDto[]> {
    return this.service.listAccounts(product);
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
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productUserParamsSchema))
  public async listManagedInstances(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
  ): Promise<DeveloperProductInstanceDto[]> {
    return this.service.listManagedInstances(product, userId);
  }

  @Get("{product}/users/{userId}/usage")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productUserParamsSchema))
  public async getManagedUsage(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
  ): Promise<DeveloperProductUsageDto> {
    return this.service.getManagedUsage(product, userId);
  }

  @Get("{product}/users/{userId}/calls")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productUserParamsSchema))
  public async listManagedCallLogs(
    @Path() product: DeveloperProductCode,
    @Path() userId: string,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.service.listManagedCallLogs(product, userId);
  }

  @Get("{product}/accounts/{accountId}/usage")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productAccountParamsSchema))
  public async getUsage(
    @Path() product: DeveloperProductCode,
    @Path() accountId: string,
  ): Promise<DeveloperProductUsageDto> {
    return this.service.getUsageForProduct(product, accountId);
  }

  @Get("{product}/accounts/{accountId}/calls")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productAccountParamsSchema))
  public async listCallLogs(
    @Path() product: DeveloperProductCode,
    @Path() accountId: string,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.service.listCallLogs(product, accountId);
  }
}
