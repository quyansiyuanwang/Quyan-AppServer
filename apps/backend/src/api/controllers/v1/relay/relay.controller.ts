import {
  Get,
  Post,
  Delete,
  Put,
  Patch,
  Path,
  Route,
  Security,
  Tags,
  Controller,
  Request,
  Body,
  Query,
  Middlewares,
} from "@tsoa/runtime";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import type {
  BatchDeleteRelayTokensRequest,
  BatchDuplicateRelayTokensRequest,
  BatchRelayTokensResultDto,
  BatchSetRelayTokenStatusRequest,
  CreateRelayTokenDto,
  DuplicateRelayTokenRequest,
  ExportRelayTokensRequest,
  ImportRelayTokensRequest,
  ImportRelayTokensResponse,
  RelayTokenExportResponse,
  UpdateRelayTokenDto,
  UpdateRelayTokenChannelDto,
  RelayTokenCurrentQuotaDto,
  RelayTokenCurrentQuotaQueryDto,
  RelayTokenDto,
  RelayTokenPageDto,
  RelayTokenUsageDetailDto,
  RelayTokenUsageSummaryBatchDto,
  RelayUsageStatsDto,
  RelayAvailableModelsMapDto,
  RelayTokenSwitchLogsDto,
  RelayTokenAvailableModelsDto,
} from "@/api/dto/relay/relay.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import {
  batchDeleteRelayTokensBodySchema,
  batchDuplicateRelayTokensBodySchema,
  batchSetRelayTokenStatusBodySchema,
  createRelayTokenBodySchema,
  duplicateRelayTokenBodySchema,
  exportRelayTokensBodySchema,
  importRelayTokensBodySchema,
  relayTokenListQuerySchema,
  relayTokenIdParamsSchema,
  relayTokenUsageDetailQuerySchema,
  relayTokenSwitchLogsQuerySchema,
  relayTokenUsageQuerySchema,
  relayTokenUsageSummaryQuerySchema,
  updateRelayTokenBodySchema,
  updateRelayTokenChannelBodySchema,
} from "@/api/schema/relay/relay.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { UnauthorizedError } from "@/util/errors";
import { setResponseMessageKey } from "@/util/response-wrapper";

@Route("v1/relay")
@Tags("Relay")
export class RelayController extends Controller {
  private relayTokenService = new RelayTokenService();

  @Post("tokens")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRelayTokenBodySchema),
  )
  async createToken(@Body() body: CreateRelayTokenDto, @Request() request: TypedRequest): Promise<RelayTokenDto> {
    return this.relayTokenService.generateToken(request.user!.userId, body, request);
  }

  @Post("tokens/export")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateBody(exportRelayTokensBodySchema))
  async exportTokens(
    @Body() body: ExportRelayTokensRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayTokenExportResponse> {
    return this.relayTokenService.exportTokens(body, request.user!.userId, request);
  }

  @Post("tokens/import")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(importRelayTokensBodySchema),
  )
  async importTokens(
    @Body() body: ImportRelayTokensRequest,
    @Request() request: TypedRequest,
  ): Promise<ImportRelayTokensResponse> {
    return this.relayTokenService.importTokens(body, request.user!.userId, request);
  }

  @Get("tokens")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateQuery(relayTokenListQuerySchema))
  async listTokens(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<RelayTokenPageDto> {
    return this.relayTokenService.listTokens(request.user!.userId, page, pageSize);
  }

  @Get("tokens/usage-summaries")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateQuery(relayTokenUsageSummaryQuerySchema))
  async getUsageSummaries(
    @Request() request: TypedRequest,
    @Query() tokenIds?: string,
    @Query() startDate?: string,
    @Query() endDate?: string,
  ): Promise<RelayTokenUsageSummaryBatchDto> {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    const parsedTokenIds = tokenIds
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return this.relayTokenService.getUsageSummaries(request.user!.userId, parsedTokenIds, start, end);
  }

  @Get("tokens/current/quota-summary")
  @Security("relay-token")
  @Middlewares(validateQuery(relayTokenUsageQuerySchema))
  async getCurrentTokenQuotaSummary(
    @Request() request: TypedRequest,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() windowHours?: number,
    @Query() resetAt?: string,
    @Query() timezoneOffsetMinutes?: number,
  ): Promise<RelayTokenCurrentQuotaDto> {
    if (!request.relayToken) throw new UnauthorizedError("This endpoint requires a relay token");

    const query: RelayTokenCurrentQuotaQueryDto = {
      startDate,
      endDate,
      windowHours,
      resetAt,
      timezoneOffsetMinutes,
    };

    return this.relayTokenService.getCurrentTokenQuotaSummary(request.relayToken, query);
  }

  @Get("tokens/{id}")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateParams(relayTokenIdParamsSchema))
  async getToken(@Path() id: string, @Request() request: TypedRequest): Promise<RelayTokenDto> {
    return this.relayTokenService.getToken(id, request.user!.userId);
  }

  @Delete("tokens/{id}")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_DELETE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayTokenIdParamsSchema),
  )
  async deleteToken(@Path() id: string, @Request() request: TypedRequest) {
    await this.relayTokenService.revokeToken(id, request.user!.userId, request);
    setResponseMessageKey(request, "relay.tokenDeleted");
    return { message: "Token删除成功" };
  }

  @Put("tokens/{id}/channel")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayTokenIdParamsSchema),
    validateBody(updateRelayTokenChannelBodySchema),
  )
  async updateTokenChannel(
    @Path() id: string,
    @Body() body: UpdateRelayTokenChannelDto,
    @Request() request: TypedRequest,
  ): Promise<RelayTokenDto> {
    return this.relayTokenService.updateTokenChannel(id, request.user!.userId, body, request);
  }

  @Put("tokens/{id}")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayTokenIdParamsSchema),
    validateBody(updateRelayTokenBodySchema),
  )
  async updateToken(
    @Path() id: string,
    @Body() body: UpdateRelayTokenDto,
    @Request() request: TypedRequest,
  ): Promise<RelayTokenDto> {
    return this.relayTokenService.updateToken(id, request.user!.userId, body, request);
  }

  @Post("tokens/batch/duplicate")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchDuplicateRelayTokensBodySchema),
  )
  async batchDuplicateTokens(
    @Body() body: BatchDuplicateRelayTokensRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayTokenDto[]> {
    return this.relayTokenService.batchDuplicateTokens(body.ids, request.user!.userId, request);
  }

  @Post("tokens/{id}/duplicate")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayTokenIdParamsSchema),
    validateBody(duplicateRelayTokenBodySchema),
  )
  async duplicateToken(
    @Path() id: string,
    @Body() body: DuplicateRelayTokenRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayTokenDto> {
    return this.relayTokenService.duplicateToken(id, body, request.user!.userId, request);
  }

  @Post("tokens/{id}/refresh")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayTokenIdParamsSchema),
  )
  async refreshToken(@Path() id: string, @Request() request: TypedRequest): Promise<RelayTokenDto> {
    return this.relayTokenService.refreshToken(id, request.user!.userId, request);
  }

  @Patch("tokens/{id}/toggle")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayTokenIdParamsSchema),
  )
  async toggleTokenStatus(@Path() id: string, @Request() request: TypedRequest): Promise<RelayTokenDto> {
    return this.relayTokenService.toggleTokenStatus(id, request.user!.userId, request);
  }

  @Patch("tokens/batch/status")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchSetRelayTokenStatusBodySchema),
  )
  async batchSetTokenStatus(
    @Body() body: BatchSetRelayTokenStatusRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayTokensResultDto> {
    return this.relayTokenService.batchSetTokenStatus(body, request.user!.userId, request);
  }

  @Post("tokens/batch/delete")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_DELETE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchDeleteRelayTokensBodySchema),
  )
  async batchDeleteTokens(
    @Body() body: BatchDeleteRelayTokensRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayTokensResultDto> {
    return this.relayTokenService.batchDeleteTokens(body, request.user!.userId, request);
  }

  @Get("tokens/{id}/usage")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateParams(relayTokenIdParamsSchema), validateQuery(relayTokenUsageQuerySchema))
  async getUsage(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() startDate?: string,
    @Query() endDate?: string,
  ): Promise<RelayUsageStatsDto> {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.relayTokenService.getUsageStats(id, request.user!.userId, start, end);
  }

  @Get("tokens/{id}/usage-summary")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateParams(relayTokenIdParamsSchema), validateQuery(relayTokenUsageDetailQuerySchema))
  async getUsageSummary(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() limit?: number,
    @Query() offset?: number,
  ): Promise<RelayTokenUsageDetailDto> {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.relayTokenService.getUsageSummary(id, request.user!.userId, start, end, limit, offset);
  }

  @Get("available-models")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  async getAvailableModels(): Promise<RelayAvailableModelsMapDto> {
    return this.relayTokenService.getAvailableModels();
  }

  @Get("tokens/{id}/switch-logs")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateParams(relayTokenIdParamsSchema), validateQuery(relayTokenSwitchLogsQuerySchema))
  async getTokenSwitchLogs(
    @Path() id: string,
    @Request() request: TypedRequest,
    @Query() limit?: number,
  ): Promise<RelayTokenSwitchLogsDto> {
    return this.relayTokenService.getSwitchLogs(id, request.user!.userId, limit);
  }

  @Get("tokens/{id}/available-models")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_TOKEN_READ)
  @Middlewares(validateParams(relayTokenIdParamsSchema))
  async getTokenAvailableModels(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RelayTokenAvailableModelsDto> {
    return this.relayTokenService.getTokenAvailableModels(id, request.user!.userId);
  }
}
