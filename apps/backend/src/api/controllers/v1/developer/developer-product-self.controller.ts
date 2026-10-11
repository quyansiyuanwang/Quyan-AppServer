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
import type { RequestHandler } from "express";
import type { TypedRequest } from "@/types/express";
import { env } from "@/config/env";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { developerProductInstanceProjectResourceResolver } from "@/iam/request/developer-product-resource-resolvers";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
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

  private iamAuthorized(request: TypedRequest, action: string): boolean {
    return (
      env.security.iamAuthorizationMode === "enforce" &&
      request.iamDecisions?.some((decision) => decision.action === action && decision.decision === "Allow") === true
    );
  }

  @Get("catalog")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetProductCatalog",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async catalog() {
    const configs = await this.service.listConfigs();
    return DEVELOPER_PRODUCTS.map((product) => ({
      ...product,
      config: configs.find((config) => config.productCode === product.code),
    }));
  }

  @Get("{product}/instances")
  @Middlewares(
    validateParams(productCodeParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListProductInstances",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listInstances(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto[]> {
    return this.service.listInstances(request.user!.userId, product, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:ListProductInstances"),
    });
  }

  @Get("{product}/usage")
  @Middlewares(
    validateParams(productCodeParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetProductUsage",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async getUsage(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductUsageDto> {
    return this.service.getUsageForActor(request.user!.userId, product, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:GetProductUsage"),
    });
  }

  @Get("{product}/calls")
  @Middlewares(
    validateParams(productCodeParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListProductCallLogs",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listCallLogs(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductCallLogDto[]> {
    return this.service.listCallLogsForActor(request.user!.userId, product, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:ListProductCallLogs"),
    });
  }

  @Post("{product}/instances")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productCodeParamsSchema),
    validateBody(createProductInstanceBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreateProductInstance",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async createInstance(
    @Path() product: DeveloperProductCode,
    @Body() body: CreateDeveloperProductInstanceDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto> {
    return this.service.createInstance(request.user!.userId, product, body, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:CreateProductInstance"),
    });
  }

  @Put("{product}/instances/{instanceId}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productInstanceParamsSchema),
    validateBody(updateProductInstanceBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateProductInstance",
      resourceKind: "single-resource",
      resource: developerProductInstanceProjectResourceResolver,
    }),
  )
  public async updateInstance(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Body() body: UpdateDeveloperProductInstanceDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto> {
    return this.service.updateInstance(request.user!.userId, product, instanceId, body, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:UpdateProductInstance"),
    });
  }

  @Delete("{product}/instances/{instanceId}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteProductInstance",
      resourceKind: "single-resource",
      resource: developerProductInstanceProjectResourceResolver,
    }),
  )
  public async deleteInstance(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deleteInstance(request.user!.userId, product, instanceId, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:DeleteProductInstance"),
    });
    return { success: true };
  }

  @Get("{product}/subjects")
  @Middlewares(
    validateParams(productCodeParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListProductSubjects",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listSubjects(
    @Path() product: DeveloperProductCode,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductSubjectDto[]> {
    return this.service.listSubjects(request.user!.userId, product, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:ListProductSubjects"),
    });
  }

  @Get("{product}/instances/{instanceId}/keys")
  @Middlewares(
    validateParams(productInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListProductInstanceKeys",
      resourceKind: "single-resource",
      resource: developerProductInstanceProjectResourceResolver,
    }),
  )
  public async listKeys(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductApiKeyDto[]> {
    return this.service.listKeys(request.user!.userId, product, instanceId, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:ListProductInstanceKeys"),
    });
  }

  @Post("{product}/instances/{instanceId}/keys")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productInstanceParamsSchema),
    validateBody(createProductKeyBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreateProductInstanceKey",
      resourceKind: "single-resource",
      resource: developerProductInstanceProjectResourceResolver,
    }),
  )
  public async createKey(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Body() body: CreateDeveloperProductApiKeyDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductApiKeyDto> {
    return this.service.createKey(request.user!.userId, product, instanceId, body, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:CreateProductInstanceKey"),
    });
  }

  @Delete("{product}/instances/{instanceId}/keys/{keyId}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productKeyParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:RevokeProductInstanceKey",
      resourceKind: "single-resource",
      resource: developerProductInstanceProjectResourceResolver,
    }),
  )
  public async revokeKey(
    @Path() product: DeveloperProductCode,
    @Path() instanceId: string,
    @Path() keyId: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.revokeKey(request.user!.userId, product, instanceId, keyId, {
      iamAuthorized: this.iamAuthorized(request, "quyan:developer:RevokeProductInstanceKey"),
    });
    return { success: true };
  }
}
