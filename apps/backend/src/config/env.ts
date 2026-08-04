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

// Database test workers receive their isolated runtime values from Vitest setup.
// Apply them after .env.test so the immutable configuration snapshot cannot point
// back at the shared base database or Redis logical database.
if (process.env.NODE_ENV === "test") {
  if (process.env.APPSERVER_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.APPSERVER_TEST_DATABASE_URL;
  if (process.env.APPSERVER_TEST_REDIS_DB) process.env.REDIS_DB = process.env.APPSERVER_TEST_REDIS_DB;
}

type EnvSnapshot = Readonly<Record<string, string | undefined>>;

// Capture the environment once after dotenv has finished. Runtime configuration
// accessors read this private snapshot instead of consulting process.env.
let envSnapshot: EnvSnapshot = Object.freeze({ ...process.env });

function redactDatabaseUrl(value: string): string {
  return value.replace(/(\/\/[^:]+:)[^@]+@/, "$1****@");
}

function secretSummary(value: string | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "<unset>";
  const fingerprint = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `<configured:${normalized.length} chars, fingerprint:${fingerprint}>`;
}

function assertTestModeDatabaseSafety(): void {
  if (envSnapshot.NODE_ENV !== "test") return;

  const databaseUrl = envSnapshot.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined in test environment variables");

  const normalized = databaseUrl.toLowerCase();
  const looksLikeTestDatabase =
    normalized.includes("_test") ||
    normalized.includes("-test") ||
    normalized.endsWith("test") ||
    normalized.includes("/test");

  if (!looksLikeTestDatabase)
    throw new Error(
      `Unsafe test database configuration detected: ${redactDatabaseUrl(databaseUrl)}. NODE_ENV=test must use a dedicated test database.`,
    );
}

function assertTrustedDeviceSecretIsolation(): void {
  const trustedDeviceSecret = String(envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim();
  if (trustedDeviceSecret && trustedDeviceSecret.length < 64)
    throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be at least 64 characters");

  const jwtAccessSecret = String(envSnapshot.JWT_ACCESS_SECRET || "").trim();
  if (!trustedDeviceSecret || !jwtAccessSecret) return;

  if (trustedDeviceSecret === jwtAccessSecret)
    throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be different from JWT_ACCESS_SECRET");
}

function assertReplaySigningSecretIsolation(): void {
  const replaySigningMasterSecret = String(envSnapshot.REPLAY_SIGNING_MASTER_SECRET || "").trim();
  if (!replaySigningMasterSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET is not defined in environment variables");
  if (replaySigningMasterSecret.length < 64)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be at least 64 characters");

  const jwtAccessSecret = String(envSnapshot.JWT_ACCESS_SECRET || "").trim();
  const jwtRefreshSecret = String(envSnapshot.JWT_REFRESH_SECRET || "").trim();
  const trustedDeviceSecret = String(envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim();

  if (replaySigningMasterSecret === jwtAccessSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from JWT_ACCESS_SECRET");
  if (replaySigningMasterSecret === jwtRefreshSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from JWT_REFRESH_SECRET");
  if (trustedDeviceSecret && replaySigningMasterSecret === trustedDeviceSecret)
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from TWO_FACTOR_TRUSTED_DEVICE_SECRET");
}

function assertDeveloperSecretsMasterKey(): void {
  const secret = String(envSnapshot.DEVELOPER_SECRETS_MASTER_KEY || "").trim();
  if (!secret) return;
  if (secret.length < 64)
    throw new Error(`DEVELOPER_SECRETS_MASTER_KEY must be at least 64 characters (${secretSummary(secret)})`);

  const protectedSecrets = [
    envSnapshot.JWT_ACCESS_SECRET,
    envSnapshot.JWT_REFRESH_SECRET,
    envSnapshot.REPLAY_SIGNING_MASTER_SECRET,
    envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_SECRET,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (protectedSecrets.includes(secret))
    throw new Error("DEVELOPER_SECRETS_MASTER_KEY must be different from authentication and replay secrets");
}

function assertRelayChannelProbeMasterKey(): void {
  const secret = String(envSnapshot.RELAY_CHANNEL_PROBE_MASTER_KEY || "").trim();
  if (!secret) return;
  if (secret.length < 64) throw new Error("RELAY_CHANNEL_PROBE_MASTER_KEY must be at least 64 characters");

  const protectedSecrets = [
    envSnapshot.JWT_ACCESS_SECRET,
    envSnapshot.JWT_REFRESH_SECRET,
    envSnapshot.REPLAY_SIGNING_MASTER_SECRET,
    envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_SECRET,
    envSnapshot.DEVELOPER_SECRETS_MASTER_KEY,
  ].map((value) => String(value || "").trim());
  if (protectedSecrets.includes(secret))
    throw new Error("RELAY_CHANNEL_PROBE_MASTER_KEY must be different from authentication and platform secrets");
}

function assertEnvironment(): void {
  const checks = [
    assertTestModeDatabaseSafety,
    assertTrustedDeviceSecretIsolation,
    assertReplaySigningSecretIsolation,
    assertDeveloperSecretsMasterKey,
    assertRelayChannelProbeMasterKey,
  ];
  const failures: string[] = [];

  for (const check of checks) {
    try {
      check();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) throw new Error(`Environment validation failed:\n${failures.join("\n")}`);
}

assertEnvironment();

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

    if (envSnapshot.NODE_ENV !== "test")
      console.warn(
        "[AuthCenter] AUTH_CENTER_JWT_PRIVATE_KEY/AUTH_CENTER_JWT_PUBLIC_KEY not set, using ephemeral dev key pair",
      );
  }

  return authCenterGeneratedKeyPair;
}

function getAuthCenterPrivateKey(): string {
  const privateKey = normalizePemEnv(envSnapshot.AUTH_CENTER_JWT_PRIVATE_KEY);
  if (privateKey) return privateKey;
  if (isProduction()) throw new Error("AUTH_CENTER_JWT_PRIVATE_KEY is not defined in production environment");
  return getAuthCenterGeneratedKeyPair().privateKey;
}

function getAuthCenterPublicKey(): string {
  const publicKey = normalizePemEnv(envSnapshot.AUTH_CENTER_JWT_PUBLIC_KEY);
  if (publicKey) return publicKey;
  if (isProduction()) throw new Error("AUTH_CENTER_JWT_PUBLIC_KEY is not defined in production environment");
  return getAuthCenterGeneratedKeyPair().publicKey;
}

function authCenterConfig() {
  const publicKey = getAuthCenterPublicKey();

  return {
    issuer: String(envSnapshot.AUTH_CENTER_ISSUER || `http://localhost:${getPort()}/auth-center`).trim(),
    algorithm: "RS256" as const,
    privateKey: getAuthCenterPrivateKey(),
    publicKey,
    keyId: String(
      envSnapshot.AUTH_CENTER_JWT_KID || createHash("sha256").update(publicKey).digest("hex").slice(0, 16),
    ).trim(),
    jwksPath: "/auth-center/.well-known/jwks.json",
    discoveryPath: "/auth-center/.well-known/openid-configuration",
  };
}

function isProduction(): boolean {
  return envSnapshot.NODE_ENV === "production";
}

function isDevelopment(): boolean {
  return envSnapshot.NODE_ENV === "development";
}

function isTest(): boolean {
  return envSnapshot.NODE_ENV === "test";
}

function nodeEnv(): string {
  return String(envSnapshot.NODE_ENV || "unknown");
}

function trustedDeviceSecret(): string {
  return String(envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim();
}

function getPort(): number {
  const port = envSnapshot.PORT;
  if (!port) throw new Error("PORT is not defined in environment variables");
  return parseInt(port, 10);
}

function trustProxyHops(): number {
  const raw = String(envSnapshot.TRUST_PROXY_HOPS || "1").trim();
  if (!/^\d+$/.test(raw)) throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10");

  const hops = Number(raw);
  if (hops < 0 || hops > 10) throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10");
  return hops;
}

function getJwtSecret(tp: "access" | "refresh"): string {
  if (tp === "access") {
    if (!envSnapshot.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET is not defined in environment variables");
    return envSnapshot.JWT_ACCESS_SECRET;
  } else if (tp === "refresh") {
    if (!envSnapshot.JWT_REFRESH_SECRET) throw new Error("JWT_REFRESH_SECRET is not defined in environment variables");
    return envSnapshot.JWT_REFRESH_SECRET;
  } else throw new Error("Invalid token type specified");
}

function getJwtExpiresIn(tp: "access" | "refresh"): string {
  if (tp === "access")
    return envSnapshot.JWT_ACCESS_EXPIRES_IN || "5"; // 默认5秒
  else if (tp === "refresh")
    return envSnapshot.JWT_REFRESH_EXPIRES_IN || "60"; // 默认60秒
  else throw new Error("Invalid token type specified");
}

function getHiddenDatabase(): string {
  const url = envSnapshot.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not defined in environment variables");
  const hiddenUrl = url.replace(/(\/\/.*:).*@/, "$1****@");

  return hiddenUrl;
}

function getDatabaseParams(): string {
  const url = envSnapshot.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not defined in environment variables");

  // Extract only query parameters (after ?)
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return "—"; // No query params

  return url.slice(queryIndex + 1);
}

function getDatabaseUrl(): string {
  const url = envSnapshot.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not defined in environment variables");
  return url;
}

function corsAllowedOrigins(): string {
  return String(envSnapshot.CORS_ALLOWED_ORIGINS || "");
}

function getProtectedGroupName(): string | undefined {
  return envSnapshot.PROTECTED_GROUP_NAME;
}

function getSuperAdminGroupUsername(): string {
  return String(envSnapshot.SUPER_ADMIN_GROUP_USERNAME || "admin").trim() || "admin";
}

function rateLimitConfig() {
  return {
    login: {
      perIp: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_LOGIN_IP_MAX || "10"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_LOGIN_IP_WINDOW || "1"),
      },
      perUser: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_LOGIN_USER_MAX || "5"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_LOGIN_USER_WINDOW || "1"),
      },
    },
    emailVerification: {
      perIp: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_IP_MAX || "5"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_IP_WINDOW || "60"),
      },
      perIpEmail: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_IP_EMAIL_MAX || "2"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_IP_EMAIL_WINDOW || "60"),
      },
    },
    twoFactorVerification: {
      perIp: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_2FA_IP_MAX || "20"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_2FA_IP_WINDOW || "10"),
      },
      perChallenge: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_2FA_CHALLENGE_MAX || "5"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_2FA_CHALLENGE_WINDOW || "10"),
      },
    },
    twoFactorEmailSend: {
      perIp: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_2FA_EMAIL_SEND_IP_MAX || "10"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_2FA_EMAIL_SEND_IP_WINDOW || "10"),
      },
      perChallenge: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_MAX || "3"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_WINDOW || "10"),
      },
    },
    twoFactorTrustedDevice: {
      perIp: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_MAX || "60"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_WINDOW || "10"),
      },
      perUser: {
        maxRequests: parseInt(envSnapshot.RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_MAX || "30"),
        windowMinutes: parseInt(envSnapshot.RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_WINDOW || "10"),
      },
    },
    cleanupRetentionDays: parseInt(envSnapshot.RATE_LIMIT_RETENTION_DAYS || "7"),
  };
}

function redisConfig() {
  return {
    host: envSnapshot.REDIS_HOST,
    port: parseInt(envSnapshot.REDIS_PORT || "6379", 10),
    password: envSnapshot.REDIS_PASSWORD,
    db: parseInt(envSnapshot.REDIS_DB || "0", 10),
    circuitBreakerFailureThreshold: sanitizeInt(envSnapshot.REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 5, 1, 100),
    circuitBreakerOpenMs: sanitizeInt(envSnapshot.REDIS_CIRCUIT_BREAKER_OPEN_MS, 30000, 1000, 3600000),
  };
}

function anthropicConfig() {
  return {
    apiKey: String(envSnapshot.ANTHROPIC_API_KEY || "").trim(),
    baseUrl: String(envSnapshot.ANTHROPIC_BASE_URL || "https://api.anthropic.com")
      .trim()
      .replace(/\/+$/, ""),
  };
}

function developerProductConfig() {
  return {
    secretsMasterKey: String(envSnapshot.DEVELOPER_SECRETS_MASTER_KEY || "").trim(),
    ipGeolocationEndpoint: String(envSnapshot.IP_GEOLOCATION_ENDPOINT || "").trim(),
  };
}

function relayChannelProbeConfig() {
  return {
    masterKey: String(envSnapshot.RELAY_CHANNEL_PROBE_MASTER_KEY || "").trim(),
  };
}

function remoteTerminalConfig() {
  return {
    installTokenSecret: String(envSnapshot.RTM_INSTALL_TOKEN_SECRET || "").trim(),
  };
}

function monthlyPassConfig() {
  return {
    defaultPageSize: sanitizeInt(envSnapshot.MONTHLY_PASS_DEFAULT_PAGE_SIZE, 20, 1, 1000),
    defaultQuotaWindowHours: sanitizeInt(envSnapshot.MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS, 24, 1, 8760),
    maxQuotaWindowHours: sanitizeInt(envSnapshot.MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS, 720, 1, 8760),
    maxAmountQuota: Number(envSnapshot.MONTHLY_PASS_MAX_AMOUNT_QUOTA || "999999.9999"),
    maxIntegerQuota: sanitizeInt(envSnapshot.MONTHLY_PASS_MAX_INTEGER_QUOTA, 999999, 1, 2147483647),
  };
}

function webAuthnConfig() {
  return {
    rpName: envSnapshot.WEBAUTHN_RP_NAME || "AppServer",
    rpId: envSnapshot.WEBAUTHN_RP_ID || "localhost",
    origin: envSnapshot.WEBAUTHN_ORIGIN || `https://${envSnapshot.WEBAUTHN_RP_ID || "localhost"}`,
  };
}

function recaptchaConfig() {
  return {
    enabled: envSnapshot.RECAPTCHA_ENABLED === "true",
    secretKey: envSnapshot.RECAPTCHA_SECRET_KEY || "",
    minScore: parseFloat(envSnapshot.RECAPTCHA_MIN_SCORE || "0.5"),
  };
}

function turnstileConfig() {
  return {
    siteKey: envSnapshot.TURNSTILE_SITE_KEY || "",
    secretKey: envSnapshot.TURNSTILE_SECRET_KEY || "",
  };
}

function baiduMapConfig() {
  return {
    ipLocationAk: String(envSnapshot.BAIDU_IP_LOCATION_AK || "").trim(),
  };
}

function captchaTrustConfig() {
  const sameSiteRaw = String(envSnapshot.CAPTCHA_TRUST_COOKIE_SAMESITE || "lax")
    .trim()
    .toLowerCase();

  return {
    windowMinutes: sanitizeInt(envSnapshot.CAPTCHA_TRUST_WINDOW_MINUTES, 30, 0, 1440),
    cookieName: String(envSnapshot.CAPTCHA_TRUST_COOKIE_NAME || "captcha_trust").trim() || "captcha_trust",
    cookieSameSite: (sameSiteRaw === "strict" || sameSiteRaw === "none" ? sameSiteRaw : "lax") as
      | "strict"
      | "lax"
      | "none",
    cookieDomain: String(envSnapshot.CAPTCHA_TRUST_COOKIE_DOMAIN || "").trim() || undefined,
    secret: String(envSnapshot.CAPTCHA_TRUST_COOKIE_SECRET || envSnapshot.REPLAY_SIGNING_MASTER_SECRET || "").trim(),
  };
}

function logConfig() {
  return {
    disableConsoleLog: envSnapshot.DISABLE_CONSOLE_LOG === "true",
    enableFileLogging: envSnapshot.ENABLE_FILE_LOGGING === "true",
  };
}

function sanitizeInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function twoFactorConfig() {
  return {
    trustWindowMinutes: sanitizeInt(envSnapshot.TWO_FACTOR_TRUST_WINDOW_MINUTES, 1440, 0, 525600),
    totpIntervalSeconds: sanitizeInt(envSnapshot.TWO_FACTOR_TOTP_INTERVAL_SECONDS, 30, 15, 300),
    totpWindowSteps: sanitizeInt(envSnapshot.TWO_FACTOR_TOTP_WINDOW_STEPS, 1, 0, 10),
    recoveryCodeCount: sanitizeInt(envSnapshot.TWO_FACTOR_RECOVERY_CODE_COUNT, 10, 1, 50),
    reminderEnabled: envSnapshot.TWO_FACTOR_REMINDER_ENABLED !== "false",
    reminderIntervalDays: sanitizeInt(envSnapshot.TWO_FACTOR_REMINDER_INTERVAL_DAYS, 7, 1, 365),
  };
}

function twoFactorTrustWindowMinutes(): number {
  return twoFactorConfig().trustWindowMinutes;
}

function twoFactorTrustedDeviceCookieSameSite(): "strict" | "lax" | "none" {
  const raw = String(envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_COOKIE_SAMESITE || "strict")
    .trim()
    .toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

function twoFactorTrustedDeviceCookieDomain(): string | undefined {
  const raw = String(envSnapshot.TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN || "").trim();
  return raw || undefined;
}

function authRefreshCookieName(): string {
  const raw = String(envSnapshot.AUTH_REFRESH_COOKIE_NAME || "").trim();
  return raw || "refresh_token";
}

function authRefreshCookieSameSite(): "strict" | "lax" | "none" {
  const raw = String(envSnapshot.AUTH_REFRESH_COOKIE_SAMESITE || "strict")
    .trim()
    .toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

function authRefreshCookieDomain(): string | undefined {
  const raw = String(envSnapshot.AUTH_REFRESH_COOKIE_DOMAIN || "").trim();
  return raw || undefined;
}

function authSessionCookieName(): string {
  const raw = String(envSnapshot.AUTH_SESSION_COOKIE_NAME || "").trim();
  return raw || "auth_session_id";
}

function authSessionCookieSameSite(): "strict" | "lax" | "none" {
  const raw = String(envSnapshot.AUTH_SESSION_COOKIE_SAMESITE || "strict")
    .trim()
    .toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

function authSessionCookieDomain(): string | undefined {
  const raw = String(envSnapshot.AUTH_SESSION_COOKIE_DOMAIN || "").trim();
  return raw || undefined;
}

function authSessionForceOfflineTtlDays(): number {
  return sanitizeInt(envSnapshot.AUTH_SESSION_FORCE_OFFLINE_TTL_DAYS, 30, 1, 3650);
}

function distributedLockConfig() {
  return {
    acquireTimeoutMs: sanitizeInt(envSnapshot.DISTRIBUTED_LOCK_ACQUIRE_TIMEOUT_MS, 5000, 100, 60000),
    retryIntervalMs: sanitizeInt(envSnapshot.DISTRIBUTED_LOCK_RETRY_INTERVAL_MS, 100, 10, 2000),
    defaultTtlMs: sanitizeInt(envSnapshot.DISTRIBUTED_LOCK_DEFAULT_TTL_MS, 10000, 500, 120000),
    failClosed: envSnapshot.DISTRIBUTED_LOCK_FAIL_CLOSED !== "false",
  };
}

function relayResourceGuardConfig() {
  return {
    multipartBodyLimitMb: sanitizeInt(envSnapshot.RELAY_MULTIPART_BODY_LIMIT_MB, 4, 1, 20),
    imageMaxConcurrency: sanitizeInt(envSnapshot.RELAY_IMAGE_MAX_CONCURRENCY, 1, 1, 10),
    imageQueueTimeoutMs: sanitizeInt(envSnapshot.RELAY_IMAGE_QUEUE_TIMEOUT_MS, 300000, 0, 300000),
    nonStreamUpstreamTimeoutMs: sanitizeInt(envSnapshot.RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS, 600000, 10000, 600000),
    maxUpstreamResponseBodyMb: sanitizeInt(envSnapshot.RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB, 64, 1, 128),
    // 图片请求响应体单独限制，防止大图片（base64）击穿内存
    imageResponseBodyLimitMb: sanitizeInt(envSnapshot.RELAY_IMAGE_RESPONSE_BODY_LIMIT_MB, 16, 1, 64),
  };
}

function requestSizeLimitConfig() {
  return {
    jsonBodyLimitMb: sanitizeInt(envSnapshot.REQUEST_JSON_BODY_LIMIT_MB, 5, 1, 100),
    urlencodedBodyLimitMb: sanitizeInt(envSnapshot.REQUEST_URLENCODED_BODY_LIMIT_MB, 2, 1, 100),
    otherBodyLimitMb: sanitizeInt(envSnapshot.REQUEST_OTHER_BODY_LIMIT_MB, 10, 1, 100),
  };
}

function replayProtectionConfig() {
  return {
    masterSecret: String(envSnapshot.REPLAY_SIGNING_MASTER_SECRET || "").trim(),
    signingSessionTtlSeconds: sanitizeInt(envSnapshot.REPLAY_SIGNING_SESSION_TTL_SECONDS, 600, 60, 3600),
  };
}

function socialAuthConfig() {
  const frontendBaseUrl = String(envSnapshot.FRONTEND_BASE_URL || "").trim();

  return {
    frontendBaseUrl,
    github: {
      enabled: envSnapshot.GITHUB_OAUTH_ENABLED === "true",
      clientId: String(envSnapshot.GITHUB_OAUTH_CLIENT_ID || "").trim(),
      clientSecret: String(envSnapshot.GITHUB_OAUTH_CLIENT_SECRET || "").trim(),
      authorizeUrl: String(envSnapshot.GITHUB_OAUTH_AUTHORIZE_URL || "https://github.com/login/oauth/authorize").trim(),
      tokenUrl: String(envSnapshot.GITHUB_OAUTH_TOKEN_URL || "https://github.com/login/oauth/access_token").trim(),
      userUrl: String(envSnapshot.GITHUB_OAUTH_USER_URL || "https://api.github.com/user").trim(),
      emailUrl: String(envSnapshot.GITHUB_OAUTH_EMAIL_URL || "https://api.github.com/user/emails").trim(),
      scope: String(envSnapshot.GITHUB_OAUTH_SCOPE || "read:user user:email").trim(),
      callbackPath: String(envSnapshot.GITHUB_OAUTH_CALLBACK_PATH || "/v1/auth/external/github/callback").trim(),
    },
    wechatOpen: {
      enabled: envSnapshot.WECHAT_OPEN_OAUTH_ENABLED === "true",
      appId: String(envSnapshot.WECHAT_OPEN_APP_ID || "").trim(),
      appSecret: String(envSnapshot.WECHAT_OPEN_APP_SECRET || "").trim(),
      authorizeUrl: String(
        envSnapshot.WECHAT_OPEN_AUTHORIZE_URL || "https://open.weixin.qq.com/connect/qrconnect",
      ).trim(),
      tokenUrl: String(envSnapshot.WECHAT_OPEN_TOKEN_URL || "https://api.weixin.qq.com/sns/oauth2/access_token").trim(),
      userUrl: String(envSnapshot.WECHAT_OPEN_USER_URL || "https://api.weixin.qq.com/sns/userinfo").trim(),
      scope: String(envSnapshot.WECHAT_OPEN_SCOPE || "snsapi_login").trim(),
      callbackPath: String(envSnapshot.WECHAT_OPEN_CALLBACK_PATH || "/v1/auth/external/wechat-open/callback").trim(),
    },
    wechatWeb: {
      enabled: envSnapshot.WECHAT_WEB_OAUTH_ENABLED === "true",
      appId: String(envSnapshot.WECHAT_WEB_APP_ID || "").trim(),
      appSecret: String(envSnapshot.WECHAT_WEB_APP_SECRET || "").trim(),
      authorizeUrl: String(
        envSnapshot.WECHAT_WEB_AUTHORIZE_URL || "https://open.weixin.qq.com/connect/oauth2/authorize",
      ).trim(),
      tokenUrl: String(envSnapshot.WECHAT_WEB_TOKEN_URL || "https://api.weixin.qq.com/sns/oauth2/access_token").trim(),
      userUrl: String(envSnapshot.WECHAT_WEB_USER_URL || "https://api.weixin.qq.com/sns/userinfo").trim(),
      scope: String(envSnapshot.WECHAT_WEB_SCOPE || "snsapi_userinfo").trim(),
      callbackPath: String(envSnapshot.WECHAT_WEB_CALLBACK_PATH || "/v1/auth/external/wechat-web/callback").trim(),
    },
    stateTtlSeconds: sanitizeInt(envSnapshot.EXTERNAL_AUTH_STATE_TTL_SECONDS, 600, 60, 3600),
    qrLoginTtlSeconds: sanitizeInt(envSnapshot.QR_LOGIN_TTL_SECONDS, 300, 60, 1800),
    qrLoginPollIntervalSeconds: sanitizeInt(envSnapshot.QR_LOGIN_POLL_INTERVAL_SECONDS, 2, 1, 30),
  };
}

function cwd(): string {
  return process.cwd();
}

function environmentDiagnostics() {
  const secretKeys = [
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "REPLAY_SIGNING_MASTER_SECRET",
    "TWO_FACTOR_TRUSTED_DEVICE_SECRET",
    "DEVELOPER_SECRETS_MASTER_KEY",
    "RELAY_CHANNEL_PROBE_MASTER_KEY",
    "REDIS_PASSWORD",
    "ANTHROPIC_API_KEY",
  ] as const;

  return Object.freeze({
    nodeEnv: nodeEnv(),
    databaseUrl: getHiddenDatabase(),
    secrets: Object.freeze(Object.fromEntries(secretKeys.map((key) => [key, secretSummary(envSnapshot[key])]))),
  });
}

const resolvedEnvSpace = {
  isProduction: noUndefined(isProduction),
  isDevelopment: noUndefined(isDevelopment),
  isTest: noUndefined(isTest),
  nodeEnv: noUndefined(nodeEnv),
  port: noUndefined(getPort),
  trustProxyHops: noUndefined(trustProxyHops),
  accessTokenSecret: noUndefined(() => getJwtSecret("access")),
  refreshTokenSecret: noUndefined(() => getJwtSecret("refresh")),
  trustedDeviceSecret: noUndefined(trustedDeviceSecret),
  accessTokenExpiresIn: noUndefined(() => getJwtExpiresIn("access")),
  refreshTokenExpiresIn: noUndefined(() => getJwtExpiresIn("refresh")),
  hiddenDatabase: noUndefined(getHiddenDatabase),
  databaseUrl: noUndefined(getDatabaseUrl),
  databaseParams: noUndefined(getDatabaseParams),
  corsAllowedOrigins: noUndefined(corsAllowedOrigins),
  protectedGroupName: noUndefined(getProtectedGroupName),
  superAdminGroupUsername: noUndefined(getSuperAdminGroupUsername),
  rateLimitConfig: noUndefined(rateLimitConfig),
  redisConfig: noUndefined(redisConfig),
  anthropicConfig: noUndefined(anthropicConfig),
  developerProductConfig: noUndefined(developerProductConfig),
  relayChannelProbeConfig: noUndefined(relayChannelProbeConfig),
  remoteTerminalConfig: noUndefined(remoteTerminalConfig),
  monthlyPassConfig: noUndefined(monthlyPassConfig),
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
  socialAuthConfig: noUndefined(socialAuthConfig),
  authCenterConfig: noUndefined(authCenterConfig),
  environmentDiagnostics: noUndefined(environmentDiagnostics),
  cwd: noUndefined(cwd),
};

// Production configuration is immutable after startup. Tests deliberately keep
// the resolved surface mutable so they can inject isolated values without
// reintroducing direct process.env reads into runtime modules.
export const EnvSpace = isTest() ? resolvedEnvSpace : Object.freeze(resolvedEnvSpace);

// All EnvSpace values are eagerly resolved above. Replace the raw snapshot so
// the module no longer retains a general-purpose environment dictionary.
envSnapshot = Object.freeze({});
