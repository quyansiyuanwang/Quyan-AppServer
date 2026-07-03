import type { Request, Response, NextFunction } from "express";
import { RedisService } from "@/services/infrastructure/redis.service";
import { IPBlackListService } from "@/services/system/ipblacklist.service";
import { IPWhiteListService } from "@/services/system/ipwhitelist.service";
import { ConfigService } from "@/services/system/config.service";
import { extractClientIp } from "@/util/ip-extractor";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("ErrorTrackerMiddleware", LogCategory.MIDDLEWARE);

/**
 * 追踪单次错误请求的权重并在必要时触发封禁
 * 可被中间件和流式代理路径共同调用
 */
export async function trackErrorForIp(req: Request, statusCode: number, body?: any): Promise<void> {
  if (statusCode < 400) return;

  const ip = extractClientIp(req);

  // 白名单 IP 跳过错误追踪，永不自动封禁
  const whitelistService = IPWhiteListService.getInstance();
  if (await whitelistService.isWhitelisted(ip)) return;

  const redisService = RedisService.getInstance();
  const configService = ConfigService.getInstance();

  if (!redisService.isRedisAvailable()) {
    logger.debug("Redis unavailable, skipping error tracking");
    return;
  }

  const errorWeights = await configService.getErrorWeights();

  let weight = 1;
  const customCode = body?.code;
  const customCodeStr = customCode?.toString();
  if (customCodeStr && customCodeStr in errorWeights.customCodeWeights)
    weight = errorWeights.customCodeWeights[customCodeStr];
  else if (statusCode.toString() in errorWeights.statusCodeWeights)
    weight = errorWeights.statusCodeWeights[statusCode.toString()];

  if (weight === 0) {
    logger.debug(`Skipping error tracking for IP ${ip} (weight=0, status=${statusCode}, code=${customCode})`);
    return;
  }

  const hourTimestamp = RedisService.getCurrentHourTimestamp();
  const redisKey = RedisService.getIpErrorKey(ip, hourTimestamp);
  const errorCount = await redisService.increment(redisKey, 3600, weight);

  const weightKey = RedisService.getIpErrorWeightKey(ip);
  const newWeight = await redisService.increment(weightKey, 0, weight);

  const breakdownKey = RedisService.getIpErrorBreakdownKey(ip);
  const breakdownField =
    customCodeStr && customCodeStr in errorWeights.customCodeWeights ? `c:${customCodeStr}` : `s:${statusCode}`;
  await redisService.hIncrByFloat(breakdownKey, breakdownField, weight);

  const ipBanConfig = await configService.getIpBanConfig();
  const maxWeight = ipBanConfig.level3Threshold * 2;
  if (newWeight && newWeight > maxWeight) await redisService.set(weightKey, maxWeight.toString());

  // 仅在时间戳不存在时初始化，避免每次错误都重置导致衰减永远不生效
  const tsKey = RedisService.getIpErrorWeightTsKey(ip);
  const existingTs = await redisService.get(tsKey);
  if (!existingTs) await redisService.set(tsKey, Date.now().toString());

  if (errorCount !== null) {
    logger.debug(`IP ${ip} error count: ${errorCount} (status: ${statusCode})`);
    const ipBlacklistService = IPBlackListService.getInstance();
    const banResult = await ipBlacklistService.checkAndBanIfNeeded(ip, errorCount);
    if (banResult.banned && banResult.level) logger.warn(`IP ${ip} has been auto-banned at level ${banResult.level}`);
  }
}

/**
 * 错误跟踪中间件
 * 拦截错误响应并跟踪 IP 的错误计数，达到阈值时自动封禁
 */
export function errorTrackerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any): Response {
    setImmediate(async () => {
      try {
        await trackErrorForIp(req, res.statusCode, body);
      } catch (error) {
        logger.error("Error tracking failed", { error, ip: extractClientIp(req) });
      }
    });
    return originalJson(body);
  };

  next();
}
