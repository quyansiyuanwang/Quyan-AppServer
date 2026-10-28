import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type { RequestHandler } from "express";
import type { TypedRequest } from "@/types/express";
import { env } from "@/config/env";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import {
  developerProductInstanceListResourceResolver,
  developerProductJsonProjectResourceResolver,
  developerProductKvProjectResourceResolver,
  developerProductKvItemResourceResolver,
  developerProductShortLinkProjectResourceResolver,
  developerProductShortLinkResourceResolver,
  developerProductSecretProjectResourceResolver,
  developerProductSecretResourceResolver,
  developerProductStatusProjectResourceResolver,
  developerProductStatusMonitorResourceResolver,
  developerProductPushProjectResourceResolver,
  developerProductPushChannelResourceResolver,
  developerProductSecretInstanceProjectResourceResolver,
  developerProductSecretInstanceResourceResolver,
} from "@/iam/request/developer-product-resource-resolvers";
import { DeveloperProductPlatformService } from "@/services/developer/developer-product-platform.service";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import { Permission } from "@/constant/permission";
import type {
  CreateDeveloperPushChannelDto,
  CreateDeveloperStatusMonitorDto,
  CreateShortLinkDto,
  DeveloperKvValueDto,
  DeveloperProjectDto,
  DeveloperPushChannelDto,
  DeveloperPushDeliveryDto,
  DeveloperSecretDto,
  DeveloperShortLinkDto,
  DeveloperShortLinkStatsDto,
  DeveloperStatusMonitorDto,
  SetKvValueDto,
  UpdateDeveloperPushChannelDto,
  UpdateDeveloperStatusMonitorDto,
  UpdateDeveloperStatusPageDto,
  UpdateShortLinkDto,
  UpsertDeveloperSecretDto,
  DeveloperJsonEndpointDto,
  UpdateDeveloperJsonEndpointDto,
} from "@/api/dto/developer/developer.dto";
import type { DeveloperProductInstanceDto } from "@/api/dto/developer/product-platform.dto";
import type { DeveloperProductCode } from "@quyan/shared";
import {
  createPushChannelBodySchema,
  createShortLinkBodySchema,
  createStatusMonitorBodySchema,
  setKvValueBodySchema,
  updatePushChannelBodySchema,
  updateShortLinkBodySchema,
  updateStatusMonitorBodySchema,
  updateStatusPageBodySchema,
  upsertSecretBodySchema,
  updateJsonEndpointBodySchema,
} from "@/api/schema/developer/developer.schema";
import {
  productResourceAliasParamsSchema,
  productResourceIdParamsSchema,
  productResourceInstanceParamsSchema,
  productResourceKvParamsSchema,
  productPushSecretInstanceParamsSchema,
  shortLinkStatsQuerySchema,
} from "@/api/schema/developer/product-platform.schema";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";

@Route("v1/products")
@Tags("Developer Product Resources")
@Security("jwt")
export class DeveloperProductResourceController extends Controller {
  private readonly products = DeveloperProductPlatformService.getInstance();
  private readonly projects = DeveloperProjectService.getInstance();

  private async context(
    request: TypedRequest,
    product: DeveloperProductCode,
    instanceId: string,
    permission: Permission,
    iamAction: string,
  ) {
    const iamAuthorized =
      env.security.iamAuthorizationMode === "enforce" &&
      request.iamDecisions?.some((decision) => decision.action === iamAction && decision.decision === "Allow");
    return this.products.getManagementContext(request.user!.userId, product, instanceId, permission, { iamAuthorized });
  }

  private async assertPushSecretReference(
    request: TypedRequest,
    secretReference: { secretInstanceId: string; alias: string } | null | undefined,
  ): Promise<void> {
    if (!secretReference) return;
    await this.context(
      request,
      "secret",
      secretReference.secretInstanceId,
      Permission.PRODUCT_SECRET_READ,
      "quyan:developer:ListSecrets",
    );
    await this.context(
      request,
      "secret",
      secretReference.secretInstanceId,
      Permission.PRODUCT_SECRET_USE,
      "quyan:developer:UseSecret",
    );
  }

  @Get("json-endpoints/instances/{instanceId}")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetJsonEndpoint",
      resourceKind: "single-resource",
      resource: developerProductJsonProjectResourceResolver,
    }),
  )
  public async getJsonEndpoint(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperJsonEndpointDto> {
    await this.context(
      request,
      "json_endpoint",
      instanceId,
      Permission.JSON_ENDPOINT_READ,
      "quyan:developer:GetJsonEndpoint",
    );
    return this.products.getJsonEndpoint(instanceId);
  }

  @Put("json-endpoints/instances/{instanceId}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(updateJsonEndpointBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateJsonEndpoint",
      resourceKind: "single-resource",
      resource: developerProductJsonProjectResourceResolver,
    }),
  )
  public async updateJsonEndpoint(
    @Path() instanceId: string,
    @Body() body: UpdateDeveloperJsonEndpointDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperJsonEndpointDto> {
    await this.context(
      request,
      "json_endpoint",
      instanceId,
      Permission.JSON_ENDPOINT_UPDATE,
      "quyan:developer:UpdateJsonEndpoint",
    );
    return this.products.updateJsonEndpoint(instanceId, body.jsonContent);
  }

  @Get("kv/instances/{instanceId}/entries")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListKv",
      resourceKind: "single-resource",
      resource: developerProductKvProjectResourceResolver,
    }),
  )
  public async listKv(@Path() instanceId: string, @Request() request: TypedRequest) {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_READ, "quyan:developer:ListKv");
    return this.projects.listKv(context.backingProjectId);
  }

  @Get("kv/instances/{instanceId}/entries/{key}")
  @Middlewares(
    validateParams(productResourceKvParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetKv",
      resourceKind: "single-resource",
      resource: developerProductKvItemResourceResolver,
    }),
  )
  public async getKv(
    @Path() instanceId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_READ, "quyan:developer:GetKv");
    return this.projects.getKv(context.backingProjectId, key);
  }

  @Post("kv/instances/{instanceId}/entries/{key}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceKvParamsSchema),
    validateBody(setKvValueBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:SetKv",
      resourceKind: "single-resource",
      resource: developerProductKvItemResourceResolver,
    }),
  )
  public async setKv(
    @Path() instanceId: string,
    @Path() key: string,
    @Body() body: SetKvValueDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_WRITE, "quyan:developer:SetKv");
    return this.projects.setKv(context.backingProjectId, key, body);
  }

  @Delete("kv/instances/{instanceId}/entries/{key}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceKvParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteKv",
      resourceKind: "single-resource",
      resource: developerProductKvItemResourceResolver,
    }),
  )
  public async deleteKv(
    @Path() instanceId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(
      request,
      "kv",
      instanceId,
      Permission.PRODUCT_KV_WRITE,
      "quyan:developer:DeleteKv",
    );
    await this.projects.deleteKv(context.backingProjectId, key);
    return { success: true };
  }

  @Get("short_link/instances/{instanceId}/links")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListShortLinks",
      resourceKind: "single-resource",
      resource: developerProductShortLinkProjectResourceResolver,
    }),
  )
  public async listShortLinks(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto[]> {
    const context = await this.context(
      request,
      "short_link",
      instanceId,
      Permission.PRODUCT_SHORT_LINK_READ,
      "quyan:developer:ListShortLinks",
    );
    return this.projects.listShortLinks(context.backingProjectId, context.accountOwnerId);
  }

  @Post("short_link/instances/{instanceId}/links")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(createShortLinkBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreateShortLink",
      resourceKind: "single-resource",
      resource: developerProductShortLinkProjectResourceResolver,
    }),
  )
  public async createShortLink(
    @Path() instanceId: string,
    @Body() body: CreateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    const context = await this.context(
      request,
      "short_link",
      instanceId,
      Permission.PRODUCT_SHORT_LINK_WRITE,
      "quyan:developer:CreateShortLink",
    );
    return this.projects.createShortLink(context.backingProjectId, context.accountOwnerId, body);
  }

  @Put("short_link/instances/{instanceId}/links/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    validateBody(updateShortLinkBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateShortLink",
      resourceKind: "single-resource",
      resource: developerProductShortLinkResourceResolver,
    }),
  )
  public async updateShortLink(
    @Path() instanceId: string,
    @Path() id: string,
    @Body() body: UpdateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    const context = await this.context(
      request,
      "short_link",
      instanceId,
      Permission.PRODUCT_SHORT_LINK_WRITE,
      "quyan:developer:UpdateShortLink",
    );
    return this.projects.updateShortLink(context.backingProjectId, id, context.accountOwnerId, body);
  }

  @Delete("short_link/instances/{instanceId}/links/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteShortLink",
      resourceKind: "single-resource",
      resource: developerProductShortLinkResourceResolver,
    }),
  )
  public async deleteShortLink(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(
      request,
      "short_link",
      instanceId,
      Permission.PRODUCT_SHORT_LINK_MANAGE,
      "quyan:developer:DeleteShortLink",
    );
    await this.projects.deleteShortLink(context.backingProjectId, id, context.accountOwnerId);
    return { success: true };
  }

  @Get("short_link/instances/{instanceId}/links/{id}/stats")
  @Middlewares(
    validateParams(productResourceIdParamsSchema),
    validateQuery(shortLinkStatsQuerySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetShortLinkStats",
      resourceKind: "single-resource",
      resource: developerProductShortLinkResourceResolver,
    }),
  )
  public async shortLinkStats(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperShortLinkStatsDto> {
    const context = await this.context(
      request,
      "short_link",
      instanceId,
      Permission.PRODUCT_SHORT_LINK_READ,
      "quyan:developer:GetShortLinkStats",
    );
    return this.projects.getShortLinkStats(context.backingProjectId, id, context.accountOwnerId, page, pageSize);
  }

  @Get("secret/instances/{instanceId}/secrets")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListSecrets",
      resourceKind: "single-resource",
      resource: developerProductSecretProjectResourceResolver,
    }),
  )
  public async listSecrets(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto[]> {
    const context = await this.context(
      request,
      "secret",
      instanceId,
      Permission.PRODUCT_SECRET_READ,
      "quyan:developer:ListSecrets",
    );
    return this.projects.listSecrets(context.backingProjectId, context.accountOwnerId);
  }

  @Post("secret/instances/{instanceId}/secrets")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(upsertSecretBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:PutSecret",
      resourceKind: "single-resource",
      resource: developerProductSecretResourceResolver,
    }),
  )
  public async upsertSecret(
    @Path() instanceId: string,
    @Body() body: UpsertDeveloperSecretDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto> {
    const context = await this.context(
      request,
      "secret",
      instanceId,
      Permission.PRODUCT_SECRET_WRITE,
      "quyan:developer:PutSecret",
    );
    return this.projects.upsertSecret(context.backingProjectId, context.accountOwnerId, body);
  }

  @Delete("secret/instances/{instanceId}/secrets/{alias}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceAliasParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteSecret",
      resourceKind: "single-resource",
      resource: developerProductSecretResourceResolver,
    }),
  )
  public async deleteSecret(
    @Path() instanceId: string,
    @Path() alias: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(
      request,
      "secret",
      instanceId,
      Permission.PRODUCT_SECRET_MANAGE,
      "quyan:developer:DeleteSecret",
    );
    await this.projects.deleteSecret(context.backingProjectId, alias, context.accountOwnerId);
    return { success: true };
  }

  @Get("status/instances/{instanceId}/monitors")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListStatusMonitors",
      resourceKind: "single-resource",
      resource: developerProductStatusProjectResourceResolver,
    }),
  )
  public async listMonitors(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto[]> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_READ,
      "quyan:developer:ListStatusMonitors",
    );
    return this.projects.listStatusMonitors(context.backingProjectId, context.accountOwnerId);
  }

  @Post("status/instances/{instanceId}/monitors")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(createStatusMonitorBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreateStatusMonitor",
      resourceKind: "single-resource",
      resource: developerProductStatusProjectResourceResolver,
    }),
  )
  public async createMonitor(
    @Path() instanceId: string,
    @Body() body: CreateDeveloperStatusMonitorDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_WRITE,
      "quyan:developer:CreateStatusMonitor",
    );
    return this.projects.createStatusMonitor(context.backingProjectId, context.accountOwnerId, body);
  }

  @Put("status/instances/{instanceId}/monitors/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    validateBody(updateStatusMonitorBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateStatusMonitor",
      resourceKind: "single-resource",
      resource: developerProductStatusMonitorResourceResolver,
    }),
  )
  public async updateMonitor(
    @Path() instanceId: string,
    @Path() id: string,
    @Body() body: UpdateDeveloperStatusMonitorDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_WRITE,
      "quyan:developer:UpdateStatusMonitor",
    );
    return this.projects.updateStatusMonitor(context.backingProjectId, id, context.accountOwnerId, body);
  }

  @Delete("status/instances/{instanceId}/monitors/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteStatusMonitor",
      resourceKind: "single-resource",
      resource: developerProductStatusMonitorResourceResolver,
    }),
  )
  public async deleteMonitor(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_MANAGE,
      "quyan:developer:DeleteStatusMonitor",
    );
    await this.projects.deleteStatusMonitor(context.backingProjectId, id, context.accountOwnerId);
    return { success: true };
  }

  @Post("status/instances/{instanceId}/monitors/{id}/check")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CheckStatusMonitor",
      resourceKind: "single-resource",
      resource: developerProductStatusMonitorResourceResolver,
    }),
  )
  public async checkMonitor(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_WRITE,
      "quyan:developer:CheckStatusMonitor",
    );
    return this.products.executeMeteredForInstance(instanceId, "status", Permission.PRODUCT_STATUS_WRITE, () =>
      this.projects.checkStatusMonitor(context.backingProjectId, id, context.accountOwnerId),
    );
  }

  @Put("status/instances/{instanceId}/page")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(updateStatusPageBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateStatusPage",
      resourceKind: "single-resource",
      resource: developerProductStatusProjectResourceResolver,
    }),
  )
  public async updateStatusPage(
    @Path() instanceId: string,
    @Body() body: UpdateDeveloperStatusPageDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_PUBLISH,
      "quyan:developer:UpdateStatusPage",
    );
    return this.projects.updateStatusPage(context.backingProjectId, context.accountOwnerId, body);
  }

  @Get("status/instances/{instanceId}/page")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetProject",
      resourceKind: "single-resource",
      resource: developerProductStatusProjectResourceResolver,
    }),
  )
  public async getStatusPage(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    const context = await this.context(
      request,
      "status",
      instanceId,
      Permission.PRODUCT_STATUS_PUBLISH,
      "quyan:developer:GetProject",
    );
    return this.projects.getProject(context.backingProjectId, context.accountOwnerId);
  }

  @Get("push/instances/{instanceId}/channels")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListPushChannels",
      resourceKind: "single-resource",
      resource: developerProductPushProjectResourceResolver,
    }),
  )
  public async listPushChannels(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto[]> {
    const context = await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:ListPushChannels",
    );
    return this.projects.listPushChannels(context.backingProjectId, context.accountOwnerId);
  }

  /** Lists selectable Secret Management instances for a push channel. */
  @Get("push/instances/{instanceId}/secret-projects")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListPushChannels",
      resourceKind: "single-resource",
      resource: developerProductPushProjectResourceResolver,
    }),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListProductInstances",
      resourceKind: "single-resource",
      resource: developerProductInstanceListResourceResolver,
    }),
  )
  public async listPushSecretProjects(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto[]> {
    await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:ListPushChannels",
    );
    const iamAuthorized =
      env.security.iamAuthorizationMode === "enforce" &&
      request.iamDecisions?.some(
        (decision) => decision.action === "quyan:developer:ListProductInstances" && decision.decision === "Allow",
      );
    return this.products.listInstancesWithPermission(request.user!.userId, "secret", Permission.PRODUCT_SECRET_READ, {
      iamAuthorized,
    });
  }

  /** Lists metadata for write-only credentials within a selected Secret Management instance. */
  @Get("push/instances/{instanceId}/secret-projects/{secretInstanceId}/secrets")
  @Middlewares(
    validateParams(productPushSecretInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListPushChannels",
      resourceKind: "single-resource",
      resource: developerProductPushProjectResourceResolver,
    }),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListSecrets",
      resourceKind: "single-resource",
      resource: developerProductSecretInstanceProjectResourceResolver,
    }),
  )
  public async listPushSecretProjectSecrets(
    @Path() instanceId: string,
    @Path() secretInstanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto[]> {
    await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:ListPushChannels",
    );
    const secretContext = await this.context(
      request,
      "secret",
      secretInstanceId,
      Permission.PRODUCT_SECRET_READ,
      "quyan:developer:ListSecrets",
    );
    return this.projects.listSecrets(secretContext.backingProjectId, secretContext.accountOwnerId);
  }

  /** Quickly creates or rotates a write-only credential in the selected Secret Management instance. */
  @Post("push/instances/{instanceId}/secret-projects/{secretInstanceId}/secrets")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productPushSecretInstanceParamsSchema),
    validateBody(upsertSecretBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListPushChannels",
      resourceKind: "single-resource",
      resource: developerProductPushProjectResourceResolver,
    }),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:PutSecret",
      resourceKind: "single-resource",
      resource: developerProductSecretInstanceResourceResolver,
    }),
  )
  public async upsertPushSecretProjectSecret(
    @Path() instanceId: string,
    @Path() secretInstanceId: string,
    @Body() body: UpsertDeveloperSecretDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto> {
    await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:ListPushChannels",
    );
    const secretContext = await this.context(
      request,
      "secret",
      secretInstanceId,
      Permission.PRODUCT_SECRET_WRITE,
      "quyan:developer:PutSecret",
    );
    return this.projects.upsertSecret(secretContext.backingProjectId, secretContext.accountOwnerId, body);
  }

  @Get("push/instances/{instanceId}/deliveries")
  @Middlewares(
    validateParams(productResourceInstanceParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:ListPushDeliveries",
      resourceKind: "single-resource",
      resource: developerProductPushProjectResourceResolver,
    }),
  )
  public async listPushDeliveries(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushDeliveryDto[]> {
    const context = await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_DELIVERY_READ,
      "quyan:developer:ListPushDeliveries",
    );
    return this.projects.listPushDeliveries(context.backingProjectId, context.accountOwnerId);
  }

  @Post("push/instances/{instanceId}/channels")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(createPushChannelBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreatePushChannel",
      resourceKind: "single-resource",
      resource: developerProductPushProjectResourceResolver,
    }),
  )
  public async createPushChannel(
    @Path() instanceId: string,
    @Body() body: CreateDeveloperPushChannelDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto> {
    const context = await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:CreatePushChannel",
    );
    await this.assertPushSecretReference(request, body.secretReference);
    return this.projects.createPushChannel(context.backingProjectId, context.accountOwnerId, body);
  }

  @Put("push/instances/{instanceId}/channels/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    validateBody(updatePushChannelBodySchema),

    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdatePushChannel",
      resourceKind: "single-resource",
      resource: developerProductPushChannelResourceResolver,
    }),
  )
  public async updatePushChannel(
    @Path() instanceId: string,
    @Path() id: string,
    @Body() body: UpdateDeveloperPushChannelDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto> {
    const context = await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:UpdatePushChannel",
    );
    const effectiveSecretReference =
      body.secretReference === undefined
        ? await this.projects.getPushChannelSecretReference(context.backingProjectId, id, context.accountOwnerId)
        : body.secretReference;
    await this.assertPushSecretReference(request, effectiveSecretReference);
    return this.projects.updatePushChannel(context.backingProjectId, id, context.accountOwnerId, body);
  }

  @Delete("push/instances/{instanceId}/channels/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(productResourceIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeletePushChannel",
      resourceKind: "single-resource",
      resource: developerProductPushChannelResourceResolver,
    }),
  )
  public async deletePushChannel(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(
      request,
      "push",
      instanceId,
      Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      "quyan:developer:DeletePushChannel",
    );
    await this.projects.deletePushChannel(context.backingProjectId, id, context.accountOwnerId);
    return { success: true };
  }
}
