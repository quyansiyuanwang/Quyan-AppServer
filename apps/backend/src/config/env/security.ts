import { normalizeCookieSameSite, sanitizeInt } from "./common";
import type { EnvSnapshot } from "./source";

export function parseIamAuthorizationMode(value: string | undefined): "legacy" | "shadow" | "enforce" {
  const mode = value ?? "legacy";
  if (mode !== "legacy" && mode !== "shadow" && mode !== "enforce") throw new Error("Invalid IAM_AUTHORIZATION_MODE");
  return mode;
}

export function buildSecurityConfig(source: EnvSnapshot) {
  const captchaTrustSameSite = normalizeCookieSameSite(source.CAPTCHA_TRUST_COOKIE_SAMESITE, "lax");

  return {
    iamAuthorizationMode: parseIamAuthorizationMode(source.IAM_AUTHORIZATION_MODE),
    protectedGroupName: source.PROTECTED_GROUP_NAME,
    superAdminGroupUsername: String(source.SUPER_ADMIN_GROUP_USERNAME || "admin").trim() || "admin",
    replayProtection: {
      masterSecret: String(source.REPLAY_SIGNING_MASTER_SECRET || "").trim(),
      signingSessionTtlSeconds: sanitizeInt(source.REPLAY_SIGNING_SESSION_TTL_SECONDS, 600, 60, 3600),
    },
    supportAiConfig: {
      masterSecret: String(source.SUPPORT_AI_CONFIG_MASTER_SECRET || "").trim(),
    },
    captchaTrust: {
      windowMinutes: sanitizeInt(source.CAPTCHA_TRUST_WINDOW_MINUTES, 30, 0, 1440),
      cookieName: String(source.CAPTCHA_TRUST_COOKIE_NAME || "captcha_trust").trim() || "captcha_trust",
      cookieSameSite: captchaTrustSameSite,
      cookieDomain: String(source.CAPTCHA_TRUST_COOKIE_DOMAIN || "").trim() || undefined,
      secret: String(source.CAPTCHA_TRUST_COOKIE_SECRET || source.REPLAY_SIGNING_MASTER_SECRET || "").trim(),
    },
  };
}
