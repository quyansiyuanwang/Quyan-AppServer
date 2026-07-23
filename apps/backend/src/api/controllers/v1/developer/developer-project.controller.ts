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
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
import { DeveloperProjectService } from "@/services/developer/developer-project.service";
import type {
  CreateDeveloperApiKeyDto,
  CreateDeveloperProjectDto,
  CreateDeveloperPushChannelDto,
  CreateDeveloperStatusMonitorDto,
  CreateShortLinkDto,
  DeveloperApiKeyDto,
  DeveloperKvValueDto,
  DeveloperProjectDto,
  DeveloperSecretDto,
  DeveloperShortLinkDto,
  DeveloperStatusMonitorDto,
  SetKvValueDto,
  UpdateDeveloperStatusMonitorDto,
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
  kvKeyParamsSchema,
  projectIdParamsSchema,
  setKvValueBodySchema,
  updateShortLinkBodySchema,
  updateStatusMonitorBodySchema,
  upsertSecretBodySchema,
} from "@/api/schema/developer/developer.schema";

@Route("v1/developer/projects")
@Tags("Developer Projects")
@Security("jwt")
export class DeveloperProjectController extends Controller {
  private readonly service = DeveloperProjectService.getInstance();

  @Get()
  public async list(@Request() request: TypedRequest): Promise<DeveloperProjectDto[]> {
    return this.service.listProjects(request.user!.userId);
  }

  @Post()
  @Middlewares(replayProtectionMiddleware, validateBody(createProjectBodySchema))
  public async create(
    @Body() body: CreateDeveloperProjectDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperProjectDto> {
    return this.service.createProject(request.user!.userId, body);
  }

  @Get("{projectId}/keys")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listKeys(@Path() projectId: string, @Request() request: TypedRequest): Promise<DeveloperApiKeyDto[]> {
    return this.service.listProjectApiKeys(projectId, request.user!.userId);
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
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateParams(idParamsSchema))
  public async revokeKey(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.revokeProjectApiKey(projectId, id, request.user!.userId);
    return { success: true };
  }

  @Get("{projectId}/kv")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listKv(@Path() projectId: string, @Request() request: TypedRequest) {
    return this.service.listProjectKv(projectId, request.user!.userId);
  }

  @Get("{projectId}/kv/{key}")
  @Middlewares(validateParams(projectIdParamsSchema), validateParams(kvKeyParamsSchema))
  public async getKv(
    @Path() projectId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    return this.service.getProjectKv(projectId, request.user!.userId, key);
  }

  @Post("{projectId}/kv/{key}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateParams(kvKeyParamsSchema),
    validateBody(setKvValueBodySchema),
  )
  public async setKv(
    @Path() projectId: string,
    @Path() key: string,
    @Body() body: SetKvValueDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperKvValueDto> {
    return this.service.setProjectKv(projectId, request.user!.userId, key, body);
  }

  @Delete("{projectId}/kv/{key}")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateParams(kvKeyParamsSchema))
  public async deleteKv(
    @Path() projectId: string,
    @Path() key: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deleteProjectKv(projectId, request.user!.userId, key);
    return { success: true };
  }

  @Get("{projectId}/short-links")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listShortLinks(
    @Path() projectId: string,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto[]> {
    return this.service.listShortLinks(projectId, request.user!.userId);
  }

  @Post("{projectId}/short-links")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateBody(createShortLinkBodySchema),
  )
  public async createShortLink(
    @Path() projectId: string,
    @Body() body: CreateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    return this.service.createShortLink(projectId, request.user!.userId, body);
  }

  @Put("{projectId}/short-links/{id}")
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(projectIdParamsSchema),
    validateParams(idParamsSchema),
    validateBody(updateShortLinkBodySchema),
  )
  public async updateShortLink(
    @Path() projectId: string,
    @Path() id: string,
    @Body() body: UpdateShortLinkDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperShortLinkDto> {
    return this.service.updateShortLink(projectId, id, request.user!.userId, body);
  }

  @Delete("{projectId}/short-links/{id}")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateParams(idParamsSchema))
  public async deleteShortLink(
    @Path() projectId: string,
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deleteShortLink(projectId, id, request.user!.userId);
    return { success: true };
  }

  @Get("{projectId}/secrets")
  @Middlewares(validateParams(projectIdParamsSchema))
  public async listSecrets(@Path() projectId: string, @Request() request: TypedRequest): Promise<DeveloperSecretDto[]> {
    return this.service.listSecrets(projectId, request.user!.userId);
  }

  @Post("{projectId}/secrets")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema), validateBody(upsertSecretBodySchema))
  public async upsertSecret(
    @Path() projectId: string,
    @Body() body: UpsertDeveloperSecretDto,
    @Request() request: TypedRequest,
  ): Promise<DeveloperSecretDto> {
    return this.service.upsertSecret(projectId, request.user!.userId, body);
  }

  @Delete("{projectId}/secrets/{alias}")
  @Middlewares(replayProtectionMiddleware, validateParams(projectIdParamsSchema))
  public async deleteSecret(
    @Path() projectId: string,
    @Path() alias: string,
    @Request() request: TypedRequest,
  ): Promise<{ success: true }> {
    await this.service.deleteSecret(projectId, alias, request.user!.userId);
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
  public async listPushChannels(@Path() projectId: string, @Request() request: TypedRequest) {
    return this.service.listPushChannels(projectId, request.user!.userId);
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
  ) {
    return this.service.createPushChannel(projectId, request.user!.userId, body);
  }
}
