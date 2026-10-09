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
  Query,
  Route,
  Response,
  Security,
  Tags,
} from "@tsoa/runtime";
import type { RequestHandler } from "express";
import { HttpStatusCode } from "axios";
import type { ErrorResponse } from "@/api/response";
import type { TypedRequest } from "@/types/express";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import {
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import {
  developerProjectResourceResolver,
  iamAuthenticatedUserResourceResolver,
} from "@/iam/request/resource-resolvers";
import {
  developerKvResourceResolver,
  developerSecretResourceResolver,
  developerShortLinkResourceResolver,
  developerProjectApiKeyResourceResolver,
} from "@/iam/request/developer-resource-resolvers";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import type {
  CreateDeveloperApiKeyDto,
  CreateDeveloperProjectDto,
  CreateDeveloperPushChannelDto,
  CreateDeveloperStatusMonitorDto,
  CreateShortLinkDto,
  DeveloperApiKeyDto,
  DeveloperApiKeyPageDto,
  DeveloperKvValueDto,
  DeveloperKvPageDto,
  DeveloperSecretPageDto,
  DeveloperProjectDto,
  DeveloperProjectPageDto,
  DeveloperQuotaSummaryDto,
  DeveloperPushChannelDto,
  DeveloperPushDeliveryDto,
  DeveloperSecretDto,
  DeveloperShortLinkDto,
  DeveloperShortLinkPageDto,
  DeveloperShortLinkStatsDto,
  DeveloperStatusMonitorDto,
  SetKvValueDto,
  UpdateDeveloperStatusMonitorDto,
  UpdateDeveloperPushChannelDto,
  UpdateDeveloperStatusPageDto,
  UpdateShortLinkDto,
  UpsertDeveloperSecretDto,
} from "@/api/dto/developer/developer.dto";
import {
  createProjectApiKeyBodySchema,
  createProjectBodySchema,
  createPushChannelBodySchema,
  createShortLinkBodySchema,
  createStatusMonitorBodySchema,
  idParamsSchema,
  developerItemIdParamsSchema,
  kvKeyParamsSchema,
  secretAliasParamsSchema,
  projectIdParamsSchema,
  setKvValueBodySchema,
  updateShortLinkBodySchema,
  updateStatusMonitorBodySchema,
  updatePushChannelBodySchema,
  updateStatusPageBodySchema,
  upsertSecretBodySchema,
} from "@/api/schema/developer/developer.schema";

@Route("v1/developer/projects")
@Tags("Developer Projects")
@Security("jwt")
@Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
@Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
export class DeveloperProjectController extends Controller {
  private readonly service = DeveloperProjectService.getInstance();
  private readonly management = DeveloperProjectManagementService.getInstance();

  @Get()
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProjects",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async list(@Request() request: TypedRequest): Promise<DeveloperProjectDto[]> {
    return this.management.listProjects(request.user!.userId);
  }

  @Get("page")
  @Middlewares(
    validateQuery(iamManagementPaginationSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProjects",
      resourceKind: "collection",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async listPage(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperProjectPageDto> {
    return this.management.listProjectsPage(request.user!.userId, { page, pageSize });
  }

  @Get("{projectId}")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetProject",
      resourceKind: "single-resource",
      resource: developerProjectResourceResolver,
    }),
  )
  public async getProject(@Path() projectId: string, @Request() request: TypedRequest): Promise<DeveloperProjectDto> {
    return this.management.getProject(projectId, request.user!.userId);
  }

  @Post()
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateBody(createProjectBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreateProject",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async create(
    @Body() body: CreateDeveloperProjectDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    return this.management.createProject(request.user!.userId, body);
  }

  @Get("{projectId}/usage")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetProjectUsage",
      resourceKind: "single-resource",
      resource: developerProjectResourceResolver,
    }),
  )
  public async getUsageSummary(
    @Path() projectId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperQuotaSummaryDto> {
    return this.management.getQuotaSummary(projectId, request.user!.userId);
  }

  @Put("{projectId}/status-page")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateBody(updateStatusPageBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateStatusPage",
      resourceKind: "single-resource",
      resource: developerProjectResourceResolver,
    }),
  )
  public async updateStatusPage(
    @Path() projectId: string,
    @Body() body: UpdateDeveloperStatusPageDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    return this.management.updateStatusPage(projectId, request.user!.userId, body);
  }

  @Get("{projectId}/keys/page")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    validateQuery(iamManagementPaginationSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProjectApiKeys",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listKeysPage(
    @Path() projectId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperApiKeyPageDto> {
    return this.management.listProjectApiKeysPage(projectId, request.user!.userId, { page, pageSize });
  }

  @Get("{projectId}/keys")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListProjectApiKeys",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listKeys(@Path() projectId: string, @Request() request: TypedRequest): Promise<DeveloperApiKeyDto[]> {
    return this.management.listProjectApiKeys(projectId, request.user!.userId);
  }

  @Post("{projectId}/keys")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateBody(createProjectApiKeyBodySchema),
  )
  public async createKey(
    @Path() projectId: string,
    @Body() body: CreateDeveloperApiKeyDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperApiKeyDto> {
    return this.service.createProjectApiKey(projectId, request.user!.userId, body);
  }

  @Delete("{projectId}/keys/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateParams(developerItemIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:RevokeProjectApiKey",
      resourceKind: "single-resource",
      resource: developerProjectApiKeyResourceResolver,
    }),
  )
  public async revokeKey(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.management.revokeProjectApiKey(projectId, id, request.user!.userId);
    return { success: true };
  }

  @Get("{projectId}/kv/entries/page")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    validateQuery(iamManagementPaginationSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListKv",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listKvPage(
    @Path() projectId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperKvPageDto> {
    return this.management.listProjectKvPage(projectId, request.user!.userId, { page, pageSize });
  }

  @Get("{projectId}/kv")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListKv",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listKv(@Path() projectId: string, @Request() request: TypedRequest) {
    return this.management.listProjectKv(projectId, request.user!.userId);
  }

  @Get("{projectId}/kv/{key}")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    validateParams(kvKeyParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetKv",
      resourceKind: "single-resource",
      resource: developerKvResourceResolver,
    }),
  )
  public async getKv(
    @Path() projectId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    return this.management.getProjectKv(projectId, request.user!.userId, key);
  }

  @Post("{projectId}/kv/{key}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateParams(kvKeyParamsSchema),
    validateBody(setKvValueBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:SetKv",
      resourceKind: "single-resource",
      resource: developerKvResourceResolver,
    }),
  )
  public async setKv(
    @Path() projectId: string,
    @Path() key: string,
    @Body() body: SetKvValueDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    return this.management.setProjectKv(projectId, request.user!.userId, key, body);
  }

  @Delete("{projectId}/kv/{key}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateParams(kvKeyParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteKv",
      resourceKind: "single-resource",
      resource: developerKvResourceResolver,
    }),
  )
  public async deleteKv(
    @Path() projectId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.management.deleteProjectKv(projectId, request.user!.userId, key);
    return { success: true };
  }

  @Get("{projectId}/short-links/page")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    validateQuery(iamManagementPaginationSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListShortLinks",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listShortLinksPage(
    @Path() projectId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperShortLinkPageDto> {
    return this.management.listShortLinksPage(projectId, request.user!.userId, { page, pageSize });
  }

  @Get("{projectId}/short-links")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListShortLinks",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listShortLinks(
    @Path() projectId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto[]> {
    return this.management.listShortLinks(projectId, request.user!.userId);
  }

  @Post("{projectId}/short-links")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateBody(createShortLinkBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:CreateShortLink",
      resourceKind: "single-resource",
      resource: developerProjectResourceResolver,
    }),
  )
  public async createShortLink(
    @Path() projectId: string,
    @Body() body: CreateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    return this.management.createShortLink(projectId, request.user!.userId, body);
  }

  @Put("{projectId}/short-links/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateParams(developerItemIdParamsSchema),
    validateBody(updateShortLinkBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:UpdateShortLink",
      resourceKind: "single-resource",
      resource: developerShortLinkResourceResolver,
    }),
  )
  public async updateShortLink(
    @Path() projectId: string,
    @Path() id: string,
    @Body() body: UpdateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    return this.management.updateShortLink(projectId, id, request.user!.userId, body);
  }

  @Delete("{projectId}/short-links/{id}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateParams(developerItemIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteShortLink",
      resourceKind: "single-resource",
      resource: developerShortLinkResourceResolver,
    }),
  )
  public async deleteShortLink(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.management.deleteShortLink(projectId, id, request.user!.userId);
    return { success: true };
  }

  @Get("{projectId}/short-links/{id}/stats")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    validateParams(developerItemIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:GetShortLinkStats",
      resourceKind: "single-resource",
      resource: developerShortLinkResourceResolver,
    }),
  )
  public async getShortLinkStats(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkStatsDto> {
    return this.management.getShortLinkStats(projectId, id, request.user!.userId);
  }

  @Get("{projectId}/secrets/page")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    validateQuery(iamManagementPaginationSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListSecrets",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listSecretsPage(
    @Path() projectId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<DeveloperSecretPageDto> {
    return this.management.listSecretsPage(projectId, request.user!.userId, { page, pageSize });
  }

  @Get("{projectId}/secrets")
  @Middlewares(
    validateParams(projectIdParamsSchema),
    iamCollectionAuthorizationMiddleware({
      action: "quyan:developer:ListSecrets",
      resourceKind: "collection",
      resource: developerProjectResourceResolver,
    }),
  )
  public async listSecrets(@Path() projectId: string, @Request() request: TypedRequest): Promise<DeveloperSecretDto[]> {
    return this.management.listSecrets(projectId, request.user!.userId);
  }

  @Post("{projectId}/secrets")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateBody(upsertSecretBodySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:PutSecret",
      resourceKind: "single-resource",
      resource: developerSecretResourceResolver,
    }),
  )
  public async upsertSecret(
    @Path() projectId: string,
    @Body() body: UpsertDeveloperSecretDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto> {
    return this.management.upsertSecret(projectId, request.user!.userId, body);
  }

  @Delete("{projectId}/secrets/{alias}")
  @Middlewares(
    replayProtectionMiddleware as RequestHandler,
    validateParams(projectIdParamsSchema),
    validateParams(secretAliasParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:developer:DeleteSecret",
      resourceKind: "single-resource",
      resource: developerSecretResourceResolver,
    }),
  )
  public async deleteSecret(
    @Path() projectId: string,
    @Path() alias: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.management.deleteSecret(projectId, alias, request.user!.userId);
    return { success: true };
  }

  @Get("{projectId}/monitors")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listMonitors(
    @Path() projectId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto[]> {
    return this.service.listStatusMonitors(projectId, request.user!.userId);
  }

  @Post("{projectId}/monitors")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateBody(createStatusMonitorBodySchema),
  )
  public async createMonitor(
    @Path() projectId: string,
    @Body() body: CreateDeveloperStatusMonitorDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    return this.service.createStatusMonitor(projectId, request.user!.userId, body);
  }

  @Put("{projectId}/monitors/{id}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateParams(idParamsSchema),
    validateBody(updateStatusMonitorBodySchema),
  )
  public async updateMonitor(
    @Path() projectId: string,
    @Path() id: string,
    @Body() body: UpdateDeveloperStatusMonitorDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    return this.service.updateStatusMonitor(projectId, id, request.user!.userId, body);
  }

  @Delete("{projectId}/monitors/{id}")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateParams(idParamsSchema))
  public async deleteMonitor(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deleteStatusMonitor(projectId, id, request.user!.userId);
    return { success: true };
  }

  @Post("{projectId}/monitors/{id}/check")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateParams(idParamsSchema))
  public async checkMonitor(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperStatusMonitorDto> {
    return this.service.checkStatusMonitor(projectId, id, request.user!.userId);
  }

  @Get("{projectId}/push-channels")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listPushChannels(
    @Path() projectId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto[]> {
    return this.service.listPushChannels(projectId, request.user!.userId);
  }

  @Get("{projectId}/push-deliveries")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listPushDeliveries(
    @Path() projectId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushDeliveryDto[]> {
    return this.service.listPushDeliveries(projectId, request.user!.userId);
  }

  @Post("{projectId}/push-channels")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateBody(createPushChannelBodySchema),
  )
  public async createPushChannel(
    @Path() projectId: string,
    @Body() body: CreateDeveloperPushChannelDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto> {
    return this.service.createPushChannel(projectId, request.user!.userId, body);
  }

  @Put("{projectId}/push-channels/{id}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateParams(idParamsSchema),
    validateBody(updatePushChannelBodySchema),
  )
  public async updatePushChannel(
    @Path() projectId: string,
    @Path() id: string,
    @Body() body: UpdateDeveloperPushChannelDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperPushChannelDto> {
    return this.service.updatePushChannel(projectId, id, request.user!.userId, body);
  }

  @Delete("{projectId}/push-channels/{id}")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateParams(idParamsSchema))
  public async deletePushChannel(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deletePushChannel(projectId, id, request.user!.userId);
    return { success: true };
  }
}
