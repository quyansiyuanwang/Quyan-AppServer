import { Controller, Get, Middlewares, Path, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@/constant/permission";
import { RequireAllPermissions, RequirePermission } from "@/util/permission/permission-decorator";
import { validateParams, validateQuery } from "@/middleware/validation";
import {
  aiRequestLogListQuerySchema,
  aiRequestLogParamsSchema,
  aiRequestLogContentQuerySchema,
  aiRequestLogSearchQuerySchema,
  aiRequestLogAttemptsQuerySchema,
} from "@/api/schema/relay/ai-request-log.schema";
import type {
  AIRequestLogDetailDto,
  AIRequestLogListResponse,
  AIRequestLogMetadataDto,
  AIRequestLogContentPageDto,
  AIRequestLogSearchPageDto,
  AIRequestLogAttemptsPageDto,
  AIRequestLogContentSide,
  AIRequestLogContentView,
} from "@/api/dto/relay/ai-request-log.dto";
import type { AIRequestLogOutcome, AIRequestLogStage, AIRequestLogOmissionReason } from "@/constant/ai-request-log";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { PermissionService } from "@/services/users/permission.service";
import { ForbiddenError, NotFoundError } from "@/util/errors";

@Route("v1/relay/ai-request-logs")
@Tags("Relay AI Request Logs")
export class AIRequestLogController extends Controller {
  private readonly service = AIRequestLogService.getInstance();
  @Get()
  @Security("jwt")
  @RequirePermission(Permission.RELAY_AI_REQUEST_LOG_READ)
  @Middlewares(validateQuery(aiRequestLogListQuerySchema))
  public async list(
    @Request() _request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() user?: string,
    @Query() relayToken?: string,
    @Query() model?: string,
    @Query() requestFormat?: string,
    @Query() statusCode?: number,
    @Query() requestId?: string,
    @Query() keyword?: string,
    @Query() truncated?: boolean,
    @Query() startDate?: string,
    @Query() endDate?: string,
    @Query() outcome?: AIRequestLogOutcome,
    @Query() isStreaming?: boolean,
    @Query() failureStage?: AIRequestLogStage,
    @Query() ipAddress?: string,
    @Query() minDurationMs?: number,
    @Query() maxDurationMs?: number,
    @Query() bodyOmissionReason?: AIRequestLogOmissionReason,
  ): Promise<AIRequestLogListResponse> {
    const result = await this.service.query({
      page,
      pageSize,
      user,
      relayToken,
      model,
      requestFormat,
      statusCode,
      requestId,
      keyword,
      truncated,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      outcome,
      isStreaming,
      failureStage,
      ipAddress,
      minDurationMs,
      maxDurationMs,
      bodyOmissionReason,
    });
    return { ...result, page, pageSize };
  }
  @Get("{id}/metadata")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_AI_REQUEST_LOG_READ)
  @Middlewares(validateParams(aiRequestLogParamsSchema))
  public async metadata(@Path() id: string): Promise<AIRequestLogMetadataDto> {
    return this.service.metadata(id);
  }
  @Get("{id}/content")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_AI_REQUEST_LOG_READ)
  @Middlewares(validateParams(aiRequestLogParamsSchema), validateQuery(aiRequestLogContentQuerySchema))
  public async content(
    @Path() id: string,
    @Query() side: AIRequestLogContentSide = "request",
    @Query() view: AIRequestLogContentView = "parsed",
    @Query() cursor?: string,
    @Query() locator?: string,
    @Query() pageSize?: number,
    @Query() offset?: number,
  ): Promise<AIRequestLogContentPageDto> {
    return this.service.content(id, side, view, { cursor, locator, pageSize, offset });
  }
  @Get("{id}/search")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_AI_REQUEST_LOG_READ)
  @Middlewares(validateParams(aiRequestLogParamsSchema), validateQuery(aiRequestLogSearchQuerySchema))
  public async search(
    @Request() request: TypedRequest,
    @Path() id: string,
    @Query() keyword: string,
    @Query() scope: AIRequestLogContentSide | "attempts" = "request",
    @Query() cursor?: string,
    @Query() pageSize?: number,
  ): Promise<AIRequestLogSearchPageDto> {
    if (scope === "attempts") {
      const result = await PermissionService.getInstance().checkUserPermissions(
        request.user!.userId,
        [Permission.RELAY_REQUEST_DIAGNOSTICS_READ],
        { assumedRoleSessionId: request.user?.roleSessionId },
      );
      if (!result.hasPermission)
        throw new ForbiddenError("Request diagnostics permission is required", undefined, {
          messageKey: "permission.missingRequiredPermissions",
          messageParams: { permissions: Permission.RELAY_REQUEST_DIAGNOSTICS_READ },
        });
    }
    return this.service.search(id, scope, keyword, { cursor, pageSize });
  }
  @Get("{id}/attempts")
  @Security("jwt")
  @RequireAllPermissions([Permission.RELAY_AI_REQUEST_LOG_READ, Permission.RELAY_REQUEST_DIAGNOSTICS_READ])
  @Middlewares(validateParams(aiRequestLogParamsSchema), validateQuery(aiRequestLogAttemptsQuerySchema))
  public async attempts(
    @Path() id: string,
    @Query() cursor?: string,
    @Query() pageSize?: number,
  ): Promise<AIRequestLogAttemptsPageDto> {
    return this.service.attempts(id, { cursor, pageSize });
  }
  /** Compatibility entry point. New UI uses metadata/content instead. */
  @Get("{id}")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_AI_REQUEST_LOG_READ)
  @Middlewares(validateParams(aiRequestLogParamsSchema))
  public async detail(@Path() id: string): Promise<AIRequestLogDetailDto> {
    const log = await this.service.findById(id);
    if (!log)
      throw new NotFoundError("AI request log not found", undefined, { messageKey: "relay.aiRequestLogNotFound" });
    return log;
  }
}
