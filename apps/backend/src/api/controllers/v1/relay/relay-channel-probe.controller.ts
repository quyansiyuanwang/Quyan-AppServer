import {
  platformRelayProbeAccountResourceResolver,
  platformRelayProbeAccountCreateResourceResolver,
} from "@/iam/request/relay-probe-resource-resolvers";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
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
import { RelayChannelProbeAccountService } from "@/services/relay/relay-channel-probe-account.service";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { Permission } from "@/constant/permission";
import { CheckPermission, PermissionCheckMode, RequirePermission } from "@/util/permission/permission-decorator";
import type { TypedRequest } from "@/types/express";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { relayChannelProbeResourceResolver } from "@/iam/request/resource-resolvers";
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
  configureRelayChannelProbeTargetsBodySchema,
  bindRelayChannelProbeAccountsBodySchema,
  saveRelayChannelProbeAccountBodySchema,
  relayChannelProbeAccountParamsSchema,
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
  SaveRelayChannelProbeAccountRequest,
  RelayChannelProbeAccountDto,
  ConfigureRelayChannelProbeTargetsRequest,
  ConfigureRelayChannelProbeTargetsResponse,
  BindRelayChannelProbeAccountsRequest,
} from "@/api/dto/relay/relay-channel-probe.dto";

@Route("v1/relay-channel-probes")
@Tags("Relay Channel Probes")
export class RelayChannelProbeController extends Controller {
  private readonly service = RelayChannelProbeService.getInstance();
  private readonly accountService = RelayChannelProbeAccountService.getInstance();

  @Get()
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_READ)
  public listOverview(@Request() request: TypedRequest): Promise<RelayChannelProbeOverviewItemDto[]> {
    return this.service.listOverview(request.user!.userId);
  }

  @Get("{channelId}/profile")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:GetProbeProfile",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_READ],
    }),
  )
  @Middlewares(validateParams(relayChannelProbeChannelParamsSchema))
  public getProfile(@Path() channelId: string, @Request() request: TypedRequest): Promise<RelayChannelProbeProfileDto> {
    return this.service.getProfile(channelId, request.user!.userId, request);
  }

  @Put("{channelId}/profile")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:probe:Execute",
    resourceKind: "single-resource",
    resource: relayChannelProbeResourceResolver,
  })
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
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:DeleteProbeProfile",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE],
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeChannelParamsSchema),
    replayProtectionMiddleware,
  )
  public async clearProfile(@Path() channelId: string, @Request() request: TypedRequest): Promise<void> {
    await this.service.clearProfile(channelId, request.user!.userId, request);
    this.setStatus(204);
  }

  @Post("{channelId}/runs")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:probe:Execute",
    resourceKind: "single-resource",
    resource: relayChannelProbeResourceResolver,
  })
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
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:probe:Execute",
    resourceKind: "single-resource",
    resource: relayChannelProbeResourceResolver,
  })
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
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListLatestProbeRuns",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_READ],
    }),
  )
  @Middlewares(validateBody(relayChannelProbeLatestRunsBodySchema))
  public listLatestRuns(
    @Body() body: RelayChannelProbeLatestRunRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeLatestRunDto[]> {
    return this.service.listLatestRuns(body, request.user!.userId, request);
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
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListProbeRuns",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_READ],
    }),
  )
  @Middlewares(validateParams(relayChannelProbeChannelParamsSchema), validateQuery(relayChannelProbeRunsQuerySchema))
  public listRuns(
    @Path() channelId: string,
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() memberChannelId?: string,
  ): Promise<RelayChannelProbeRunPageDto> {
    return this.service.listRuns(channelId, request.user!.userId, page, pageSize, memberChannelId, request);
  }

  @Delete("{channelId}/runs")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ClearProbeHistory",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE],
    }),
  )
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
    return this.service.clearRunHistory(channelId, scope, request.user!.userId, memberChannelId, request);
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

  @Get("accounts")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListProbeAccounts",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE],
    }),
  )
  public listAccounts(@Request() request: TypedRequest): Promise<RelayChannelProbeAccountDto[]> {
    return this.accountService.list(request);
  }

  @Post("accounts")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:CreateProbeAccount",
    resourceKind: "single-resource",
    resource: platformRelayProbeAccountCreateResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(saveRelayChannelProbeAccountBodySchema),
  )
  public createAccount(
    @Body() body: SaveRelayChannelProbeAccountRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeAccountDto> {
    return this.accountService.save(body, undefined, request);
  }

  @Put("accounts/{accountId}")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:UpdateProbeAccount",
    resourceKind: "single-resource",
    resource: platformRelayProbeAccountResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeAccountParamsSchema),
    replayProtectionMiddleware,
    validateBody(saveRelayChannelProbeAccountBodySchema),
  )
  public updateAccount(
    @Path() accountId: string,
    @Body() body: SaveRelayChannelProbeAccountRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeAccountDto> {
    return this.accountService.save(body, accountId, request);
  }

  @Delete("accounts/{accountId}")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:DeleteProbeAccount",
    resourceKind: "single-resource",
    resource: platformRelayProbeAccountResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeAccountParamsSchema),
    replayProtectionMiddleware,
  )
  public async deleteAccount(@Path() accountId: string, @Request() request: TypedRequest): Promise<void> {
    await this.accountService.remove(accountId, request);
    this.setStatus(204);
  }

  @Post("accounts/{accountId}/refresh")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:RefreshProbeAccount",
    resourceKind: "single-resource",
    resource: platformRelayProbeAccountResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    validateParams(relayChannelProbeAccountParamsSchema),
    replayProtectionMiddleware,
  )
  public refreshAccount(
    @Path() accountId: string,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelProbeAccountDto> {
    return this.accountService.refresh(accountId, request);
  }

  @Post("targets/configure")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(configureRelayChannelProbeTargetsBodySchema),
  )
  public configureTargets(
    @Body() body: ConfigureRelayChannelProbeTargetsRequest,
    @Request() request: TypedRequest,
  ): Promise<ConfigureRelayChannelProbeTargetsResponse> {
    return this.service.configureTargets(body, request.user!.userId);
  }

  @Post("accounts/bindings")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @ReplayProtected()
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(bindRelayChannelProbeAccountsBodySchema),
  )
  public bindAccounts(
    @Body() body: BindRelayChannelProbeAccountsRequest,
    @Request() request: TypedRequest,
  ): Promise<ConfigureRelayChannelProbeTargetsResponse> {
    return this.service.bindAccounts(body, request.user!.userId);
  }
}
