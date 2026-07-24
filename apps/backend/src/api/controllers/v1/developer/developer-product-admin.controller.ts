import { Body, Controller, Get, Middlewares, Path, Put, Route, Security, Tags } from "@tsoa/runtime";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import type {
  DeveloperProductCallLogDto,
  DeveloperProductConfigDto,
  DeveloperProductAccountDto,
  DeveloperProductUsageDto,
  UpdateDeveloperProductConfigDto,
} from "@/api/dto/developer/product-platform.dto";
import {
  productCodeParamsSchema,
  productAccountParamsSchema,
  updateProductConfigBodySchema,
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

  @Get("accounts")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  public async listAccounts(): Promise<DeveloperProductAccountDto[]> {
    return this.service.listAccounts();
  }

  @Get("{product}/accounts")
  @RequirePermission(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
  @Middlewares(validateParams(productCodeParamsSchema))
  public async listProductAccounts(
    @Path() product: DeveloperProductCode,
  ): Promise<DeveloperProductAccountDto[]> {
    return this.service.listAccounts(product);
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
