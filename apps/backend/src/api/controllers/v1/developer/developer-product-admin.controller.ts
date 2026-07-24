import { Body, Controller, Get, Middlewares, Path, Post, Put, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import type {
  DeveloperProductCallLogDto,
  DeveloperProductConfigDto,
  DeveloperProductEntitlementDto,
  DeveloperProductUsageDto,
  UpdateDeveloperProductConfigDto,
  UpsertDeveloperProductEntitlementDto,
} from "@/api/dto/developer/product-platform.dto";
import {
  productCodeParamsSchema,
  productEntitlementParamsSchema,
  updateProductConfigBodySchema,
  upsertProductEntitlementBodySchema,
} from "@/api/schema/developer/product-platform.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
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

  @Get("entitlements")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  public async listEntitlements(): Promise<DeveloperProductEntitlementDto[]> {
    return this.service.listEntitlements();
  }

  @Get("{product}/entitlements")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productCodeParamsSchema))
  public async listProductEntitlements(
    @Path() product: DeveloperProductCode,
  ): Promise<DeveloperProductEntitlementDto[]> {
    return this.service.listEntitlements(product);
  }

  @Get("{product}/entitlements/{entitlementId}/usage")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productEntitlementParamsSchema))
  public async getUsage(
    @Path() product: DeveloperProductCode,
    @Path() entitlementId: string,
  ): Promise<DeveloperProductUsageDto> {
    return this.service.getUsageForProduct(product, entitlementId);
  }

  @Get("{product}/entitlements/{entitlementId}/calls")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productEntitlementParamsSchema))
  public async listCallLogs(
    @Path() product: DeveloperProductCode,
    @Path() entitlementId: string,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.service.listCallLogs(product, entitlementId);
  }

  @Post("{product}/entitlements")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productCodeParamsSchema),
    validateBody(upsertProductEntitlementBodySchema),
  )
  public async upsertEntitlement(
    @Path() product: DeveloperProductCode,
    @Body() body: UpsertDeveloperProductEntitlementDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductEntitlementDto> {
    return this.service.upsertEntitlement(product, body, request.user!.userId);
  }
}
