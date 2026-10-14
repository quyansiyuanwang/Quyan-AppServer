import { PlatformRelayUptimeReadIamService } from "@/services/relay/platform-relay-uptime-read-iam.service";
import { platformRelayUptimeArn } from "@/iam/resources/platform-relay-uptime-resources";
import { PlatformRelayConfigurationWriteIamService } from "@/services/relay/platform-relay-configuration-write-iam.service";
import { PlatformRelayConfigurationReadIamService } from "@/services/relay/platform-relay-configuration-read-iam.service";
import {
  platformRelayConfigurationArn,
  platformRelayConfigurationWriteResources,
} from "@/iam/resources/platform-relay-configuration-resources";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import type { ErrorResponse } from "@/api/response";
import {
  Body,
  Controller,
  Get,
  Put,
  Query,
  Request,
  Route,
  Security,
  Tags,
  Middlewares,
  Response,
} from "@tsoa/runtime";
import type {
  RelayConfigDto,
  RelayConcurrencyStatusResponse,
  UpdateRelayConfigRequest,
  UptimeResponse,
} from "@/api/dto/relay/relay-config.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { HttpStatusCode } from "axios";
import { updateRelayConfigBodySchema } from "@/api/schema/relay/relay-config.schema";
import { validateBody } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import type { TypedRequest } from "@/types/express";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";

@Route("v1/relay-config")
@Tags("Relay Config")
export class RelayConfigController extends Controller {
  private relayProxyService = RelayProxyService.getInstance();

  @Get()
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:relay:GetConfiguration",
      resourceKind: "collection",
      resource: platformRelayConfigurationArn,
    }),
  )
  public async getRelayConfig(@Request() request: TypedRequest): Promise<RelayConfigDto> {
    return PlatformRelayConfigurationReadIamService.getInstance().read(request);
  }

  @Put()
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:relay:UpdateConfiguration",
      resourceKind: "batch",
      resource: platformRelayConfigurationWriteResources,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(updateRelayConfigBodySchema),
  )
  public async updateRelayConfig(
    @Body() body: UpdateRelayConfigRequest,
    @Request() request: TypedRequest,
  ): Promise<RelayConfigDto> {
    return PlatformRelayConfigurationWriteIamService.getInstance().write(body, request);
  }

  /**
   * Get upstream availability status from configured monitoring service
   * Supports mixed mode: upstream API + transformation rules + static data fallback
   * @returns Upstream availability data
   */
  @Get("uptime-status")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:relay:GetUptimeStatus",
      resourceKind: "collection",
      resource: platformRelayUptimeArn,
    }),
  )
  public async getUptimeStatus(@Request() request: TypedRequest): Promise<UptimeResponse> {
    return PlatformRelayUptimeReadIamService.getInstance().read(request);
  }

  @Get("concurrency-status")
  @Security("jwt")
  @RequirePermission(Permission.UPSTREAM_STATUS_READ)
  public async getConcurrencyStatus(@Query() userId?: string): Promise<RelayConcurrencyStatusResponse> {
    return this.relayProxyService.getConcurrencyStatus(userId);
  }
}
