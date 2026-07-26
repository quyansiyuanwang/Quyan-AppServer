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
import type { TypedRequest } from "@/types/express";
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
} from "@/api/dto/developer/developer.dto";
import type { DeveloperProductInstanceDto } from "@/api/dto/developer/product-platform.dto";
import type { DeveloperProductCode } from "@appserver/shared";
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
  ) {
    return this.products.getManagementContext(request.user!.userId, product, instanceId, permission);
  }

  private async assertPushSecretReference(
    request: TypedRequest,
    secretReference: { secretInstanceId: string; alias: string } | null | undefined,
  ): Promise<void> {
    if (!secretReference) return;
    await this.context(request, "secret", secretReference.secretInstanceId, Permission.PRODUCT_SECRET_READ);
    await this.context(request, "secret", secretReference.secretInstanceId, Permission.PRODUCT_SECRET_USE);
  }

  @Get("kv/instances/{instanceId}/entries")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listKv(@Path() instanceId: string, @Request() request: TypedRequest) {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_READ);
    return this.projects.listKv(context.backingProjectId);
  }

  @Get("kv/instances/{instanceId}/entries/{key}")
  @Middlewares(validateParams(productResourceKvParamsSchema))
  public async getKv(
    @Path() instanceId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_READ);
    return this.projects.getKv(context.backingProjectId, key);
  }

  @Post("kv/instances/{instanceId}/entries/{key}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceKvParamsSchema),
    validateBody(setKvValueBodySchema),
  )
  public async setKv(
    @Path() instanceId: string,
    @Path() key: string,
    @Body() body: SetKvValueDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_WRITE);
    return this.projects.setKv(context.backingProjectId, key, body);
  }

  @Delete("kv/instances/{instanceId}/entries/{key}")
  @Middlewares(replayProtectionMiddleware, validateParams(productResourceKvParamsSchema))
  public async deleteKv(
    @Path() instanceId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(request, "kv", instanceId, Permission.PRODUCT_KV_WRITE);
    await this.projects.deleteKv(context.backingProjectId, key);
    return { success: true };
  }

  @Get("short_link/instances/{instanceId}/links")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listShortLinks(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto[]> {
    const context = await this.context(request, "short_link", instanceId, Permission.PRODUCT_SHORT_LINK_READ);
    return this.projects.listShortLinks(context.backingProjectId, context.accountOwnerId);
  }

  @Post("short_link/instances/{instanceId}/links")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(createShortLinkBodySchema),
  )
  public async createShortLink(
    @Path() instanceId: string,
    @Body() body: CreateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    const context = await this.context(request, "short_link", instanceId, Permission.PRODUCT_SHORT_LINK_WRITE);
    return this.projects.createShortLink(context.backingProjectId, context.accountOwnerId, body);
  }

  @Put("short_link/instances/{instanceId}/links/{id}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceIdParamsSchema),
    validateBody(updateShortLinkBodySchema),
  )
  public async updateShortLink(
    @Path() instanceId: string,
    @Path() id: string,
    @Body() body: UpdateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    const context = await this.context(request, "short_link", instanceId, Permission.PRODUCT_SHORT_LINK_WRITE);
    return this.projects.updateShortLink(context.backingProjectId, id, context.accountOwnerId, body);
  }

  @Delete("short_link/instances/{instanceId}/links/{id}")
  @Middlewares(replayProtectionMiddleware, validateParams(productResourceIdParamsSchema))
  public async deleteShortLink(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(request, "short_link", instanceId, Permission.PRODUCT_SHORT_LINK_MANAGE);
    await this.projects.deleteShortLink(context.backingProjectId, id, context.accountOwnerId);
    return { success: true };
  }

  @Get("short_link/instances/{instanceId}/links/{id}/stats")
  @Middlewares(validateParams(productResourceIdParamsSchema), validateQuery(shortLinkStatsQuerySchema))
  public async shortLinkStats(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperShortLinkStatsDto> {
    const context = await this.context(request, "short_link", instanceId, Permission.PRODUCT_SHORT_LINK_READ);
    return this.projects.getShortLinkStats(context.backingProjectId, id, context.accountOwnerId, page, pageSize);
  }

  @Get("secret/instances/{instanceId}/secrets")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listSecrets(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto[]> {
    const context = await this.context(request, "secret", instanceId, Permission.PRODUCT_SECRET_READ);
    return this.projects.listSecrets(context.backingProjectId, context.accountOwnerId);
  }

  @Post("secret/instances/{instanceId}/secrets")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(upsertSecretBodySchema),
  )
  public async upsertSecret(
    @Path() instanceId: string,
    @Body() body: UpsertDeveloperSecretDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto> {
    const context = await this.context(request, "secret", instanceId, Permission.PRODUCT_SECRET_WRITE);
    return this.projects.upsertSecret(context.backingProjectId, context.accountOwnerId, body);
  }

  @Delete("secret/instances/{instanceId}/secrets/{alias}")
  @Middlewares(replayProtectionMiddleware, validateParams(productResourceAliasParamsSchema))
  public async deleteSecret(
    @Path() instanceId: string,
    @Path() alias: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(request, "secret", instanceId, Permission.PRODUCT_SECRET_MANAGE);
    await this.projects.deleteSecret(context.backingProjectId, alias, context.accountOwnerId);
    return { success: true };
  }

  @Get("status/instances/{instanceId}/monitors")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listMonitors(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto[]> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_READ);
    return this.projects.listStatusMonitors(context.backingProjectId, context.accountOwnerId);
  }

  @Post("status/instances/{instanceId}/monitors")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(createStatusMonitorBodySchema),
  )
  public async createMonitor(
    @Path() instanceId: string,
    @Body() body: CreateDeveloperStatusMonitorDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_WRITE);
    return this.projects.createStatusMonitor(context.backingProjectId, context.accountOwnerId, body);
  }

  @Put("status/instances/{instanceId}/monitors/{id}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceIdParamsSchema),
    validateBody(updateStatusMonitorBodySchema),
  )
  public async updateMonitor(
    @Path() instanceId: string,
    @Path() id: string,
    @Body() body: UpdateDeveloperStatusMonitorDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_WRITE);
    return this.projects.updateStatusMonitor(context.backingProjectId, id, context.accountOwnerId, body);
  }

  @Delete("status/instances/{instanceId}/monitors/{id}")
  @Middlewares(replayProtectionMiddleware, validateParams(productResourceIdParamsSchema))
  public async deleteMonitor(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_MANAGE);
    await this.projects.deleteStatusMonitor(context.backingProjectId, id, context.accountOwnerId);
    return { success: true };
  }

  @Post("status/instances/{instanceId}/monitors/{id}/check")
  @Middlewares(replayProtectionMiddleware, validateParams(productResourceIdParamsSchema))
  public async checkMonitor(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_WRITE);
    return this.products.executeMeteredForInstance(instanceId, "status", Permission.PRODUCT_STATUS_WRITE, () =>
      this.projects.checkStatusMonitor(context.backingProjectId, id, context.accountOwnerId),
    );
  }

  @Put("status/instances/{instanceId}/page")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(updateStatusPageBodySchema),
  )
  public async updateStatusPage(
    @Path() instanceId: string,
    @Body() body: UpdateDeveloperStatusPageDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_PUBLISH);
    return this.projects.updateStatusPage(context.backingProjectId, context.accountOwnerId, body);
  }

  @Get("status/instances/{instanceId}/page")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async getStatusPage(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    const context = await this.context(request, "status", instanceId, Permission.PRODUCT_STATUS_PUBLISH);
    return this.projects.getProject(context.backingProjectId, context.accountOwnerId);
  }

  @Get("push/instances/{instanceId}/channels")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listPushChannels(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto[]> {
    const context = await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    return this.projects.listPushChannels(context.backingProjectId, context.accountOwnerId);
  }

  /** Lists selectable Secret Management instances for a push channel. */
  @Get("push/instances/{instanceId}/secret-projects")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listPushSecretProjects(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProductInstanceDto[]> {
    await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    return this.products.listInstancesWithPermission(request.user!.userId, "secret", Permission.PRODUCT_SECRET_READ);
  }

  /** Lists metadata for write-only credentials within a selected Secret Management instance. */
  @Get("push/instances/{instanceId}/secret-projects/{secretInstanceId}/secrets")
  @Middlewares(validateParams(productPushSecretInstanceParamsSchema))
  public async listPushSecretProjectSecrets(
    @Path() instanceId: string,
    @Path() secretInstanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto[]> {
    await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    const secretContext = await this.context(request, "secret", secretInstanceId, Permission.PRODUCT_SECRET_READ);
    return this.projects.listSecrets(secretContext.backingProjectId, secretContext.accountOwnerId);
  }

  /** Quickly creates or rotates a write-only credential in the selected Secret Management instance. */
  @Post("push/instances/{instanceId}/secret-projects/{secretInstanceId}/secrets")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productPushSecretInstanceParamsSchema),
    validateBody(upsertSecretBodySchema),
  )
  public async upsertPushSecretProjectSecret(
    @Path() instanceId: string,
    @Path() secretInstanceId: string,
    @Body() body: UpsertDeveloperSecretDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto> {
    await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    const secretContext = await this.context(request, "secret", secretInstanceId, Permission.PRODUCT_SECRET_WRITE);
    return this.projects.upsertSecret(secretContext.backingProjectId, secretContext.accountOwnerId, body);
  }

  @Get("push/instances/{instanceId}/deliveries")
  @Middlewares(validateParams(productResourceInstanceParamsSchema))
  public async listPushDeliveries(
    @Path() instanceId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushDeliveryDto[]> {
    const context = await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_DELIVERY_READ);
    return this.projects.listPushDeliveries(context.backingProjectId, context.accountOwnerId);
  }

  @Post("push/instances/{instanceId}/channels")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceInstanceParamsSchema),
    validateBody(createPushChannelBodySchema),
  )
  public async createPushChannel(
    @Path() instanceId: string,
    @Body() body: CreateDeveloperPushChannelDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto> {
    const context = await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    await this.assertPushSecretReference(request, body.secretReference);
    return this.projects.createPushChannel(context.backingProjectId, context.accountOwnerId, body);
  }

  @Put("push/instances/{instanceId}/channels/{id}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(productResourceIdParamsSchema),
    validateBody(updatePushChannelBodySchema),
  )
  public async updatePushChannel(
    @Path() instanceId: string,
    @Path() id: string,
    @Body() body: UpdateDeveloperPushChannelDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto> {
    const context = await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    const effectiveSecretReference =
      body.secretReference === undefined
        ? await this.projects.getPushChannelSecretReference(context.backingProjectId, id, context.accountOwnerId)
        : body.secretReference;
    await this.assertPushSecretReference(request, effectiveSecretReference);
    return this.projects.updatePushChannel(context.backingProjectId, id, context.accountOwnerId, body);
  }

  @Delete("push/instances/{instanceId}/channels/{id}")
  @Middlewares(replayProtectionMiddleware, validateParams(productResourceIdParamsSchema))
  public async deletePushChannel(
    @Path() instanceId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    const context = await this.context(request, "push", instanceId, Permission.PRODUCT_PUSH_CHANNEL_MANAGE);
    await this.projects.deletePushChannel(context.backingProjectId, id, context.accountOwnerId);
    return { success: true };
  }
}
