import { noUndefined } from "@/util/function-tools";
import { createHash, generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function getExplicitEnvPath(): string | undefined {
  const raw = String(process.env.ENV_FILE_PATH || "").trim();
  if (!raw) return undefined;
  return raw;
}

function assertNotRunningFromDist(): void {
  const cwd = process.cwd();
  if (path.basename(cwd) !== "dist") return;

  throw new Error(
    "Backend must not be started with process.cwd() inside dist. Start from the app root or configure PM2 cwd to the app root.",
  );
}

function resolveEnvPath(fileName: string): string {
  const explicitEnvPath = getExplicitEnvPath();
  if (explicitEnvPath && path.basename(explicitEnvPath) === fileName && fs.existsSync(explicitEnvPath))
    return explicitEnvPath;

  const candidate = path.join(process.cwd(), fileName);
  if (fs.existsSync(candidate)) return candidate;

  return fileName;
}

assertNotRunningFromDist();

// 基础配置来自 .env，测试环境再由 .env.test 覆盖，避免测试缺少通用配置项。
dotenv.config({
  path: resolveEnvPath(".env"),
});

if (process.env.NODE_ENV === "test")
  dotenv.config({
    path: resolveEnvPath(".env.test"),
    override: true,
  });

function assertTestModeDatabaseSafety(): void {
  if (process.env.NODE_ENV !== "test") return;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined in test environment variables");

  const normalized = databaseUrl.toLowerCase();
  const looksLikeTestDatabase =
    normalized.includes("_test") ||
    normalized.includes("-test") ||
    normalized.endsWith("test") ||
    normalized.includes("/test");

  if (!looksLikeTestDatabase)
    throw new Error(
      `Unsafe test database configuration detected: ${databaseUrl}. NODE_ENV=test must use a dedicated test database.`,
    );
}

assertTestModeDatabaseSafety();

function assertTrustedDeviceSecretIsolation(): void {
  const trustedDeviceSecret = String(process.env.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim();
  if (trustedDeviceSecret && trustedDeviceSecret.length < 64)
    throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be at least 64 characters");

  const jwtAccessSecret = String(process.env.JWT_ACCESS_SECRET || "").trim();
  if (!trustedDeviceSecret || !jwtAccessSecret) return;

  if (trustedDeviceSecret === jwtAccessSecret)
    throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be different from JWT_ACCESS_SECRET");
}

assertTrustedDeviceSecretIsolation();

function assertReplaySigningSecretIsolation(): void {
  const replaySigningMasterSecret = String(process.env.REPLAY_SIGNING_MASTER_SECRET || "").trim();
  if (!replaySigningMasterSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET is not defined in environment variables");
  if (replaySigningMasterSecret.length < 64)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be at least 64 characters");

  const jwtAccessSecret = String(process.env.JWT_ACCESS_SECRET || "").trim();
  const jwtRefreshSecret = String(process.env.JWT_REFRESH_SECRET || "").trim();
  const trustedDeviceSecret = String(process.env.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim();

  if (replaySigningMasterSecret === jwtAccessSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from JWT_ACCESS_SECRET");
  if (replaySigningMasterSecret === jwtRefreshSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from JWT_REFRESH_SECRET");
  if (trustedDeviceSecret && replaySigningMasterSecret === trustedDeviceSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from TWO_FACTOR_TRUSTED_DEVICE_SECRET");
}

assertReplaySigningSecretIsolation();

let authCenterGeneratedKeyPair: { privateKey: string; publicKey: string } | null = null;

function normalizePemEnv(value: string | undefined): string | undefined {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  return normalized.replace(/\\n/g, "\n");
}

function getAuthCenterGeneratedKeyPair(): { privateKey: string; publicKey: string } {
  if (!authCenterGeneratedKeyPair) {
    const generated = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    authCenterGeneratedKeyPair = {
      privateKey: generated.privateKey,
      publicKey: generated.publicKey,
    };

    if (process.env.NODE_ENV !== "test")
      console.warn(
        "[AuthCenter] AUTH_CENTER_JWT_PRIVATE_KEY/AUTH_CENTER_JWT_PUBLIC_KEY not set, using ephemeral dev key pair",
      );
  }

  return authCenterGeneratedKeyPair;
}

function getAuthCenterPrivateKey(): string {
  const privateKey = normalizePemEnv(process.env.AUTH_CENTER_JWT_PRIVATE_KEY);
  if (privateKey) return privateKey;
  if (isProduction()) throw new Error("AUTH_CENTER_JWT_PRIVATE_KEY is not defined in production environment");
  return getAuthCenterGeneratedKeyPair().privateKey;
}

function getAuthCenterPublicKey(): string {
  const publicKey = normalizePemEnv(process.env.AUTH_CENTER_JWT_PUBLIC_KEY);
  if (publicKey) return publicKey;
  if (isProduction()) throw new Error("AUTH_CENTER_JWT_PUBLIC_KEY is not defined in production environment");
  return getAuthCenterGeneratedKeyPair().publicKey;
}

function authCenterConfig() {
  const publicKey = getAuthCenterPublicKey();

  return {
    issuer: String(process.env.AUTH_CENTER_ISSUER || `http://localhost:${getPort()}/auth-center`).trim(),
    algorithm: "RS256" as const,
    privateKey: getAuthCenterPrivateKey(),
    publicKey,
    keyId: String(
      process.env.AUTH_CENTER_JWT_KID || createHash("sha256").update(publicKey).digest("hex").slice(0, 16),
    ).trim(),
    jwksPath: "/auth-center/.well-known/jwks.json",
    discoveryPath: "/auth-center/.well-known/openid-configuration",
  };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}

function getPort(): number {
  const port = process.env.PORT;
  if (!port) throw new Error("PORT is not defined in environment variables");
  return parseInt(port, 10);
}

function getJwtSecret(tp: "access" | "refresh"): string {
  if (tp === "access") {
    if (!process.env.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET is not defined in environment variables");
    return process.env.JWT_ACCESS_SECRET;
  } else if (tp === "refresh") {
    if (!process.env.JWT_REFRESH_SECRET) throw new Error("JWT_REFRESH_SECRET is not defined in environment variables");
    return process.env.JWT_REFRESH_SECRET;
  } else throw new Error("Invalid token type specified");
}

function getJwtExpiresIn(tp: "access" | "refresh"): string {
  if (tp === "access")
    return process.env.JWT_ACCESS_EXPIRES_IN || "5"; // 默认5秒
  else if (tp === "refresh")
    return process.env.JWT_REFRESH_EXPIRES_IN || "60"; // 默认60秒
  else throw new Error("Invalid token type specified");
}

function getHiddenDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not defined in environment variables");
  const hiddenUrl = url.replace(/(\/\/.*:).*@/, "$1****@");

  return hiddenUrl;
}

function getDatabaseParams(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not defined in environment variables");

  // Extract only query parameters (after ?)
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return "—"; // No query params

  return url.slice(queryIndex + 1);
}

function getProtectedGroupName(): string | undefined {
  return process.env.PROTECTED_GROUP_NAME;
}

function rateLimitConfig() {
  return {
    emailVerification: {
      perIp: {
        maxRequests: parseInt(process.env.RATE_LIMIT_IP_MAX || "5"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_IP_WINDOW || "60"),
      },
      perIpEmail: {
        maxRequests: parseInt(process.env.RATE_LIMIT_IP_EMAIL_MAX || "2"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_IP_EMAIL_WINDOW || "60"),
      },
    },
    twoFactorVerification: {
      perIp: {
        maxRequests: parseInt(process.env.RATE_LIMIT_2FA_IP_MAX || "20"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_2FA_IP_WINDOW || "10"),
      },
      perChallenge: {
        maxRequests: parseInt(process.env.RATE_LIMIT_2FA_CHALLENGE_MAX || "5"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_2FA_CHALLENGE_WINDOW || "10"),
      },
    },
    twoFactorEmailSend: {
      perIp: {
        maxRequests: parseInt(process.env.RATE_LIMIT_2FA_EMAIL_SEND_IP_MAX || "10"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_2FA_EMAIL_SEND_IP_WINDOW || "10"),
      },
      perChallenge: {
        maxRequests: parseInt(process.env.RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_MAX || "3"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_WINDOW || "10"),
      },
    },
    twoFactorTrustedDevice: {
      perIp: {
        maxRequests: parseInt(process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_MAX || "60"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_WINDOW || "10"),
      },
      perUser: {
        maxRequests: parseInt(process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_MAX || "30"),
        windowMinutes: parseInt(process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_WINDOW || "10"),
      },
    },
    cleanupRetentionDays: parseInt(process.env.RATE_LIMIT_RETENTION_DAYS || "7"),
  };
}

function redisConfig() {
  return {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0", 10),
  };
}

function webAuthnConfig() {
  return {
    rpName: process.env.WEBAUTHN_RP_NAME || "AppServer",
    rpId: process.env.WEBAUTHN_RP_ID || "localhost",
    origin: process.env.WEBAUTHN_ORIGIN || `https://${process.env.WEBAUTHN_RP_ID || "localhost"}`,
  };
}

function recaptchaConfig() {
  return {
    enabled: process.env.RECAPTCHA_ENABLED === "true",
    secretKey: process.env.RECAPTCHA_SECRET_KEY || "",
    minScore: parseFloat(process.env.RECAPTCHA_MIN_SCORE || "0.5"),
  };
}

function turnstileConfig() {
  return {
    siteKey: process.env.TURNSTILE_SITE_KEY || "",
    secretKey: process.env.TURNSTILE_SECRET_KEY || "",
  };
}

function baiduMapConfig() {
  return {
    ipLocationAk: String(process.env.BAIDU_IP_LOCATION_AK || "").trim(),
  };
}

function captchaTrustConfig() {
  const sameSiteRaw = String(process.env.CAPTCHA_TRUST_COOKIE_SAMESITE || "lax")
    .trim()
    .toLowerCase();

  return {
    windowMinutes: sanitizeInt(process.env.CAPTCHA_TRUST_WINDOW_MINUTES, 30, 0, 1440),
    cookieName: String(process.env.CAPTCHA_TRUST_COOKIE_NAME || "captcha_trust").trim() || "captcha_trust",
    cookieSameSite: (sameSiteRaw === "strict" || sameSiteRaw === "none" ? sameSiteRaw : "lax") as
      | "strict"
      | "lax"
      | "none",
    cookieDomain: String(process.env.CAPTCHA_TRUST_COOKIE_DOMAIN || "").trim() || undefined,
    secret: String(process.env.CAPTCHA_TRUST_COOKIE_SECRET || process.env.REPLAY_SIGNING_MASTER_SECRET || "").trim(),
  };
}

function logConfig() {
  return {
    disableConsoleLog: process.env.DISABLE_CONSOLE_LOG === "true",
    enableFileLogging: process.env.ENABLE_FILE_LOGGING === "true",
  };
}

function sanitizeInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function twoFactorConfig() {
  return {
    trustWindowMinutes: sanitizeInt(process.env.TWO_FACTOR_TRUST_WINDOW_MINUTES, 1440, 0, 525600),
    totpIntervalSeconds: sanitizeInt(process.env.TWO_FACTOR_TOTP_INTERVAL_SECONDS, 30, 15, 300),
    totpWindowSteps: sanitizeInt(process.env.TWO_FACTOR_TOTP_WINDOW_STEPS, 1, 0, 10),
    recoveryCodeCount: sanitizeInt(process.env.TWO_FACTOR_RECOVERY_CODE_COUNT, 10, 1, 50),
    reminderEnabled: process.env.TWO_FACTOR_REMINDER_ENABLED !== "false",
    reminderIntervalDays: sanitizeInt(process.env.TWO_FACTOR_REMINDER_INTERVAL_DAYS, 7, 1, 365),
  };
}

function twoFactorTrustWindowMinutes(): number {
  return twoFactorConfig().trustWindowMinutes;
}

function twoFactorTrustedDeviceCookieSameSite(): "strict" | "lax" | "none" {
  const raw = String(process.env.TWO_FACTOR_TRUSTED_DEVICE_COOKIE_SAMESITE || "strict")
    .trim()
    .toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

function twoFactorTrustedDeviceCookieDomain(): string | undefined {
  const raw = String(process.env.TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN || "").trim();
  return raw || undefined;
}

function authRefreshCookieName(): string {
  const raw = String(process.env.AUTH_REFRESH_COOKIE_NAME || "").trim();
  return raw || "refresh_token";
}

function authRefreshCookieSameSite(): "strict" | "lax" | "none" {
  const raw = String(process.env.AUTH_REFRESH_COOKIE_SAMESITE || "strict")
    .trim()
    .toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

function authRefreshCookieDomain(): string | undefined {
  const raw = String(process.env.AUTH_REFRESH_COOKIE_DOMAIN || "").trim();
  return raw || undefined;
}

function authSessionCookieName(): string {
  const raw = String(process.env.AUTH_SESSION_COOKIE_NAME || "").trim();
  return raw || "auth_session_id";
}

function authSessionCookieSameSite(): "strict" | "lax" | "none" {
  const raw = String(process.env.AUTH_SESSION_COOKIE_SAMESITE || "strict")
    .trim()
    .toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

function authSessionCookieDomain(): string | undefined {
  const raw = String(process.env.AUTH_SESSION_COOKIE_DOMAIN || "").trim();
  return raw || undefined;
}

function authSessionForceOfflineTtlDays(): number {
  return sanitizeInt(process.env.AUTH_SESSION_FORCE_OFFLINE_TTL_DAYS, 30, 1, 3650);
}

function distributedLockConfig() {
  return {
    acquireTimeoutMs: sanitizeInt(process.env.DISTRIBUTED_LOCK_ACQUIRE_TIMEOUT_MS, 5000, 100, 60000),
    retryIntervalMs: sanitizeInt(process.env.DISTRIBUTED_LOCK_RETRY_INTERVAL_MS, 100, 10, 2000),
    defaultTtlMs: sanitizeInt(process.env.DISTRIBUTED_LOCK_DEFAULT_TTL_MS, 10000, 500, 120000),
    failClosed: process.env.DISTRIBUTED_LOCK_FAIL_CLOSED !== "false",
  };
}

function relayResourceGuardConfig() {
  return {
    multipartBodyLimitMb: sanitizeInt(process.env.RELAY_MULTIPART_BODY_LIMIT_MB, 4, 1, 20),
    imageMaxConcurrency: sanitizeInt(process.env.RELAY_IMAGE_MAX_CONCURRENCY, 1, 1, 10),
    imageQueueTimeoutMs: sanitizeInt(process.env.RELAY_IMAGE_QUEUE_TIMEOUT_MS, 300000, 0, 300000),
    nonStreamUpstreamTimeoutMs: sanitizeInt(process.env.RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS, 600000, 10000, 600000),
    maxUpstreamResponseBodyMb: sanitizeInt(process.env.RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB, 64, 1, 128),
    // 图片请求响应体单独限制，防止大图片（base64）击穿内存
    imageResponseBodyLimitMb: sanitizeInt(process.env.RELAY_IMAGE_RESPONSE_BODY_LIMIT_MB, 16, 1, 64),
  };
}

function requestSizeLimitConfig() {
  return {
    jsonBodyLimitMb: sanitizeInt(process.env.REQUEST_JSON_BODY_LIMIT_MB, 5, 1, 100),
    urlencodedBodyLimitMb: sanitizeInt(process.env.REQUEST_URLENCODED_BODY_LIMIT_MB, 2, 1, 100),
    otherBodyLimitMb: sanitizeInt(process.env.REQUEST_OTHER_BODY_LIMIT_MB, 10, 1, 100),
  };
}

function replayProtectionConfig() {
  return {
    masterSecret: String(process.env.REPLAY_SIGNING_MASTER_SECRET || "").trim(),
    signingSessionTtlSeconds: sanitizeInt(process.env.REPLAY_SIGNING_SESSION_TTL_SECONDS, 600, 60, 3600),
  };
}

function cwd(): string {
  return process.cwd();
}

export const EnvSpace = {
  isProduction: noUndefined(isProduction),
  isDevelopment: noUndefined(isDevelopment),
  isTest: noUndefined(isTest),
  port: noUndefined(getPort),
  accessTokenSecret: noUndefined(() => getJwtSecret("access")),
  refreshTokenSecret: noUndefined(() => getJwtSecret("refresh")),
  accessTokenExpiresIn: noUndefined(() => getJwtExpiresIn("access")),
  refreshTokenExpiresIn: noUndefined(() => getJwtExpiresIn("refresh")),
  hiddenDatabase: noUndefined(getHiddenDatabase),
  databaseParams: noUndefined(getDatabaseParams),
  protectedGroupName: noUndefined(getProtectedGroupName),
  rateLimitConfig: noUndefined(rateLimitConfig),
  redisConfig: noUndefined(redisConfig),
  webAuthnConfig: noUndefined(webAuthnConfig),
  recaptchaConfig: noUndefined(recaptchaConfig),
  turnstileConfig: noUndefined(turnstileConfig),
  baiduMapConfig: noUndefined(baiduMapConfig),
  captchaTrustConfig: captchaTrustConfig(),
  logConfig: noUndefined(logConfig),
  twoFactorConfig: noUndefined(twoFactorConfig),
  twoFactorTrustWindowMinutes: noUndefined(twoFactorTrustWindowMinutes),
  twoFactorTrustedDeviceCookieSameSite: noUndefined(twoFactorTrustedDeviceCookieSameSite),
  twoFactorTrustedDeviceCookieDomain: twoFactorTrustedDeviceCookieDomain(),
  authRefreshCookieName: noUndefined(authRefreshCookieName),
  authRefreshCookieSameSite: noUndefined(authRefreshCookieSameSite),
  authRefreshCookieDomain: authRefreshCookieDomain(),
  authSessionCookieName: noUndefined(authSessionCookieName),
  authSessionCookieSameSite: noUndefined(authSessionCookieSameSite),
  authSessionCookieDomain: authSessionCookieDomain(),
  authSessionForceOfflineTtlDays: noUndefined(authSessionForceOfflineTtlDays),
  distributedLockConfig: noUndefined(distributedLockConfig),
  relayResourceGuardConfig: noUndefined(relayResourceGuardConfig),
  requestSizeLimitConfig: noUndefined(requestSizeLimitConfig),
  replayProtectionConfig: noUndefined(replayProtectionConfig),
  authCenterConfig: noUndefined(authCenterConfig),
  cwd: noUndefined(cwd),
};
