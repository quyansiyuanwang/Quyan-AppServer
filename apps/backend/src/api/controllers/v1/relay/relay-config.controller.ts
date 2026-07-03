import { Body, Controller, Get, Put, Query, Request, Route, Security, Tags, Middlewares } from "@tsoa/runtime";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import type {
  RelayConfigDto,
  RelayConcurrencyStatusResponse,
  UpdateRelayConfigRequest,
  UptimeResponse,
  UpstreamApiResponse,
} from "@/api/dto/relay/relay-config.dto";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import axios from "axios";
import { getLogger, LogCategory } from "@/util/logger";
import { updateRelayConfigBodySchema } from "@/api/schema/relay/relay-config.schema";
import { validateBody } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { HEARTBEAT_STATUS } from "@/constant/status";
import type { TypedRequest } from "@/types/express";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";

const logger = getLogger("RelayConfigController", LogCategory.BUSINESS);

@Route("v1/relay-config")
@Tags("Relay Config")
export class RelayConfigController extends Controller {
  private relayConfigService = RelayConfigService.getInstance();
  private relayProxyService = RelayProxyService.getInstance();

  @Get()
  @Security("jwt")
  @RequirePermission(Permission.MODEL_PRICING_UPDATE)
  public async getRelayConfig(): Promise<RelayConfigDto> {
    const config = await this.relayConfigService.getRelayConfig();
    return config;
  }

  @Put()
  @Security("jwt")
  @RequirePermission(Permission.MODEL_PRICING_UPDATE)
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
    const config = await this.relayConfigService.updateRelayConfig(body, request.user!.userId, request);
    return config;
  }

  /**
   * Get upstream availability status from configured monitoring service
   * Supports mixed mode: upstream API + transformation rules + static data fallback
   * @returns Upstream availability data
   */
  @Get("uptime-status")
  @Security("jwt")
  @RequirePermission(Permission.UPSTREAM_STATUS_READ)
  public async getUptimeStatus(): Promise<UptimeResponse> {
    const config = await this.relayConfigService.getRelayConfig();

    // Priority 1: Upstream API + name mapping
    if (config.uptimeStatusUrl)
      try {
        const response = await axios.get<UpstreamApiResponse>(config.uptimeStatusUrl, {
          timeout: 10000,
        });

        logger.info("Upstream API response received", {
          hasData: !!response.data,
          dataKeys: response.data ? Object.keys(response.data) : [],
        });

        const { heartbeatList, uptimeList } = response.data;

        if (!heartbeatList || !uptimeList) {
          logger.error("Invalid upstream API response format", {
            hasHeartbeatList: !!heartbeatList,
            hasUptimeList: !!uptimeList,
            responseData: response.data,
          });
          throw new Error("Invalid upstream API response format");
        }

        logger.info("Processing heartbeat data", {
          heartbeatListKeys: Object.keys(heartbeatList),
          uptimeListKeys: Object.keys(uptimeList),
        });

        // Transform the data into monitors
        const monitors = Object.entries(heartbeatList).map(([id, heartbeats]) => {
          const uptime = uptimeList[`${id}_24`] || 0;
          const latestHeartbeat = heartbeats && heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;

          // 使用简单的名称映射
          const displayName = config.monitorNameMapping?.[id] || `Monitor ${id}`;

          logger.debug(`Processing monitor ${id}`, {
            heartbeatsCount: heartbeats?.length || 0,
            uptime,
            latestStatus: latestHeartbeat?.status,
            displayName,
          });

          return {
            id,
            name: displayName,
            uptime,
            status: latestHeartbeat?.status ?? HEARTBEAT_STATUS.DOWN,
            heartbeats: heartbeats ? heartbeats.slice(-100) : [], // Keep last 100 heartbeats
          };
        });

        // 如果启用了"仅展示已配置"，则过滤掉未配置的监控项
        const filteredMonitors =
          config.showOnlyConfigured && config.monitorNameMapping
            ? monitors.filter((m) => config.monitorNameMapping![m.id])
            : monitors;

        logger.info("Monitors processed", {
          count: monitors.length,
          filteredCount: filteredMonitors.length,
          showOnlyConfigured: config.showOnlyConfigured,
        });

        const category = {
          categoryName: "Upstream Services",
          monitors: filteredMonitors,
        };

        return {
          data: [category],
          message: "Success",
          success: true,
        };
      } catch (error: any) {
        logger.error("Upstream API failed, falling back to static data", { error: error.message });
      }

    // Priority 2: Static data fallback
    if (config.uptimeStaticData)
      return {
        data: [config.uptimeStaticData],
        message: "Using static data (upstream unavailable)",
        success: true,
      };

    // Priority 3: No data configured
    return {
      data: [],
      message: "No uptime data configured",
      success: false,
    };
  }

  @Get("concurrency-status")
  @Security("jwt")
  @RequirePermission(Permission.UPSTREAM_STATUS_READ)
  public async getConcurrencyStatus(@Query() userId?: string): Promise<RelayConcurrencyStatusResponse> {
    return this.relayProxyService.getConcurrencyStatus(userId);
  }
}
