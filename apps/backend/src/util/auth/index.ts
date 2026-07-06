import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { EnvSpace } from "../../config/env";
import { RedisService } from "@/services/infrastructure/redis.service";

export interface JWTPayload {
  userId: string;
  updatedAt: string; // 用户更新时间，用于验证token是否过期
  status?: number; // 用户状态，用于验证账号是否被禁用
  principalUserId?: string;
  accountOwnerId?: string;
  subjectType?: "root" | "sub_user" | "service" | "oauth" | "relay" | "access_key" | "impersonation";
  assumedRoleId?: string;
  roleSessionId?: string;
  jti?: string; // JWT ID
  iat?: number;
  exp?: number;
  /** 仅模拟 token 携带：真实操作者的 userId */
  impersonatorId?: string;
  /** 仅模拟 token 携带：模拟模式 */
  impersonationMode?: "view" | "act";
  [key: string]: any;
}

/** 模拟 token 有效期（秒） */
export const IMPERSONATION_TOKEN_TTL_SECONDS = 60 * 60;

const USER_TOKEN_REVOKED_AFTER_KEY_PREFIX = "auth:user_revoke_after";
const DEFAULT_SESSION_REVOCATION_TTL_SECONDS = 30 * 24 * 60 * 60;

function buildUserTokenRevokedAfterKey(userId: string): string {
  return `${USER_TOKEN_REVOKED_AFTER_KEY_PREFIX}:${userId}`;
}

function parseJwtExpiresToSeconds(raw: string | number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);

  const value = String(raw || "").trim();
  if (!value) return 0;

  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);

  const match = value.match(/^(\d+)\s*([smhdw])$/i);
  if (!match) return 0;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const unit = match[2].toLowerCase();
  switch (unit) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 60 * 60;
    case "d":
      return amount * 24 * 60 * 60;
    case "w":
      return amount * 7 * 24 * 60 * 60;
    default:
      return 0;
  }
}

function getSessionRevocationTtlSeconds(): number {
  const accessTtl = parseJwtExpiresToSeconds(EnvSpace.accessTokenExpiresIn);
  const refreshTtl = parseJwtExpiresToSeconds(EnvSpace.refreshTokenExpiresIn);
  const configured = Math.max(accessTtl, refreshTtl);
  return configured > 0 ? configured : DEFAULT_SESSION_REVOCATION_TTL_SECONDS;
}

class JWTUtil {
  private secret: string;
  private defaultExpiresIn: number;

  constructor(secret: string, expiresIn?: number) {
    this.secret = secret;
    this.defaultExpiresIn = expiresIn ?? 60; // default to 60 seconds
  }

  generateToken(payload: JWTPayload, expiresIn?: number): string {
    // Add jti (JWT ID) to ensure every token is unique
    const payloadWithJti = { ...payload, jti: randomUUID() };
    return jwt.sign(payloadWithJti, this.secret, { expiresIn: expiresIn ?? this.defaultExpiresIn });
  }

  async verifyToken(token: string): Promise<JWTPayload | null> {
    const decoded = jwt.verify(token, this.secret);
    if (typeof decoded === "string") return null;

    const payload = decoded as JWTPayload;

    // Check if JTI is blacklisted
    if (payload.jti) {
      const isBlacklisted = await RedisService.getInstance().isJtiBlacklisted(payload.jti);
      if (isBlacklisted) return null;
    }

    if (payload.userId) {
      const revokedAfterRaw = await RedisService.getInstance().get(buildUserTokenRevokedAfterKey(payload.userId));
      if (revokedAfterRaw) {
        const revokedAfterEpoch = Number.parseInt(revokedAfterRaw, 10);
        if (Number.isFinite(revokedAfterEpoch) && typeof payload.iat === "number" && payload.iat <= revokedAfterEpoch)
          return null;
      }
    }

    return payload;
  }

  async revokeToken(token: string): Promise<void> {
    try {
      const decoded = jwt.verify(token, this.secret);
      if (typeof decoded !== "string" && decoded.jti) {
        const exp = decoded.exp || Math.floor(Date.now() / 1000) + this.defaultExpiresIn;
        const ttl = exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) await RedisService.getInstance().blacklistJti(decoded.jti, ttl);
      }
    } catch (_error) {
      // Token invalid or expired, no need to blacklist
    }
  }
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const revokedAfterEpoch = Math.floor(Date.now() / 1000);
  await RedisService.getInstance().set(
    buildUserTokenRevokedAfterKey(userId),
    revokedAfterEpoch,
    getSessionRevocationTtlSeconds(),
  );
}

export const JWTAccessIns = new JWTUtil(EnvSpace.accessTokenSecret, parseInt(EnvSpace.accessTokenExpiresIn, 10));
export const JWTRefreshIns = new JWTUtil(EnvSpace.refreshTokenSecret, parseInt(EnvSpace.refreshTokenExpiresIn, 10));
