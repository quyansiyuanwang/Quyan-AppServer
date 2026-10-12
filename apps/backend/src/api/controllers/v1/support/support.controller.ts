import { validateQuery } from "@/middleware/validation";
import { supportAnalyticsQuerySchema } from "@/api/schema/support/support-analytics.schema";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { iamAccountUserResourceResolver } from "@/iam/request/account-user-resource-resolver";
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
import {
  iamCollectionAuthorizationMiddleware,
  iamAuthenticatedAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver, iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import type { SuccessResponse } from "@/api/response";

@Route("v1/support")
@Tags("Support")
export class SupportController extends Controller {
  private readonly supportService = SupportAiService.getInstance();
  private readonly sseService = SSEStreamService.getInstance();

  @Get("availability")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:support:GetAvailability",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async availability(): Promise<SuccessResponse<SupportAvailabilityDto>> {
    const config = await this.supportService.getConfig();
    return {
      code: 0,
      message: "Success",
      data: {
        enabled: config.enabled && (config.apiKeyConfigured || (config.allowUserBalance && config.allowUserRelayToken)),
        allowUserBalance: config.allowUserBalance,
        allowUserRelayToken: config.allowUserRelayToken,
      },
    };
  }

  @Get("conversation")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:support:GetConversation",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async conversation(@Request() request: TypedRequest): Promise<SuccessResponse<SupportConversationDto>> {
    return { code: 0, message: "Success", data: await this.supportService.getConversation(request.user!.userId) };
  }

  @Delete("conversation")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:support:ClearConversation",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async clearConversation(@Request() request: TypedRequest): Promise<SuccessResponse<void>> {
    await this.supportService.clearConversation(request.user!.userId);
    return { code: 0, message: "Success" };
  }

  @Get("analytics")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:support:GetUserUsageAnalytics",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(supportAnalyticsQuerySchema),
  )
  public async analytics(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() startAt?: string,
    @Query() endAt?: string,
    @Query() userId?: string,
    @Request() request?: TypedRequest,
  ): Promise<SuccessResponse<SupportAiAnalyticsDto>> {
    return {
      code: 0,
      message: "Success",
      data: await this.supportService.getManagedAnalytics({ page, pageSize, startAt, endAt, userId }, request),
    };
  }

  @Get("analytics/users/{userId}/conversation")
  @Security("jwt")
  @CheckPermission(Permission.SUPPORT_AI_ANALYTICS_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:support:GetUserConversation",
    resourceKind: "single-resource",
    resource: iamAccountUserResourceResolver,
  })
  public async analyticsConversation(
    @Path() userId: string,
    @Request() request: TypedRequest,
  ): Promise<SuccessResponse<SupportConversationDto>> {
    return { code: 0, message: "Success", data: await this.supportService.getMonitoredConversation(userId, request) };
  }

  @Post("messages")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:support:SendMessage",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  public async messages(@Body() body: SendSupportMessageDto, @Request() request: TypedRequest): Promise<void> {
    await this.supportService.assertMessageBudget(request.user!.userId, body);
    const response = request.res!;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    skipResponseWrapper(request);
    this.sseService.initStream(response);
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      for await (const event of this.supportService.stream(request.user!.userId, body, request, abortController.signal))
        if (!response.writableEnded && !response.destroyed) await this.sseService.sendChunk(response, event);
      if (!response.writableEnded && !response.destroyed) await this.sseService.sendDone(response);
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
      if (!response.writableEnded && !response.destroyed) this.sseService.endStream(response);
    }
  }

  @Post("handoff")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:support:Handoff",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
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
