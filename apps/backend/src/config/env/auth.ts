import { createHash, generateKeyPairSync } from "crypto";
import { normalizeCookieSameSite, sanitizeInt } from "./common";
import type { EnvSnapshot } from "./source";

let generatedKeyPair: { privateKey: string; publicKey: string } | null = null;

function normalizePem(value: string | undefined): string | undefined {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/\\n/g, "\n") : undefined;
}

function getGeneratedKeyPair(isProduction: boolean, isTest: boolean): { privateKey: string; publicKey: string } {
  if (!generatedKeyPair) {
    generatedKeyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    if (!isTest && !isProduction)
      console.warn(
        "[AuthCenter] AUTH_CENTER_JWT_PRIVATE_KEY/AUTH_CENTER_JWT_PUBLIC_KEY not set, using ephemeral dev key pair",
      );
  }
  return generatedKeyPair;
}

function buildAuthCenterConfig(source: EnvSnapshot, runtime: { isProduction: boolean; isTest: boolean; port: number }) {
  const publicKey = normalizePem(source.AUTH_CENTER_JWT_PUBLIC_KEY);
  const privateKey = normalizePem(source.AUTH_CENTER_JWT_PRIVATE_KEY);
  if (runtime.isProduction && !publicKey)
    throw new Error("AUTH_CENTER_JWT_PUBLIC_KEY is not defined in production environment");
  if (runtime.isProduction && !privateKey)
    throw new Error("AUTH_CENTER_JWT_PRIVATE_KEY is not defined in production environment");
  const generated = publicKey && privateKey ? undefined : getGeneratedKeyPair(runtime.isProduction, runtime.isTest);
  const resolvedPublicKey = publicKey || generated!.publicKey;

  return {
    issuer: String(source.AUTH_CENTER_ISSUER || `http://localhost:${runtime.port}/auth-center`).trim(),
    algorithm: "RS256" as const,
    privateKey: privateKey || generated!.privateKey,
    publicKey: resolvedPublicKey,
    keyId: String(
      source.AUTH_CENTER_JWT_KID || createHash("sha256").update(resolvedPublicKey).digest("hex").slice(0, 16),
    ).trim(),
    jwksPath: "/auth-center/.well-known/jwks.json",
    discoveryPath: "/auth-center/.well-known/openid-configuration",
  };
}

function buildSocialConfig(source: EnvSnapshot) {
  return {
    frontendBaseUrl: String(source.FRONTEND_BASE_URL || "").trim(),
    github: {
      enabled: source.GITHUB_OAUTH_ENABLED === "true",
      clientId: String(source.GITHUB_OAUTH_CLIENT_ID || "").trim(),
      clientSecret: String(source.GITHUB_OAUTH_CLIENT_SECRET || "").trim(),
      authorizeUrl: String(source.GITHUB_OAUTH_AUTHORIZE_URL || "https://github.com/login/oauth/authorize").trim(),
      tokenUrl: String(source.GITHUB_OAUTH_TOKEN_URL || "https://github.com/login/oauth/access_token").trim(),
      userUrl: String(source.GITHUB_OAUTH_USER_URL || "https://api.github.com/user").trim(),
      emailUrl: String(source.GITHUB_OAUTH_EMAIL_URL || "https://api.github.com/user/emails").trim(),
      scope: String(source.GITHUB_OAUTH_SCOPE || "read:user user:email").trim(),
      callbackPath: String(source.GITHUB_OAUTH_CALLBACK_PATH || "/v1/auth/external/github/callback").trim(),
    },
    wechatOpen: {
      enabled: source.WECHAT_OPEN_OAUTH_ENABLED === "true",
      appId: String(source.WECHAT_OPEN_APP_ID || "").trim(),
      appSecret: String(source.WECHAT_OPEN_APP_SECRET || "").trim(),
      authorizeUrl: String(source.WECHAT_OPEN_AUTHORIZE_URL || "https://open.weixin.qq.com/connect/qrconnect").trim(),
      tokenUrl: String(source.WECHAT_OPEN_TOKEN_URL || "https://api.weixin.qq.com/sns/oauth2/access_token").trim(),
      userUrl: String(source.WECHAT_OPEN_USER_URL || "https://api.weixin.qq.com/sns/userinfo").trim(),
      scope: String(source.WECHAT_OPEN_SCOPE || "snsapi_login").trim(),
      callbackPath: String(source.WECHAT_OPEN_CALLBACK_PATH || "/v1/auth/external/wechat-open/callback").trim(),
    },
    wechatWeb: {
      enabled: source.WECHAT_WEB_OAUTH_ENABLED === "true",
      appId: String(source.WECHAT_WEB_APP_ID || "").trim(),
      appSecret: String(source.WECHAT_WEB_APP_SECRET || "").trim(),
      authorizeUrl: String(
        source.WECHAT_WEB_OAUTH_AUTHORIZE_URL || "https://open.weixin.qq.com/connect/oauth2/authorize",
      ).trim(),
      tokenUrl: String(source.WECHAT_WEB_TOKEN_URL || "https://api.weixin.qq.com/sns/oauth2/access_token").trim(),
      userUrl: String(source.WECHAT_WEB_USER_URL || "https://api.weixin.qq.com/sns/userinfo").trim(),
      scope: String(source.WECHAT_WEB_SCOPE || "snsapi_userinfo").trim(),
      callbackPath: String(source.WECHAT_WEB_CALLBACK_PATH || "/v1/auth/external/wechat-web/callback").trim(),
    },
    stateTtlSeconds: sanitizeInt(source.EXTERNAL_AUTH_STATE_TTL_SECONDS, 600, 60, 3600),
    qrLoginTtlSeconds: sanitizeInt(source.QR_LOGIN_TTL_SECONDS, 300, 60, 1800),
    qrLoginPollIntervalSeconds: sanitizeInt(source.QR_LOGIN_POLL_INTERVAL_SECONDS, 2, 1, 30),
  };
}

function parseCentralLoginAllowedOrigins(source: EnvSnapshot, isProduction: boolean): string[] {
  const configuredOrigins = String(source.CENTRAL_LOGIN_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) return configuredOrigins;
  if (isProduction) throw new Error("CENTRAL_LOGIN_ALLOWED_ORIGINS must list exact origins in production");

  return [
    "https://www.qysyw.test:5173",
    "https://auth.qysyw.test:5173",
    "https://account.qysyw.test:5173",
    "https://chat.qysyw.test:5173",
    "https://developer.qysyw.test:5173",
    "https://terminal.qysyw.test:5173",
    "https://console.qysyw.test:5173",
    "https://ai.console.qysyw.test:5173",
    "https://developer.console.qysyw.test:5173",
    "https://terminal.console.qysyw.test:5173",
  ];
}

export function buildAuthConfig(
  source: EnvSnapshot,
  runtime: { isProduction: boolean; isTest: boolean; port: number },
) {
  const accessTokenSecret = source.JWT_ACCESS_SECRET;
  const refreshTokenSecret = source.JWT_REFRESH_SECRET;
  if (!accessTokenSecret) throw new Error("JWT_ACCESS_SECRET is not defined in environment variables");
  if (!refreshTokenSecret) throw new Error("JWT_REFRESH_SECRET is not defined in environment variables");
  const trustedDeviceSameSite = normalizeCookieSameSite(source.TWO_FACTOR_TRUSTED_DEVICE_COOKIE_SAMESITE, "strict");
  const refreshSameSite = normalizeCookieSameSite(source.AUTH_REFRESH_COOKIE_SAMESITE, "strict");
  const sessionSameSite = normalizeCookieSameSite(source.AUTH_SESSION_COOKIE_SAMESITE, "strict");
  const localCookieDomain = !runtime.isProduction && !runtime.isTest ? ".qysyw.test" : undefined;
  const twoFactor = {
    trustWindowMinutes: sanitizeInt(source.TWO_FACTOR_TRUST_WINDOW_MINUTES, 1440, 0, 525600),
    totpIntervalSeconds: sanitizeInt(source.TWO_FACTOR_TOTP_INTERVAL_SECONDS, 30, 15, 300),
    totpWindowSteps: sanitizeInt(source.TWO_FACTOR_TOTP_WINDOW_STEPS, 1, 0, 10),
    recoveryCodeCount: sanitizeInt(source.TWO_FACTOR_RECOVERY_CODE_COUNT, 10, 1, 50),
    reminderEnabled: source.TWO_FACTOR_REMINDER_ENABLED !== "false",
    reminderIntervalDays: sanitizeInt(source.TWO_FACTOR_REMINDER_INTERVAL_DAYS, 7, 1, 365),
  };
  return {
    accessTokenSecret,
    refreshTokenSecret,
    accessTokenExpiresIn: source.JWT_ACCESS_EXPIRES_IN || "5",
    refreshTokenExpiresIn: source.JWT_REFRESH_EXPIRES_IN || "60",
    trustedDeviceSecret: String(source.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim(),
    twoFactor,
    twoFactorTrustWindowMinutes: twoFactor.trustWindowMinutes,
    trustedDeviceCookie: {
      sameSite: trustedDeviceSameSite,
      domain: String(source.TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN || "").trim() || undefined,
    },
    refreshCookie: {
      name: String(source.AUTH_REFRESH_COOKIE_NAME || "").trim() || "refresh_token",
      sameSite: refreshSameSite,
      domain: String(source.AUTH_REFRESH_COOKIE_DOMAIN || "").trim() || localCookieDomain,
    },
    sessionCookie: {
      name: String(source.AUTH_SESSION_COOKIE_NAME || "").trim() || "auth_session_id",
      sameSite: sessionSameSite,
      domain: String(source.AUTH_SESSION_COOKIE_DOMAIN || "").trim() || localCookieDomain,
      forceOfflineTtlDays: sanitizeInt(source.AUTH_SESSION_FORCE_OFFLINE_TTL_DAYS, 30, 1, 3650),
    },
    webAuthn: {
      rpName: source.WEBAUTHN_RP_NAME || "AppServer",
      rpId: source.WEBAUTHN_RP_ID || "localhost",
      origin: source.WEBAUTHN_ORIGIN || `https://${source.WEBAUTHN_RP_ID || "localhost"}`,
    },
    centralLogin: {
      allowedOrigins: parseCentralLoginAllowedOrigins(source, runtime.isProduction),
      flowTtlSeconds: sanitizeInt(source.CENTRAL_LOGIN_FLOW_TTL_SECONDS, 600, 60, 1800),
    },
    recaptcha: {
      enabled: source.RECAPTCHA_ENABLED === "true",
      secretKey: source.RECAPTCHA_SECRET_KEY || "",
      minScore: Number.parseFloat(source.RECAPTCHA_MIN_SCORE || "0.5"),
    },
    turnstile: { siteKey: source.TURNSTILE_SITE_KEY || "", secretKey: source.TURNSTILE_SECRET_KEY || "" },
    social: buildSocialConfig(source),
    authCenter: buildAuthCenterConfig(source, runtime),
  };
}
