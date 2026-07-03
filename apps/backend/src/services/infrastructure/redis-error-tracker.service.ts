import { Redis } from "ioredis";
import { createRedisClient } from "@/config/redis";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("RedisErrorTracker", LogCategory.SECURITY);

export interface ErrorTrackingResult {
  errorCount: number;
  shouldBan: boolean;
  banLevel?: number;
  banDuration?: number;
}

export class RedisErrorTrackerService {
  private static instance: RedisErrorTrackerService;
  private client: Redis | null = null;
  private isAvailable = false;

  private constructor() {
    try {
      this.client = createRedisClient();
      this.isAvailable = true;
    } catch (error) {
      logger.error("Failed to initialize Redis client:", error);
      this.isAvailable = false;
    }
  }

  static getInstance(): RedisErrorTrackerService {
    if (!RedisErrorTrackerService.instance) RedisErrorTrackerService.instance = new RedisErrorTrackerService();

    return RedisErrorTrackerService.instance;
  }

  /**
   * Get current hour timestamp for Redis key
   */
  private getCurrentHourKey(ipAddress: string): string {
    const now = new Date();
    const hourTimestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}`;
    return `ip_errors:${ipAddress}:${hourTimestamp}`;
  }

  /**
   * Get ban key for IP
   */
  private getBanKey(ipAddress: string): string {
    return `ip_banned:${ipAddress}`;
  }

  /**
   * Increment error count for IP in current hour window
   */
  async incrementErrorCount(ipAddress: string): Promise<number> {
    if (!this.isAvailable || !this.client) {
      logger.warn("Redis not available, skipping error tracking");
      return 0;
    }

    try {
      const key = this.getCurrentHourKey(ipAddress);
      const count = await this.client.incr(key);

      // Set TTL on first increment (3600 seconds = 1 hour)
      if (count === 1) await this.client.expire(key, 3600);

      logger.debug(`Error count for ${ipAddress}: ${count}`);
      return count;
    } catch (error) {
      logger.error("Failed to increment error count:", error);
      return 0;
    }
  }

  /**
   * Get current error count for IP in current hour
   */
  async getErrorCount(ipAddress: string): Promise<number> {
    if (!this.isAvailable || !this.client) return 0;

    try {
      const key = this.getCurrentHourKey(ipAddress);
      const count = await this.client.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger.error("Failed to get error count:", error);
      return 0;
    }
  }

  /**
   * Check if IP is banned in Redis
   */
  async isIPBanned(ipAddress: string): Promise<boolean> {
    if (!this.isAvailable || !this.client) return false;

    try {
      const key = this.getBanKey(ipAddress);
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error("Failed to check ban status:", error);
      return false;
    }
  }

  /**
   * Get ban info for IP
   */
  async getBanInfo(ipAddress: string): Promise<{ level: number; expireTime: string; reason: string } | null> {
    if (!this.isAvailable || !this.client) return null;

    try {
      const key = this.getBanKey(ipAddress);
      const data = await this.client.get(key);
      if (!data) return null;

      return JSON.parse(data);
    } catch (error) {
      logger.error("Failed to get ban info:", error);
      return null;
    }
  }

  /**
   * Ban an IP in Redis
   */
  async banIP(ipAddress: string, level: number, duration: number, reason: string): Promise<void> {
    if (!this.isAvailable || !this.client) {
      logger.warn("Redis not available, skipping Redis ban");
      return;
    }

    try {
      const key = this.getBanKey(ipAddress);
      const expireTime =
        duration === -1
          ? new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString() // 100 years for permanent
          : new Date(Date.now() + duration * 1000).toISOString();

      const banData = JSON.stringify({ level, expireTime, reason });

      if (duration === -1)
        // Permanent ban - no TTL
        await this.client.set(key, banData);
      else
        // Temporary ban - set TTL
        await this.client.setex(key, duration, banData);

      logger.info(`IP ${ipAddress} banned at level ${level} for ${duration === -1 ? "permanent" : duration + "s"}`);
    } catch (error) {
      logger.error("Failed to ban IP in Redis:", error);
    }
  }

  /**
   * Unban an IP in Redis
   */
  async unbanIP(ipAddress: string): Promise<void> {
    if (!this.isAvailable || !this.client) return;

    try {
      const key = this.getBanKey(ipAddress);
      await this.client.del(key);
      logger.info(`IP ${ipAddress} unbanned in Redis`);
    } catch (error) {
      logger.error("Failed to unban IP in Redis:", error);
    }
  }

  /**
   * Clear error count for IP
   */
  async clearErrorCount(ipAddress: string): Promise<void> {
    if (!this.isAvailable || !this.client) return;

    try {
      const key = this.getCurrentHourKey(ipAddress);
      await this.client.del(key);
      logger.debug(`Error count cleared for ${ipAddress}`);
    } catch (error) {
      logger.error("Failed to clear error count:", error);
    }
  }

  /**
   * Check Redis availability
   */
  isRedisAvailable(): boolean {
    return this.isAvailable;
  }
}
