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
  clearRelayChannelProbeRunHistoryQuerySchema,
  copyRelayChannelProbeProfileBodySchema,
  createRelayChannelProbeRunBodySchema,
  createRelayChannelProbeRunsBodySchema,
  relayChannelProbeChannelParamsSchema,
  relayChannelProbeLatestRunsBodySchema,
  relayChannelProbeMemberBodySchema,
  relayChannelProbeRunsQuerySchema,
  upsertRelayChannelProbeProfileBodySchema,
} from "@/api/schema/relay/relay-channel-probe.schema";
import type {
  ApplyRelayChannelProbeRunsRequest,
  ApplyRelayChannelProbeRunsResponse,
  CopyRelayChannelProbeProfileRequest,
  CopyRelayChannelProbeProfileResponse,
  ClearRelayChannelProbeRunHistoryResponse,
  CreateRelayChannelProbeRunRequest,
  CreateRelayChannelProbeRunsRequest,
  CreateRelayChannelProbeRunsResponse,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeProfileDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunHistoryScope,
  RelayChannelProbeRunPageDto,
  RelayChannelProbeMemberTargetDto,
  RelayChannelProbeLatestRunDto,
  RelayChannelProbeLatestRunRequest,
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
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeChannelParamsSchema),
    replayProtectionMiddleware,
    validateBody(upsertRelayChannelProbeProfileBodySchema),
  )
  public upsertProfile(
    @Path() channelId: string,
    @Body() body: UpsertRelayChannelProbeProfileRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeProfileDto> {
    return this.service.upsertProfile(channelId, body, request.user!.userId);
  }

  @Delete("{channelId}/profile")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeChannelParamsSchema),
    replayProtectionMiddleware,
  )
  public async clearProfile(@Path() channelId: string, @Request() request: TypedRequest): Promise<void> {
    await this.service.clearProfile(channelId, request.user!.userId);
    this.setStatus(204);
  }

  @Post("{channelId}/runs")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeChannelParamsSchema),
    replayProtectionMiddleware,
    validateBody(createRelayChannelProbeRunBodySchema),
  )
  public async createRun(
    @Path() channelId: string,
    @Body() body: CreateRelayChannelProbeRunRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeRunDto> {
    this.setStatus(202);
    return this.service.createRun(channelId, body, request.user!.userId);
  }

  @Post("{channelId}/runs/reset")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeChannelParamsSchema),
    validateBody(relayChannelProbeMemberBodySchema),
    replayProtectionMiddleware,
  )
  public async resetRunState(
    @Path() channelId: string,
    @Body() body: RelayChannelProbeMemberTargetDto,
    @Request() request: TypedRequest,
  ): Promise<void> {
    await this.service.resetRunState(channelId, request.user!.userId, body.memberChannelId);
    this.setStatus(204);
  }

  @Post("runs/latest")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_READ)
  @Middlewares(validateBody(relayChannelProbeLatestRunsBodySchema))
  public listLatestRuns(
    @Body() body: RelayChannelProbeLatestRunRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeLatestRunDto[]> {
    return this.service.listLatestRuns(body, request.user!.userId);
  }

  @Post("runs/batch")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRelayChannelProbeRunsBodySchema),
  )
  public async createRuns(
    @Body() body: CreateRelayChannelProbeRunsRequest,
    @Request() request: TypedRequest,
  ): Promise<CreateRelayChannelProbeRunsResponse> {
    this.setStatus(202);
    return this.service.createRuns(body, request.user!.userId);
  }

  @Post("profiles/batch-copy")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(copyRelayChannelProbeProfileBodySchema),
  )
  public copyProfile(
    @Body() body: CopyRelayChannelProbeProfileRequest,
    @Request() request: TypedRequest,
  ): Promise<CopyRelayChannelProbeProfileResponse> {
    return this.service.copyProfile(body, request.user!.userId);
  }

  @Get("{channelId}/runs")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_READ)
  @Middlewares(validateParams(relayChannelProbeChannelParamsSchema), validateQuery(relayChannelProbeRunsQuerySchema))
  public listRuns(
    @Path() channelId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() memberChannelId?: string,
  ): Promise<RelayChannelProbeRunPageDto> {
    return this.service.listRuns(channelId, request.user!.userId, page, pageSize, memberChannelId);
  }

  @Delete("{channelId}/runs")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeChannelParamsSchema),
    validateQuery(clearRelayChannelProbeRunHistoryQuerySchema),
    replayProtectionMiddleware,
  )
  public clearRunHistory(
    @Path() channelId: string,
    @Query() scope: RelayChannelProbeRunHistoryScope,
    @Request() request: TypedRequest,
    @Query() memberChannelId?: string,
  ): Promise<ClearRelayChannelProbeRunHistoryResponse> {
    return this.service.clearRunHistory(channelId, scope, request.user!.userId, memberChannelId);
  }

  @Post("runs/apply")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(applyRelayChannelProbeRunsBodySchema),
  )
  public applyRuns(
    @Body() body: ApplyRelayChannelProbeRunsRequest,
    @Request() request: TypedRequest,
  ): Promise<ApplyRelayChannelProbeRunsResponse> {
    return this.service.applyRuns(body, request.user!.userId);
  }
}
