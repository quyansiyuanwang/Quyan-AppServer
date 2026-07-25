import { Body, Controller, Get, Middlewares, Path, Post, Put, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { Permission } from "@/constant/permission";
import { RequirePermission } from "@/util/permission/permission-decorator";
import type { TypedRequest } from "@/types/express";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import {
  applyRelayChannelProbeRunsBodySchema,
  createRelayChannelProbeRunBodySchema,
  relayChannelProbeChannelParamsSchema,
  relayChannelProbeRunsQuerySchema,
  upsertRelayChannelProbeProfileBodySchema,
} from "@/api/schema/relay/relay-channel-probe.schema";
import type {
  ApplyRelayChannelProbeRunsRequest,
  ApplyRelayChannelProbeRunsResponse,
  CreateRelayChannelProbeRunRequest,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeProfileDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunPageDto,
  UpsertRelayChannelProbeProfileRequest,
} from "@/api/dto/relay/relay-channel-probe.dto";

@Route("v1/relay-channel-probes")
@Tags("Relay Channel Probes")
export class RelayChannelProbeController extends Controller {
  private readonly service = RelayChannelProbeService.getInstance();

  @Get()
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_READ)
  public listOverview(@Request() request: TypedRequest): Promise<RelayChannelProbeOverviewItemDto[]> {
    return this.service.listOverview(request.user!.userId);
  }

  @Get("{channelId}/profile")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_READ)
  @Middlewares(validateParams(relayChannelProbeChannelParamsSchema))
  public getProfile(@Path() channelId: string, @Request() request: TypedRequest): Promise<RelayChannelProbeProfileDto> {
    return this.service.getProfile(channelId, request.user!.userId);
  }

  @Put("{channelId}/profile")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), validateParams(relayChannelProbeChannelParamsSchema), replayProtectionMiddleware, validateBody(upsertRelayChannelProbeProfileBodySchema))
  public upsertProfile(@Path() channelId: string, @Body() body: UpsertRelayChannelProbeProfileRequest, @Request() request: TypedRequest): Promise<RelayChannelProbeProfileDto> {
    return this.service.upsertProfile(channelId, body, request.user!.userId);
  }

  @Post("{channelId}/runs")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), validateParams(relayChannelProbeChannelParamsSchema), replayProtectionMiddleware, validateBody(createRelayChannelProbeRunBodySchema))
  public async createRun(@Path() channelId: string, @Body() body: CreateRelayChannelProbeRunRequest, @Request() request: TypedRequest): Promise<RelayChannelProbeRunDto> {
    this.setStatus(202);
    return this.service.createRun(channelId, body, request.user!.userId);
  }

  @Get("{channelId}/runs")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_READ)
  @Middlewares(validateParams(relayChannelProbeChannelParamsSchema), validateQuery(relayChannelProbeRunsQuerySchema))
  public listRuns(@Path() channelId: string, @Request() request: TypedRequest, @Query() page?: number, @Query() pageSize?: number): Promise<RelayChannelProbeRunPageDto> {
    return this.service.listRuns(channelId, request.user!.userId, page, pageSize);
  }

  @Post("runs/apply")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }), replayProtectionMiddleware, validateBody(applyRelayChannelProbeRunsBodySchema))
  public applyRuns(@Body() body: ApplyRelayChannelProbeRunsRequest, @Request() request: TypedRequest): Promise<ApplyRelayChannelProbeRunsResponse> {
    return this.service.applyRuns(body, request.user!.userId);
  }
}
