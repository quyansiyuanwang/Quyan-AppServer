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
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import type {
  BatchDeleteRelayChannelsRequest,
  BatchRelayChannelsResultDto,
  BatchSetRelayChannelStatusRequest,
  RelayChannelDto,
  RelayChannelOptionDto,
  CreateRelayChannelRequest,
  DuplicateRelayChannelRequest,
  ExportRelayChannelsRequest,
  ImportRelayChannelsRequest,
  ImportRelayChannelsResponse,
  RelayChannelExportResponse,
  UpdateRelayChannelRequest,
} from "@/api/dto/relay/relay-channel.dto";
import { RequireAnyPermission, RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import type { TypedRequest } from "@/types/express";
import {
  batchDeleteRelayChannelsBodySchema,
  batchDuplicateRelayChannelsBodySchema,
  batchSetRelayChannelStatusBodySchema,
  createRelayChannelBodySchema,
  duplicateRelayChannelBodySchema,
  exportRelayChannelsBodySchema,
  importRelayChannelsBodySchema,
  relayChannelIdParamsSchema,
  updateRelayChannelBodySchema,
} from "@/api/schema/relay/relay-channel.schema";
import { validateBody, validateParams } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { ReplayProtected } from "@/util/replay-protected-decorator";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

@Route("v1/relay-channels")
@Tags("Relay Channels")
export class RelayChannelController extends Controller {
  private channelService = RelayChannelService.getInstance();

  @Get()
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_READ)
  public async listChannels(
    @Request() request: TypedRequest,
    @Query() includeDisabled?: boolean,
  ): Promise<RelayChannelDto[]> {
    return this.channelService.listChannels(request.user!.userId, includeDisabled === true);
  }

  /**
   * Lists the caller-visible channel capabilities without exposing pool topology or channel configuration.
   */
  @Get("options")
  @Security("jwt")
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
  public async listChannelOptions(@Request() request: TypedRequest): Promise<RelayChannelOptionDto[]> {
    return this.channelService.listChannelOptions(request.user!.userId);
  }

  @Get("{id}")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_READ)
  @Middlewares(validateParams(relayChannelIdParamsSchema))
  public async getChannel(@Path() id: string, @Request() request: TypedRequest): Promise<RelayChannelDto> {
    return this.channelService.getChannel(id, request.user!.userId);
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
  @RequirePermission(Permission.RELAY_CHANNEL_UPDATE)
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

  @Post("{id}/duplicate")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_CREATE)
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
  @RequirePermission(Permission.RELAY_CHANNEL_UPDATE)
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
  @RequirePermission(Permission.RELAY_CHANNEL_UPDATE)
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
  @RequirePermission(Permission.RELAY_CHANNEL_DELETE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(relayChannelIdParamsSchema),
  )
  public async deleteChannel(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.channelService.deleteChannel(id, request.user!.userId, request);
    setResponseMessageKey(request, "relay.channelDeleted");
    return { message: "渠道删除成功" };
  }

  @Post("batch/delete")
  @Security("jwt")
  @RequirePermission(Permission.RELAY_CHANNEL_DELETE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(batchDeleteRelayChannelsBodySchema),
  )
  public async batchDeleteChannels(
    @Body() body: BatchDeleteRelayChannelsRequest,
    @Request() request: TypedRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    return this.channelService.batchDeleteChannels(body, request.user!.userId, request);
  }
}
