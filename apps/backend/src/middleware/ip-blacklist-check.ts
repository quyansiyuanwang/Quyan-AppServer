import type { Request, Response, NextFunction } from "express";
import { IPBlackListService } from "@/services/system/ipblacklist.service";
import { IPWhiteListService } from "@/services/system/ipwhitelist.service";
import { extractClientIp } from "@/util/ip-extractor";
import { CustomCode } from "@/constant/custom-code";
import { HttpStatusCode } from "axios";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("IPBlacklistCheckMiddleware", LogCategory.MIDDLEWARE);

export async function ipBlacklistCheckMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = extractClientIp(req);

    // 白名单 IP 直接放行，不检查黑名单
    const whitelistService = IPWhiteListService.getInstance();
    if (await whitelistService.isWhitelisted(ip)) {
      next();
      return;
    }

    const ipBlacklistService = IPBlackListService.getInstance();
    const isBlacklisted = await ipBlacklistService.isIpBlacklisted(ip);

    if (isBlacklisted) {
      const blacklistInfo = await ipBlacklistService.getBlacklistInfo(ip);
      logger.warn(`Blocked request from blacklisted IP: ${ip}`, {
        path: req.path,
        method: req.method,
        expireTime: blacklistInfo?.ExpireTime,
      });
      res.status(HttpStatusCode.Forbidden).json({
        code: CustomCode.IP_BLACKLISTED,
        message: "您的 IP 地址已被封禁",
        data: { expireTime: blacklistInfo?.ExpireTime, reason: blacklistInfo?.reason },
      });
      return;
    }

    next();
  } catch (error) {
    logger.error("IP blacklist check failed", { error, ip: extractClientIp(req) });
    next();
  }
}
