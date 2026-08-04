import axios from "axios";
import { getLogger, LogCategory } from "@/util/logger";
import { env } from "@/config/env";
import { BAIDU_GEO_API, GEO_CACHE_PREFIX, GEO_CACHE_TTL_SECONDS, REQUEST_TIMEOUT_MS } from "@/constant/ip-geolocation";

const logger = getLogger("IpGeolocationService", LogCategory.BUSINESS);
import { RedisService } from "@/services/infrastructure/redis.service";

interface BaiduGeoResponse {
  status: number;
  content?: {
    address?: string;
    address_detail?: {
      province?: string;
      city?: string;
      district?: string;
      street?: string;
      street_number?: string;
    };
  };
}

/**
 * IP geolocation lookup with Redis caching (24-hour TTL).
 * Uses Baidu open data API. Falls back to "未知地区" on any error.
 */
export class IpGeolocationService {
  private static instance: IpGeolocationService;
  private redis = RedisService.getInstance();

  static getInstance(): IpGeolocationService {
    if (!IpGeolocationService.instance) IpGeolocationService.instance = new IpGeolocationService();

    return IpGeolocationService.instance;
  }

  /**
   * Returns a human-readable location string for the given IP.
   * Result is cached in Redis for 24 hours.
   */
  async getLocation(ip: string): Promise<string> {
    if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10."))
      return "本地网络";

    const cacheKey = `${GEO_CACHE_PREFIX}${ip}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached;
    } catch {
      // Redis unavailable — proceed to API lookup
    }

    const location = await this.fetchFromBaidu(ip);

    try {
      await this.redis.set(cacheKey, location, GEO_CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal
    }

    return location;
  }

  private async fetchFromBaidu(ip: string): Promise<string> {
    const ak = String(env.integrations.baiduMap.ipLocationAk || "").trim();
    if (!ak) {
      logger.warn("[IpGeolocation] Missing BAIDU_IP_LOCATION_AK, fallback to 未知地区");
      return "未知地区";
    }

    try {
      const response = await axios.get<BaiduGeoResponse>(BAIDU_GEO_API, {
        params: { ip, coor: "bd09ll", ak },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const data = response.data;
      if (data?.status === 0) {
        const directAddress = data.content?.address;
        if (directAddress && typeof directAddress === "string" && directAddress.trim()) return directAddress.trim();

        const detail = data.content?.address_detail;
        const fallbackAddress = [detail?.province, detail?.city, detail?.district]
          .filter((part) => typeof part === "string" && part.trim())
          .join("");

        if (fallbackAddress.trim()) return fallbackAddress.trim();
      }
    } catch (err) {
      logger.warn(`[IpGeolocation] Failed to fetch location for ${ip}: ${(err as Error).message}`);
    }

    return "未知地区";
  }
}
