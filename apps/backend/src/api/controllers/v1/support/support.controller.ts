import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import { Permission } from "@/constant/permission";
import type {
  SendSupportMessageDto,
  SupportAiConfigDto,
  SupportAiAnalyticsDto,
  SupportAvailabilityDto,
  SupportConversationDto,
  SupportHandoffDto,
  SupportHandoffResultDto,
  UpdateSupportAiConfigDto,
} from "@/api/dto/support/support.dto";
import { SupportAiService } from "@/services/support/support-ai.service";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";
import { SSEStreamService } from "@/util/streaming/sse";
import { skipResponseWrapper } from "@/util/response-wrapper";
import type { TypedRequest } from "@/types/express";
import type { SuccessResponse } from "@/api/response";

@Route("v1/support")
@Tags("Support")
export class SupportController extends Controller {
  private readonly supportService = SupportAiService.getInstance();
  private readonly sseService = SSEStreamService.getInstance();

  @Get("availability")
  @Security("jwt")
  public async availability(): Promise<SuccessResponse<SupportAvailabilityDto>> {
    const config = await this.supportService.getConfig();
    return { code: 0, message: "Success", data: { enabled: config.enabled && config.apiKeyConfigured } };
  }

  @Get("conversation")
  @Security("jwt")
  public async conversation(@Request() request: TypedRequest): Promise<SuccessResponse<SupportConversationDto>> {
    return { code: 0, message: "Success", data: await this.supportService.getConversation(request.user!.userId) };
  }

  @Delete("conversation")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async clearConversation(@Request() request: TypedRequest): Promise<SuccessResponse<void>> {
    await this.supportService.clearConversation(request.user!.userId);
    return { code: 0, message: "Success" };
  }

  @Get("analytics")
  @Security("jwt")
  @RequirePermission(Permission.SUPPORT_AI_ANALYTICS_READ)
  public async analytics(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() startAt?: string,
    @Query() endAt?: string,
    @Query() userId?: string,
  ): Promise<SuccessResponse<SupportAiAnalyticsDto>> {
    return { code: 0, message: "Success", data: await this.supportService.getAnalytics({ page, pageSize, startAt, endAt, userId }) };
  }

  @Get("analytics/users/{userId}/conversation")
  @Security("jwt")
  @RequirePermission(Permission.SUPPORT_AI_ANALYTICS_READ)
  public async analyticsConversation(@Path() userId: string): Promise<SuccessResponse<SupportConversationDto>> {
    return { code: 0, message: "Success", data: await this.supportService.getConversation(userId) };
  }

  @Post("messages")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async messages(@Body() body: SendSupportMessageDto, @Request() request: TypedRequest): Promise<void> {
    const response = request.res!;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    skipResponseWrapper(request);
    this.sseService.initStream(response);
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      for await (const event of this.supportService.stream(request.user!.userId, body, abortController.signal))
        if (!response.writableEnded && !response.destroyed) this.sseService.sendChunk(response, event);
      if (!response.writableEnded && !response.destroyed) this.sseService.sendDone(response);
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
      if (!response.writableEnded && !response.destroyed) this.sseService.endStream(response);
    }
  }

  @Post("handoff")
  @Security("jwt")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async handoff(
    @Body() body: SupportHandoffDto,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<SupportHandoffResultDto>> {
    const data = await this.supportService.handoff(request.user!.userId, body, request);
    return { code: 0, message: "Success", data };
  }

  @Get("config")
  @Security("jwt")
  @RequirePermission(Permission.SUPPORT_AI_CONFIG)
  public async getConfig(): Promise<SuccessResponse<SupportAiConfigDto>> {
    return { code: 0, message: "Success", data: await this.supportService.getConfig() };
  }

  @Post("config")
  @Security("jwt")
  @RequirePermission(Permission.SUPPORT_AI_CONFIG)
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async updateConfig(
    @Body() body: UpdateSupportAiConfigDto,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<SupportAiConfigDto>> {
    return {
      code: 0,
      message: "Success",
      data: await this.supportService.updateConfig(body, request.user!.userId, request),
    };
  }
}
