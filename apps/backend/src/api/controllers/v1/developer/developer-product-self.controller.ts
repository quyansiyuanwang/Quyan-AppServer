import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import type {
  CreateDeveloperProductApiKeyDto,
  CreateDeveloperProductInstanceDto,
  DeveloperProductApiKeyDto,
  DeveloperProductInstanceDto,
  DeveloperProductSubjectDto,
  DeveloperProductUsageDto,
  DeveloperProductCallLogDto,
  UpdateDeveloperProductInstanceDto,
} from "@/api/dto/developer/product-platform.dto";
import {
  createProductInstanceBodySchema,
  createProductKeyBodySchema,
  productCodeParamsSchema,
  productInstanceParamsSchema,
  productKeyParamsSchema,
  updateProductInstanceBodySchema,
} from "@/api/schema/developer/product-platform.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
import { DEVELOPER_PRODUCTS, type DeveloperProductCode } from "@quyan/shared";

@Route("v1/products")
@Tags("Developer Products")
@Security("jwt")
export class DeveloperProductSelfController extends Controller {
  private readonly service = DeveloperProductPlatformService.getInstance();

  @Get("catalog")
  public async catalog() {
    const configs = await this.service.listConfigs();
    return DEVELOPER_PRODUCTS.map((product) => ({
      ...product,
      config: configs.find((config) => config.productCode === product.code),
    }));
  }

  @Get("{product}/instances")
  @Middlewares(validateParams(productCodeParamsSchema))
  public async listInstances(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto[]> {
    return this.service.listInstances(request.user!.userId, product);
  }

  @Get("{product}/usage")
  @Middlewares(validateParams(productCodeParamsSchema))
  public async getUsage(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductUsageDto> {
    return this.service.getUsageForActor(request.user!.userId, product);
  }

  @Get("{product}/calls")
  @Middlewares(validateParams(productCodeParamsSchema))
  public async listCallLogs(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.service.listCallLogsForActor(request.user!.userId, product);
  }

  @Post("{product}/instances")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productCodeParamsSchema),
    validateBody(createProductInstanceBodySchema),
  )
  public async createInstance(
    @Path() product: DeveloperProductCode,
    @Body() body: CreateDeveloperProductInstanceDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto> {
    return this.service.createInstance(request.user!.userId, product, body);
  }

  @Put("{product}/instances/{instanceId}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productInstanceParamsSchema),
    validateBody(updateProductInstanceBodySchema),
  )
  public async updateInstance(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Body() body: UpdateDeveloperProductInstanceDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto> {
    return this.service.updateInstance(request.user!.userId, product, instanceId, body);
  }

  @Delete("{product}/instances/{instanceId}")
  @Middlewares(replayProtectionMiddleware, validateParams(productInstanceParamsSchema))
  public async deleteInstance(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deleteInstance(request.user!.userId, product, instanceId);
    return { success: true };
  }

  @Get("{product}/subjects")
  @Middlewares(validateParams(productCodeParamsSchema))
  public async listSubjects(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductSubjectDto[]> {
    return this.service.listSubjects(request.user!.userId, product);
  }

  @Get("{product}/instances/{instanceId}/keys")
  @Middlewares(validateParams(productInstanceParamsSchema))
  public async listKeys(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductApiKeyDto[]> {
    return this.service.listKeys(request.user!.userId, product, instanceId);
  }

  @Post("{product}/instances/{instanceId}/keys")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productInstanceParamsSchema),
    validateBody(createProductKeyBodySchema),
  )
  public async createKey(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Body() body: CreateDeveloperProductApiKeyDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductApiKeyDto> {
    return this.service.createKey(request.user!.userId, product, instanceId, body);
  }

  @Delete("{product}/instances/{instanceId}/keys/{keyId}")
  @Middlewares(replayProtectionMiddleware, validateParams(productKeyParamsSchema))
  public async revokeKey(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Path() keyId: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.revokeKey(request.user!.userId, product, instanceId, keyId);
    return { success: true };
  }
}
