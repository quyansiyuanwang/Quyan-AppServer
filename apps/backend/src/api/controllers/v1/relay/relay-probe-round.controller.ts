import { Body, Controller, Get, Middlewares, Path, Put, Query, Request, Route, Security, Tags } from "@tsoa/runtime";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { validateBody, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { RelayProbeRoundService } from "@/services/relay/relay-probe-round.service";
import { saveProbeDailyScheduleSchema, probeRoundPageSchema } from "@/api/schema/relay/relay-probe-round.schema";
import type {
  RelayProbeDailyScheduleDto,
  SaveRelayProbeDailyScheduleRequest,
  RelayProbeRoundPageDto,
  RelayProbeRoundTargetPageDto,
} from "@/api/dto/relay/relay-probe-round.dto";

@Route("v1/relay-channel-probes")
@Tags("Relay Probe Rounds")
export class RelayProbeRoundController extends Controller {
  private readonly service = RelayProbeRoundService.getInstance();

  @Get("daily-schedule")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:GetProbeDailySchedule",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_READ],
    }),
  )
  public getDailySchedule(@Request() request: TypedRequest): Promise<RelayProbeDailyScheduleDto> {
    return this.service.getSchedule(request.user!.userId, request);
  }

  @Put("daily-schedule")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:SaveProbeDailySchedule",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE],
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(saveProbeDailyScheduleSchema),
  )
  public saveDailySchedule(
    @Body() body: SaveRelayProbeDailyScheduleRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayProbeDailyScheduleDto> {
    return this.service.saveSchedule(request.user!.userId, body, request);
  }

  @Get("rounds")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListProbeRounds",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_READ],
    }),
    validateQuery(probeRoundPageSchema),
  )
  public listProbeRounds(
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 20,
  ): Promise<RelayProbeRoundPageDto> {
    return this.service.list(request.user!.userId, request, page, pageSize);
  }

  @Get("rounds/{roundId}")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:GetProbeRound",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_READ],
    }),
    validateQuery(probeRoundPageSchema),
  )
  public getProbeRound(
    @Path() roundId: string,
    @Request() request: TypedRequest,
    @Query() page = 1,
    @Query() pageSize = 20,
  ): Promise<RelayProbeRoundTargetPageDto> {
    return this.service.detail(request.user!.userId, request, roundId, page, pageSize);
  }
}
