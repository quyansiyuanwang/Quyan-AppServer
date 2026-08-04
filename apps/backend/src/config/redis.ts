import Redis from "ioredis";
import { getLogger, LogCategory } from "@/util/logger";
import { env } from "./env";

const logger = getLogger("RedisConfig", LogCategory.CONFIG);

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export function getRedisConfig(): RedisConfig {
  return {
    host: env.redis.host || "localhost",
    port: env.redis.port,
    password: env.redis.password,
    db: env.redis.db,
  };
}

export function createRedisClient(): Redis {
  const config = getRedisConfig();

  const client = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 1, // Reduced from 3 to 1 to prevent request pileup
    enableOfflineQueue: false, // Disable offline queue to fail fast when Redis is down
    connectTimeout: 5000, // 5 second connection timeout
    commandTimeout: 3000, // 3 second command timeout
    lazyConnect: false, // Connect immediately to detect issues early
    keepAlive: 30000, // Keep TCP connection alive
    enableReadyCheck: true, // Ensure Redis is ready before accepting commands
  });

  // Use once() for event listeners to prevent memory leaks if client is recreated
  client.once("connect", () => {
    logger.info("Redis client connected");
  });

  client.on("error", (err) => {
    logger.error("Redis client error:", err);
  });

  client.once("ready", () => {
    logger.info("Redis client ready");
  });

  return client;
}
