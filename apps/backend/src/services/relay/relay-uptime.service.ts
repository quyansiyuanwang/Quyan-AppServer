import type { RelayConfig } from "@prisma/client";
import axios from "axios";
import { RELAY_UPTIME_POLICY } from "@/constant/relay-config";
import { getLogger, LogCategory } from "@/util/logger";
import { HEARTBEAT_STATUS } from "@/constant/status";
import { RelayConfigService } from "./relay-config.service";
import type { RelayConfigDto, UpstreamApiResponse, UptimeResponse } from "@/api/dto/relay/relay-config.dto";
export type RelayUptimeConfiguration = Pick<
  RelayConfigDto,
  "uptimeStatusUrl" | "monitorNameMapping" | "showOnlyConfigured" | "uptimeStaticData"
>;
export function relayUptimeConfiguration(row: RelayConfig | null): RelayUptimeConfiguration {
  if (!row) return {};
  const mapping = row.monitorNameMapping;
  if (
    mapping !== null &&
    (typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      !Object.values(mapping).every((value) => typeof value === "string"))
  )
    throw new Error("Invalid monitoring name mapping");
  return {
    uptimeStatusUrl: row.uptimeStatusUrl ?? undefined,
    monitorNameMapping: mapping as Record<string, string> | null,
    showOnlyConfigured: row.showOnlyConfigured ?? undefined,
    uptimeStaticData: row.uptimeStaticData,
  };
}
const logger = getLogger("RelayUptime", LogCategory.BUSINESS);
export class RelayUptimeService {
  private static instance: RelayUptimeService;
  static getInstance() {
    return (this.instance ??= new RelayUptimeService());
  }
  async getStatus(): Promise<UptimeResponse> {
    return this.fromConfiguration(await RelayConfigService.getInstance().getRelayConfig());
  }
  async fromConfiguration(config: RelayUptimeConfiguration): Promise<UptimeResponse> {
    // Priority 1: Upstream API + name mapping
    if (config.uptimeStatusUrl)
      try {
        const response = await axios.get<UpstreamApiResponse>(config.uptimeStatusUrl, {
          timeout: RELAY_UPTIME_POLICY.upstreamTimeoutMs,
        });

        const { heartbeatList, uptimeList } = response.data;

        if (!heartbeatList || !uptimeList) {
          logger.error("Invalid upstream API response format", {
            hasHeartbeatList: !!heartbeatList,
            hasUptimeList: !!uptimeList,
          });
          throw new Error("Invalid upstream API response format");
        }

        logger.info("Processing heartbeat data", {
          heartbeatListCount: Object.keys(heartbeatList).length,
          uptimeListCount: Object.keys(uptimeList).length,
        });

        // Transform the data into monitors
        const monitors = Object.entries(heartbeatList).map(([id, heartbeats]) => {
          const uptime = uptimeList[`${id}_24`] || 0;
          const latestHeartbeat = heartbeats && heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;

          // 使用简单的名称映射
          const displayName = config.monitorNameMapping?.[id] || `Monitor ${id}`;

          return {
            id,
            name: displayName,
            uptime,
            status: latestHeartbeat?.status ?? HEARTBEAT_STATUS.DOWN,
            heartbeats: heartbeats ? heartbeats.slice(-RELAY_UPTIME_POLICY.heartbeatHistoryLimit) : [], // Keep last 100 heartbeats
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
      } catch {
        logger.warn("Monitoring source unavailable; checking configured static fallback");
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
}
