import { Response, NextFunction } from "express";
import type { TypedRequest } from "@/types/express";
import { BadRequestError, UnauthorizedError } from "@/util/errors";
import { RedisService } from "@/services/infrastructure/redis.service";
import { getLogger, LogCategory } from "@/util/logger";
import { CustomCode } from "@/constant/custom-code";
import { EnvSpace } from "@/config/env";
import { extractClientFingerprint } from "@/util/client-fingerprint";
import {
  buildReplayNonceKey,
  buildReplaySigningSessionKey,
  createTestReplaySigningMaterial,
  createReplayProtectionUnavailableError,
  generateReplaySign,
  REPLAY_SIGNING_SESSION_HEADER,
  type ReplaySigningSessionRecord,
  verifyReplaySign,
} from "@/util/replay-signing-session";

const logger = getLogger("ReplayProtection", LogCategory.SECURITY);

const TIMESTAMP_TOLERANCE = 300; // 5分钟时间窗口
const NONCE_TTL = 600; // Nonce有效期10分钟

/**
 * 防重放攻击中间件
 * 验证 X-Nonce, X-Timestamp, X-Sign 请求头
 */
export async function replayProtectionMiddleware(req: TypedRequest, res: Response, next: NextFunction): Promise<void> {
  // AccessKey (ak_) requests are machine-to-machine calls; skip replay protection
  if (req.accessKey) return next();

  const nonce = req.headers["x-nonce"] as string;
  const timestamp = req.headers["x-timestamp"] as string;
  const sign = req.headers["x-sign"] as string;
  const sessionId = req.headers[REPLAY_SIGNING_SESSION_HEADER] as string;

  if (!nonce || !timestamp || !sign || !sessionId) {
    logger.warn(`Missing replay protection headers: ${req.method} ${req.path} from ${req.ip}`);
    throw new BadRequestError("缺少防重放请求头", CustomCode.REQUIRE_REPLAY_PROTECTION);
  }

  // 验证时间戳
  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);

  if (isNaN(reqTime)) throw new BadRequestError("无效的时间戳", CustomCode.REPLAY_PROTECTION_FAILED);

  if (Math.abs(now - reqTime) > TIMESTAMP_TOLERANCE) {
    logger.warn(`Timestamp out of range: ${req.method} ${req.path} from ${req.ip}`);
    throw new UnauthorizedError("请求已过期", CustomCode.REPLAY_PROTECTION_FAILED);
  }

  const redis = RedisService.getInstance();

  if (!redis.isRedisAvailable()) {
    logger.error("Replay protection rejected because Redis is unavailable", {
      nonce,
      sessionId,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    throw createReplayProtectionUnavailableError();
  }

  const requestFingerprint = extractClientFingerprint(req);
  let signingSession: ReplaySigningSessionRecord;

  if (EnvSpace.isTest && sessionId.startsWith("test:")) {
    const material = createTestReplaySigningMaterial(requestFingerprint);
    if (material.sessionId !== sessionId) {
      logger.warn(`Replay signing test session mismatch: ${req.method} ${req.path} from ${req.ip}`);
      throw new UnauthorizedError("签名会话无效，请重试", CustomCode.REPLAY_PROTECTION_FAILED);
    }

    signingSession = {
      signingKey: material.signingKey,
      fingerprint: material.fingerprint,
      issuedAt: new Date(0).toISOString(),
      expiresAt: new Date(8640000000000000).toISOString(),
    };
  } else {
    const rawSession = await redis.get(buildReplaySigningSessionKey(sessionId));
    if (!rawSession) {
      logger.warn(`Replay signing session missing or expired: ${req.method} ${req.path} from ${req.ip}`);
      throw new UnauthorizedError("签名会话已过期，请重试", CustomCode.REPLAY_PROTECTION_FAILED);
    }

    try {
      signingSession = JSON.parse(rawSession) as ReplaySigningSessionRecord;
    } catch {
      logger.warn(`Replay signing session corrupted: ${req.method} ${req.path} from ${req.ip}`);
      throw new UnauthorizedError("签名会话无效，请重试", CustomCode.REPLAY_PROTECTION_FAILED);
    }
  }

  if (signingSession.fingerprint && requestFingerprint !== signingSession.fingerprint) {
    logger.warn(`Replay signing fingerprint mismatch: ${req.method} ${req.path} from ${req.ip}`);
    throw new UnauthorizedError("签名会话校验失败", CustomCode.REPLAY_PROTECTION_FAILED);
  }

  const nonceKey = buildReplayNonceKey(sessionId, nonce);

  // 验证签名
  const body = req.body ? JSON.stringify(req.body) : "";
  const expectedSign = generateReplaySign(nonce, timestamp, body, req.path, signingSession.signingKey);

  if (!verifyReplaySign(sign, expectedSign)) {
    logger.warn(`Invalid signature: ${req.method} ${req.path} from ${req.ip}`);
    throw new UnauthorizedError("签名验证失败", CustomCode.REPLAY_PROTECTION_FAILED);
  }

  // 原子占用 nonce，避免并发请求绕过 exists + set 的竞态窗口
  const reserved = await redis.setIfNotExists(nonceKey, "1", NONCE_TTL * 1000);
  if (reserved === false) {
    logger.warn(`Nonce reused or reservation failed: ${nonce}, ${req.method} ${req.path} from ${req.ip}`);
    throw new UnauthorizedError("请求已被使用", CustomCode.REPLAY_PROTECTION_FAILED);
  }

  if (reserved === null) {
    logger.error("Replay protection rejected because nonce reservation backend is unavailable", {
      nonce,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    throw createReplayProtectionUnavailableError();
  }

  next();
}

export const generateSign = generateReplaySign;
