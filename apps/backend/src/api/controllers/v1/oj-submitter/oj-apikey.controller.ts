import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Route,
  Security,
  Body,
  Path,
  Request,
  Tags,
  Middlewares,
} from "@tsoa/runtime";
import { OJAPIKeyService } from "@/services/oj-submitter/oj-apikey.service";
import type { CreateOJAPIKeyRequest, OJAPIKeyDto, UpdateOJAPIKeyRequest } from "@/api/dto/oj-submitter/oj-qa.dto";
import type { TypedRequest } from "@/types/express";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import {
  createOJAPIKeyBodySchema,
  ojApiKeyIdParamsSchema,
  updateOJAPIKeyBodySchema,
} from "@/api/schema/oj-submitter/oj-submitter.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/products/oj-submitter/apikeys")
@Tags("OJSubmitter")
export class OJAPIKeyController extends Controller {
  private ojAPIKeyService = OJAPIKeyService.getInstance();

  /**
   * 创建API密钥
   */
  @Post()
  @Security("jwt")
  @RequirePermission(Permission.OJ_APIKEY_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createOJAPIKeyBodySchema),
  )
  public async createAPIKey(
    @Request() request: TypedRequest,
    @Body() body: CreateOJAPIKeyRequest,
  ): Promise<OJAPIKeyDto> {
    const userId = request.user!.userId;

    const apiKey = await this.ojAPIKeyService.createAPIKey(userId, body.name, body.expiresAt, body.channelId, request);

    return {
      id: apiKey.id,
      name: apiKey.name || undefined,
      key: apiKey.key,
      requestCount: apiKey.requestCount,
      totalTokens: apiKey.totalTokens,
      expiresAt: apiKey.expiresAt || undefined,
      lastUsedAt: apiKey.lastUsedAt || undefined,
      createTime: apiKey.createTime,
      channelId: apiKey.channelId || undefined,
      channelName: apiKey.channel?.name || undefined,
    };
  }

  /**
   * 获取当前用户的所有API密钥
   */
  @Get()
  @Security("jwt")
  @RequirePermission(Permission.OJ_APIKEY_READ)
  public async listAPIKeys(@Request() request: TypedRequest): Promise<OJAPIKeyDto[]> {
    const userId = request.user!.userId;

    const keys = await this.ojAPIKeyService.listAPIKeys(userId);

    return keys.map((k) => ({
      id: k.id,
      name: k.name || undefined,
      key: k.key,
      requestCount: k.requestCount,
      totalTokens: k.totalTokens,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      createTime: k.createTime,
      channelId: k.channelId || undefined,
      channelName: k.channel?.name || undefined,
    }));
  }

  /**
   * 获取单个API密钥详情
   */
  @Get("{id}")
  @Security("jwt")
  @RequirePermission(Permission.OJ_APIKEY_READ)
  @Middlewares(validateParams(ojApiKeyIdParamsSchema))
  public async getAPIKey(@Path() id: string, @Request() request: TypedRequest): Promise<OJAPIKeyDto> {
    const userId = request.user!.userId;

    const apiKey = await this.ojAPIKeyService.getAPIKey(id, userId);

    return {
      id: apiKey.id,
      name: apiKey.name || undefined,
      key: apiKey.key,
      requestCount: apiKey.requestCount,
      totalTokens: apiKey.totalTokens,
      expiresAt: apiKey.expiresAt || undefined,
      lastUsedAt: apiKey.lastUsedAt || undefined,
      createTime: apiKey.createTime,
      channelId: apiKey.channelId || undefined,
      channelName: apiKey.channel?.name || undefined,
    };
  }

  /**
   * 删除API密钥
   */
  @Delete("{id}")
  @Security("jwt")
  @RequirePermission(Permission.OJ_APIKEY_DELETE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ojApiKeyIdParamsSchema),
  )
  public async deleteAPIKey(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    const userId = request.user!.userId;

    await this.ojAPIKeyService.deleteAPIKey(id, userId, request);

    return { success: true };
  }

  /**
   * 更新API密钥
   */
  @Put("{id}")
  @Security("jwt")
  @RequirePermission(Permission.OJ_APIKEY_UPDATE)
  @Middlewares(validateParams(ojApiKeyIdParamsSchema), validateBody(updateOJAPIKeyBodySchema))
  public async updateAPIKey(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Body() body: UpdateOJAPIKeyRequest,
  ): Promise<OJAPIKeyDto> {
    const userId = request.user!.userId;

    const apiKey = await this.ojAPIKeyService.updateAPIKey(
      id,
      userId,
      {
        name: body.name,
        expiresAt: body.expiresAt,
        channelId: body.channelId,
      },
      request,
    );

    return {
      id: apiKey.id,
      name: apiKey.name || undefined,
      key: apiKey.key,
      requestCount: apiKey.requestCount,
      totalTokens: apiKey.totalTokens,
      expiresAt: apiKey.expiresAt || undefined,
      lastUsedAt: apiKey.lastUsedAt || undefined,
      createTime: apiKey.createTime,
      channelId: apiKey.channelId || undefined,
      channelName: apiKey.channel?.name || undefined,
    };
  }

  /**
   * 获取API密钥统计信息
   */
  @Get("stats")
  @Security("jwt")
  @RequirePermission(Permission.OJ_APIKEY_READ)
  public async getAPIKeyStats(@Request() request: TypedRequest) {
    const userId = request.user!.userId;

    const stats = await this.ojAPIKeyService.getAPIKeyStats(userId);

    return stats;
  }
}
