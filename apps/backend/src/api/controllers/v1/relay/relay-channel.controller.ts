import { platformRelayChannelResourceResolver } from "@/iam/resources/platform-relay-channel-resources";
import { relayChannelSubmissionResourceResolver } from "@/iam/resources/relay-channel-submission-resources";
import { relayProviderClaimBalanceResourceResolver } from "@/iam/request/relay-provider-resource-resolvers";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Patch,
  Path,
  Post,
  Put,
  Query,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelProviderRevenueService } from "@/services/relay/relay-channel-provider-revenue.service";
import type {
  BatchDeleteRelayChannelsRequest,
  BatchRelayChannelsResultDto,
  BatchSetRelayChannelStatusRequest,
  BatchUpdateRelayChannelsRequest,
  BatchUpdateRelayChannelsResponse,
  BatchUpdateRelayChannelHealthConfigRequest,
  RelayChannelDto,
  RelayCatalogOptionDto,
  RelayRoutingCatalogOptionDto,
  RelayChannelOptionDto,
  CreateRelayChannelRequest,
  DuplicateRelayChannelRequest,
  ExportRelayChannelsRequest,
  ImportRelayChannelsRequest,
  ImportRelayChannelsResponse,
  RelayChannelExportResponse,
  RelayChannelManagementListItemDto,
  RelayChannelTopologyAuditDto,
  RelayChannelHealthDto,
  RelayChannelHealthOverviewDto,
  RelayAutomaticPoolHealthDto,
  UpdateRelayChannelHealthConfigRequest,
  UpdateRelayChannelRequest,
  SubmitRelayChannelRequest,
  ReviewRelayChannelSubmissionRequest,
  UpdateRelayChannelProviderConfigRequest,
  UpdateRelayChannelServiceStatusRequest,
  CreateRelayChannelChangeRequest,
  ReviewRelayChannelChangeRequest,
  RelayChannelChangeRequestDto,
  RelayChannelChangeRequestStatus,
  RelayChannelUpstreamModelsRequest,
  RelayChannelUpstreamModelsResponse,
  RelayChannelModelMatchMode,
  BatchRelayChannelUpstreamModelsRequest,
  BatchRelayChannelUpstreamModelsResponse,
  ApplyRelayChannelModelRestrictionsRequest,
  ApplyRelayChannelModelRestrictionsResponse,
  RelayChannelProviderEarningsResponse,
  ClaimRelayChannelProviderEarningsResponse,
  RelayChannelSubmissionStatus,
} from "@/api/dto/relay/relay-channel.dto";
import type { PaginatedResponse } from "@/api/dto/common/common.dto";
import {
  CheckPermission,
  PermissionCheckMode,
  RequireAnyPermission,
  RequirePermission,
} from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import {
  batchDeleteRelayChannelsBodySchema,
  batchDuplicateRelayChannelsBodySchema,
  batchSetRelayChannelStatusBodySchema,
  batchUpdateRelayChannelsBodySchema,
  batchUpdateRelayChannelHealthConfigBodySchema,
  createRelayChannelBodySchema,
  duplicateRelayChannelBodySchema,
  exportRelayChannelsBodySchema,
  importRelayChannelsBodySchema,
  relayChannelManagementQuerySchema,
  relayChannelIdParamsSchema,
  updateRelayChannelHealthConfigBodySchema,
  updateRelayChannelBodySchema,
  submitRelayChannelBodySchema,
  reviewRelayChannelSubmissionBodySchema,
  updateRelayChannelProviderConfigBodySchema,
  updateRelayChannelServiceStatusBodySchema,
  createRelayChannelChangeRequestBodySchema,
  reviewRelayChannelChangeRequestBodySchema,
  relayChannelUpstreamModelsBodySchema,
  batchRelayChannelUpstreamModelsBodySchema,
  applyRelayChannelModelRestrictionsBodySchema,
  providerEarningsQuerySchema,
} from "@/api/schema/relay/relay-channel.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";
import { relayChannelResourceResolver } from "@/iam/request/resource-resolvers";

@Route("v1/relay-channels")
@Tags("Relay Channels")
export class RelayChannelController extends Controller {
  private channelService = RelayChannelService.getInstance();
  private providerRevenueService = RelayChannelProviderRevenueService.getInstance();

  @Get()
  @Security("jwt", ["relay:channel:read"])
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListChannels",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async listChannels(
    @Request() request: TypedRequest,
    @Query() includeDisabled?: boolean,
  ): Promise<RelayChannelDto[]> {
    return this.channelService.listChannelConfigurations(request.user!.userId, includeDisabled === true, request);
  }

  @Get("management")
  @Security("jwt", ["relay:channel:read"])
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListManagementChannels",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Middlewares(validateQuery(relayChannelManagementQuerySchema))
  public async listManagementChannels(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
    @Query() channelType?: RelayChannelManagementListItemDto["channelType"],
    @Query() channelTypes?: RelayChannelManagementListItemDto["channelType"][],
    @Query() enabled?: boolean,
    @Query() submissionStatus?: RelayChannelSubmissionStatus,
    @Query() models?: string[],
    @Query() modelMatchMode?: RelayChannelModelMatchMode,
  ): Promise<PaginatedResponse<RelayChannelManagementListItemDto>> {
    return this.channelService.listManagementChannels(
      request.user!.userId,
      {
        page,
        pageSize,
        keyword,
        channelType,
        channelTypes,
        enabled,
        submissionStatus,
        models,
        modelMatchMode,
      },
      request,
    );
  }

  @Get("topology-audit")
  @Security("jwt", ["relay:channel:read"])
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:AuditChannelTopology",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Authentication required")
  @Response(403, "IAM authorization denied")
  public async getTopologyAudit(@Request() request: TypedRequest): Promise<RelayChannelTopologyAuditDto> {
    return this.channelService.getTopologyAudit(request.user!.userId, request);
  }

  /**
   * Lists caller-visible channel capabilities. Automatic proxy pools include limited member and routing data
   * needed to disclose variable pricing, while upstream credentials, URLs, mappings, and visibility rules remain hidden.
   */
  @Get("options")
  @Security("jwt", ["relay:channel:read"])
  @RequireAnyPermission([
    Permission.RELAY_CHANNEL_READ,
    Permission.RELAY_TOKEN_CREATE,
    Permission.RELAY_TOKEN_READ,
    Permission.MONTHLY_PASS_TEMPLATE_READ,
    Permission.MONTHLY_PASS_TEMPLATE_WRITE,
    Permission.OJ_APIKEY_CREATE,
    Permission.OJ_APIKEY_READ,
    Permission.OJ_APIKEY_UPDATE,
  ])
  public async listChannelOptions(
    @Request() request: TypedRequest,
    @Query() targetUserId?: string,
    @Query() excludePooled?: boolean,
  ): Promise<RelayChannelOptionDto[]> {
    return this.channelService.listChannelOptions(request.user!.userId, targetUserId, { excludePooled });
  }

  /** Safe directory for token and other end-user routing selectors. */
  @Get("routing-catalog")
  @Security("jwt", ["relay:channel:read"])
  @RequireAnyPermission([
    Permission.RELAY_TOKEN_CREATE,
    Permission.RELAY_TOKEN_READ,
    Permission.MONTHLY_PASS_TEMPLATE_READ,
    Permission.MONTHLY_PASS_TEMPLATE_WRITE,
    Permission.OJ_APIKEY_CREATE,
    Permission.OJ_APIKEY_READ,
    Permission.OJ_APIKEY_UPDATE,
  ])
  public async listRoutingCatalogOptions(
    @Request() request: TypedRequest,
    @Query() targetUserId?: string,
  ): Promise<RelayRoutingCatalogOptionDto[]> {
    return this.channelService.listRoutingCatalogOptions(request.user!.userId, targetUserId);
  }

  /**
   * Consumer-facing API documentation catalog. Variable-priced logical channels expose only a
   * model-level multiplier range; pool topology, members, and routing are never included.
   */
  @Get("catalog")
  @Security("jwt", ["relay:channel:read"])
  @RequireAnyPermission([
    Permission.RELAY_CHANNEL_SUBMIT,
    Permission.RELAY_TOKEN_CREATE,
    Permission.RELAY_TOKEN_READ,
    Permission.MONTHLY_PASS_TEMPLATE_READ,
    Permission.MONTHLY_PASS_TEMPLATE_WRITE,
    Permission.OJ_APIKEY_CREATE,
    Permission.OJ_APIKEY_READ,
    Permission.OJ_APIKEY_UPDATE,
  ])
  public async listCatalogOptions(@Request() request: TypedRequest): Promise<RelayCatalogOptionDto[]> {
    return this.channelService.listCatalogOptions(request.user!.userId);
  }

  @Get("health/overview")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListChannelHealth",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async getChannelHealthOverview(@Request() request: TypedRequest): Promise<RelayChannelHealthOverviewDto> {
    return this.channelService.getChannelHealthOverview(request.user!.userId, request);
  }

  @Get("{id}/health")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:GetChannelHealth",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  @Middlewares(validateParams(relayChannelIdParamsSchema))
  public async getChannelHealth(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelHealthDto | RelayAutomaticPoolHealthDto> {
    return this.channelService.getChannelHealth(id, request.user!.userId, request);
  }

  @Get("health/automatic-pools")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListAutomaticPoolHealth",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async getAutomaticPoolHealths(@Request() request: TypedRequest): Promise<RelayAutomaticPoolHealthDto[]> {
    return this.channelService.getAutomaticPoolHealths(request.user!.userId, request);
  }

  @Patch("{id}/health-config")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:UpdateChannelHealthConfig",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_UPDATE],
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(updateRelayChannelHealthConfigBodySchema),
  )
  public async updateChannelHealthConfig(
    @Path() id: string,
    @Body() body: UpdateRelayChannelHealthConfigRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelHealthDto> {
    return this.channelService.updateChannelHealthConfig(id, body, request.user!.userId, request);
  }

  @Patch("health/batch-config")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:UpdateChannelHealthConfig",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_UPDATE],
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchUpdateRelayChannelHealthConfigBodySchema),
  )
  public async batchUpdateChannelHealthConfig(
    @Body() body: BatchUpdateRelayChannelHealthConfigRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    return this.channelService.batchUpdateChannelHealthConfig(body, request.user!.userId, request);
  }

  @Delete("{id}/health")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ClearChannelHealth",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_UPDATE],
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
  )
  public async clearChannelHealth(@Path() id: string, @Request() request: TypedRequest): Promise<{ cleared: true }> {
    await this.channelService.clearChannelHealth(id, request.user!.userId, request);
    return { cleared: true };
  }

  @Post("health/batch-clear")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ClearChannelHealth",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_UPDATE],
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchDeleteRelayChannelsBodySchema),
  )
  public async batchClearChannelHealth(
    @Body() body: BatchDeleteRelayChannelsRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    return this.channelService.batchClearChannelHealth(body.ids, request.user!.userId, request);
  }

  @Post("submissions")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:CreateMyChannelSubmission",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_SUBMIT],
    }),
  )
  @Middlewares(replayProtectionMiddleware, validateBody(submitRelayChannelBodySchema))
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async submitChannel(
    @Body() body: SubmitRelayChannelRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.submitChannel(body, request.user!.userId, request);
  }

  @Get("submissions/mine")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListMyChannelSubmissions",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_SUBMIT],
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async listMySubmittedChannels(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<PaginatedResponse<RelayChannelDto>> {
    return this.channelService.listMySubmittedChannels(request.user!.userId, page, pageSize, request);
  }

  @Delete("submissions/{id}")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_SUBMIT, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:DeleteMyChannelSubmission",
    resourceKind: "single-resource",
    resource: relayChannelSubmissionResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async deleteSubmittedChannel(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ message: string }> {
    await this.channelService.deleteSubmittedChannel(id, request.user!.userId, request);
    setResponseMessageKey(request, "relay.channelDeleted");
    return { message: "渠道删除成功" };
  }

  @Patch("submissions/{id}/service-status")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_SUBMIT, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:SetMyChannelSubmissionServiceStatus",
    resourceKind: "single-resource",
    resource: relayChannelSubmissionResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(updateRelayChannelServiceStatusBodySchema),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async updateSubmittedChannelServiceStatus(
    @Path() id: string,
    @Body() body: UpdateRelayChannelServiceStatusRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.updateSubmittedChannelServiceStatus(id, body, request.user!.userId, request);
  }

  @Post("{id}/review-submission")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_REVIEW, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:Review",
    resourceKind: "single-resource",
    resource: relayChannelResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(reviewRelayChannelSubmissionBodySchema),
  )
  public async reviewChannelSubmission(
    @Path() id: string,
    @Body() body: ReviewRelayChannelSubmissionRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.reviewSubmittedChannel(id, body, request.user!.userId, request);
  }

  @Put("{id}/provider-config")
  @Security("jwt")
  @CheckPermission([Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE], PermissionCheckMode.ANY, "jwt", [
    {
      action: "quyan:relay:channel:Review",
      resourceKind: "single-resource",
      resource: relayChannelResourceResolver,
    },
    {
      action: "quyan:relay:channel:Update",
      resourceKind: "single-resource",
      resource: relayChannelResourceResolver,
    },
  ])
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(updateRelayChannelProviderConfigBodySchema),
  )
  public async updateProviderConfig(
    @Path() id: string,
    @Body() body: UpdateRelayChannelProviderConfigRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.updateProviderConfig(id, body, request.user!.userId, request);
  }

  @Post("{id}/change-requests")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_SUBMIT, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:Submit",
    resourceKind: "single-resource",
    resource: relayChannelResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(createRelayChannelChangeRequestBodySchema),
  )
  public async createChangeRequest(
    @Path() id: string,
    @Body() body: CreateRelayChannelChangeRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelChangeRequestDto> {
    return this.channelService.createChangeRequest(id, body, request.user!.userId, request);
  }

  @Get("change-requests/mine")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListMyChannelChangeRequests",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Authentication required")
  @Response(403, "IAM authorization denied")
  public async listMyChangeRequests(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ) {
    return this.channelService.listMyChangeRequests(request.user!.userId, page, pageSize, request);
  }

  @Get("change-requests")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListChannelChangeRequests",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Authentication required")
  @Response(403, "IAM authorization denied")
  public async listChangeRequests(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Query() reviewStatus?: RelayChannelChangeRequestStatus,
  ) {
    return this.channelService.listChangeRequests(page, pageSize, reviewStatus, request);
  }

  @Post("change-requests/{id}/review")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_REVIEW)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(reviewRelayChannelChangeRequestBodySchema),
  )
  public async reviewChangeRequest(
    @Path() id: string,
    @Body() body: ReviewRelayChannelChangeRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelChangeRequestDto> {
    return this.channelService.reviewChangeRequest(id, body, request.user!.userId, request);
  }

  @Post("upstream-models")
  @Security("jwt")
  @RequireAnyPermission([
    Permission.RELAY_CHANNEL_REVIEW,
    Permission.RELAY_CHANNEL_UPDATE,
    Permission.RELAY_CHANNEL_SUBMIT,
  ])
  @Middlewares(validateBody(relayChannelUpstreamModelsBodySchema))
  public async listUpstreamModels(
    @Body() body: RelayChannelUpstreamModelsRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelUpstreamModelsResponse> {
    return this.channelService.listUpstreamModels(body, request.user!.userId);
  }

  @Post("batch/upstream-models")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_UPDATE)
  @Middlewares(validateBody(batchRelayChannelUpstreamModelsBodySchema))
  public async batchListUpstreamModels(
    @Body() body: BatchRelayChannelUpstreamModelsRequest,
  ): Promise<BatchRelayChannelUpstreamModelsResponse> {
    return this.channelService.batchListUpstreamModels(body);
  }

  @Post("batch/model-restrictions")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(applyRelayChannelModelRestrictionsBodySchema),
  )
  public async applyModelRestrictions(
    @Body() body: ApplyRelayChannelModelRestrictionsRequest,
    @Request() request: TypedRequest,
  ): Promise<ApplyRelayChannelModelRestrictionsResponse> {
    return this.channelService.applyModelRestrictions(body, request.user!.userId, request);
  }

  @Get("provider/earnings")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:ListMyProviderEarnings",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_PROVIDER_READ],
    }),
    validateQuery(providerEarningsQuerySchema),
  )
  public async getMyProviderEarnings(
    @Request() request: TypedRequest,
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
  ): Promise<RelayChannelProviderEarningsResponse> {
    return this.providerRevenueService.listOwnEarnings(request.user!.userId, page, pageSize, request);
  }

  @Post("provider/earnings/claim")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_PROVIDER_SETTLE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:ClaimMyProviderEarnings",
    resourceKind: "single-resource",
    resource: relayProviderClaimBalanceResourceResolver,
  })
  @Middlewares(replayProtectionMiddleware)
  public async claimMyProviderEarnings(
    @Request() request: TypedRequest,
  ): Promise<ClaimRelayChannelProviderEarningsResponse> {
    return this.providerRevenueService.claimOwnEarnings(request.user!.userId, request);
  }

  @Get("{id}")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:GetChannel",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  @Middlewares(validateParams(relayChannelIdParamsSchema))
  public async getChannel(@Path() id: string, @Request() request: TypedRequest): Promise<RelayChannelDto> {
    return this.channelService.getChannelConfiguration(id, request.user!.userId, request);
  }

  @Post("export")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_EXPORT)
  @ReplayProtected()
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(exportRelayChannelsBodySchema),
  )
  public async exportChannels(
    @Body() body: ExportRelayChannelsRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelExportResponse> {
    return this.channelService.exportChannels(body, request.user!.userId, request);
  }

  @Post("import")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(importRelayChannelsBodySchema),
  )
  public async importChannels(
    @Body() body: ImportRelayChannelsRequest,
    @Request() request: TypedRequest,
  ): Promise<ImportRelayChannelsResponse> {
    return this.channelService.importChannels(body, request.user!.userId, request);
  }

  @Post()
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRelayChannelBodySchema),
  )
  public async createChannel(
    @Body() body: CreateRelayChannelRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.createChannel(body, request.user!.userId, request);
  }

  @Put("{id}")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:Update",
    resourceKind: "single-resource",
    resource: relayChannelResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(updateRelayChannelBodySchema),
  )
  public async updateChannel(
    @Path() id: string,
    @Body() body: UpdateRelayChannelRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.updateChannel(id, body, request.user!.userId, request);
  }

  @Patch("batch")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_UPDATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchUpdateRelayChannelsBodySchema),
  )
  public async batchUpdateChannels(
    @Body() body: BatchUpdateRelayChannelsRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchUpdateRelayChannelsResponse> {
    return this.channelService.batchUpdateChannels(body, request.user!.userId, request);
  }

  @Post("{id}/duplicate")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:Create",
    resourceKind: "single-resource",
    resource: relayChannelResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
    validateBody(duplicateRelayChannelBodySchema),
  )
  public async duplicateChannel(
    @Path() id: string,
    @Body() body: DuplicateRelayChannelRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto> {
    return this.channelService.duplicateChannel(id, body, request.user!.userId, request);
  }

  @Post("batch/duplicate")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_CREATE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchDuplicateRelayChannelsBodySchema),
  )
  public async batchDuplicateChannels(
    @Body() body: { ids: string[] },
    @Request() request: TypedRequest,
  ): Promise<RelayChannelDto[]> {
    return this.channelService.batchDuplicateChannels(body.ids, request.user!.userId, request);
  }

  @Patch("{id}/toggle")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:channel:Update",
    resourceKind: "single-resource",
    resource: relayChannelResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
  )
  public async toggleChannelStatus(@Path() id: string, @Request() request: TypedRequest): Promise<RelayChannelDto> {
    return this.channelService.toggleChannelStatus(id, request.user!.userId, request);
  }

  @Patch("batch/status")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:SetChannelStatus",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_UPDATE],
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchSetRelayChannelStatusBodySchema),
  )
  public async batchSetChannelStatus(
    @Body() body: BatchSetRelayChannelStatusRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    return this.channelService.batchSetChannelStatus(body, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt")
  @CheckPermission(Permission.RELAY_CHANNEL_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:relay:DeleteChannel",
    resourceKind: "single-resource",
    resource: platformRelayChannelResourceResolver,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async deleteChannel(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.channelService.deleteChannel(id, request.user!.userId, request);
    setResponseMessageKey(request, "relay.channelDeleted");
    return { message: "渠道删除成功" };
  }

  @Post("batch/delete")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:relay:DeleteChannel",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
      legacyPermissions: [Permission.RELAY_CHANNEL_DELETE],
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchDeleteRelayChannelsBodySchema),
  )
  @Response(401, "Unauthorized")
  @Response(403, "Forbidden")
  public async batchDeleteChannels(
    @Body() body: BatchDeleteRelayChannelsRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    return this.channelService.batchDeleteChannels(body, request.user!.userId, request);
  }
}
