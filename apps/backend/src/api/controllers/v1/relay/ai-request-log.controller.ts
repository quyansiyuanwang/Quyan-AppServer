import { Controller, Get, Middlewares, Path, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { validateParams, validateQuery } from "@/middleware/validation";
import { aiRequestLogListQuerySchema, aiRequestLogParamsSchema } from "@/api/schema/relay/ai-request-log.schema";
import type { AIRequestLogDetailDto, AIRequestLogListResponse } from "@/api/dto/relay/ai-request-log.dto";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { NotFoundError } from "@/util/errors";

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
    });
    return { ...result, page, pageSize };
  }

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
