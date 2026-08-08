import { sanitizeInt } from "./common";
import type { EnvSnapshot } from "./source";

export function buildRedisConfig(source: EnvSnapshot) {
  return {
    host: source.REDIS_HOST,
    port: Number.parseInt(source.REDIS_PORT || "6379", 10),
    password: source.REDIS_PASSWORD,
    db: Number.parseInt(source.REDIS_DB || "0", 10),
    circuitBreakerFailureThreshold: sanitizeInt(source.REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 5, 1, 100),
    circuitBreakerOpenMs: sanitizeInt(source.REDIS_CIRCUIT_BREAKER_OPEN_MS, 30000, 1000, 3600000),
  };
}

export function buildRateLimitConfig(source: EnvSnapshot) {
  const integer = (key: string, fallback: string) => Number.parseInt(source[key] || fallback, 10);
  return {
    login: {
      perIp: {
        maxRequests: integer("RATE_LIMIT_LOGIN_IP_MAX", "10"),
        windowMinutes: integer("RATE_LIMIT_LOGIN_IP_WINDOW", "1"),
      },
      perUser: {
        maxRequests: integer("RATE_LIMIT_LOGIN_USER_MAX", "5"),
        windowMinutes: integer("RATE_LIMIT_LOGIN_USER_WINDOW", "1"),
      },
    },
    emailVerification: {
      perIp: { maxRequests: integer("RATE_LIMIT_IP_MAX", "5"), windowMinutes: integer("RATE_LIMIT_IP_WINDOW", "60") },
      perIpEmail: {
        maxRequests: integer("RATE_LIMIT_IP_EMAIL_MAX", "2"),
        windowMinutes: integer("RATE_LIMIT_IP_EMAIL_WINDOW", "60"),
      },
    },
    twoFactorVerification: {
      perIp: {
        maxRequests: integer("RATE_LIMIT_2FA_IP_MAX", "20"),
        windowMinutes: integer("RATE_LIMIT_2FA_IP_WINDOW", "10"),
      },
      perChallenge: {
        maxRequests: integer("RATE_LIMIT_2FA_CHALLENGE_MAX", "5"),
        windowMinutes: integer("RATE_LIMIT_2FA_CHALLENGE_WINDOW", "10"),
      },
    },
    twoFactorEmailSend: {
      perIp: {
        maxRequests: integer("RATE_LIMIT_2FA_EMAIL_SEND_IP_MAX", "10"),
        windowMinutes: integer("RATE_LIMIT_2FA_EMAIL_SEND_IP_WINDOW", "10"),
      },
      perChallenge: {
        maxRequests: integer("RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_MAX", "3"),
        windowMinutes: integer("RATE_LIMIT_2FA_EMAIL_SEND_CHALLENGE_WINDOW", "10"),
      },
    },
    twoFactorTrustedDevice: {
      perIp: {
        maxRequests: integer("RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_MAX", "60"),
        windowMinutes: integer("RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_WINDOW", "10"),
      },
      perUser: {
        maxRequests: integer("RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_MAX", "30"),
        windowMinutes: integer("RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_WINDOW", "10"),
      },
    },
    cleanupRetentionDays: integer("RATE_LIMIT_RETENTION_DAYS", "7"),
  };
}

export function buildRelayConfig(source: EnvSnapshot) {
  return {
    resourceGuard: {
      multipartBodyLimitMb: sanitizeInt(source.RELAY_MULTIPART_BODY_LIMIT_MB, 4, 1, 20),
      imageMaxConcurrency: sanitizeInt(source.RELAY_IMAGE_MAX_CONCURRENCY, 1, 1, 10),
      imageQueueTimeoutMs: sanitizeInt(source.RELAY_IMAGE_QUEUE_TIMEOUT_MS, 300000, 0, 300000),
      nonStreamUpstreamTimeoutMs: sanitizeInt(source.RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS, 600000, 10000, 600000),
      maxUpstreamResponseBodyMb: sanitizeInt(source.RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB, 64, 1, 128),
      imageResponseBodyLimitMb: sanitizeInt(source.RELAY_IMAGE_RESPONSE_BODY_LIMIT_MB, 16, 1, 64),
    },
    channelProbe: { masterKey: String(source.RELAY_CHANNEL_PROBE_MASTER_KEY || "").trim() },
    channelChangeRequest: { masterKey: String(source.RELAY_CHANNEL_CHANGE_REQUEST_MASTER_KEY || "").trim() },
  };
}

export function buildIntegrationsConfig(source: EnvSnapshot) {
  const archiveOss = {
    endpoint: String(source.ARCHIVE_OSS_ENDPOINT || "").trim(),
    region: String(source.ARCHIVE_OSS_REGION || "").trim(),
    bucket: String(source.ARCHIVE_OSS_BUCKET || "").trim(),
    accessKeyId: String(source.ARCHIVE_OSS_ACCESS_KEY_ID || "").trim(),
    accessKeySecret: String(source.ARCHIVE_OSS_ACCESS_KEY_SECRET || "").trim(),
    prefix: String(source.ARCHIVE_OSS_PREFIX || "appserver-archives")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
  };

  return {
    anthropic: {
      apiKey: String(source.ANTHROPIC_API_KEY || "").trim(),
      baseUrl: String(source.ANTHROPIC_BASE_URL || "https://api.anthropic.com")
        .trim()
        .replace(/\/+$/, ""),
    },
    developerProduct: {
      secretsMasterKey: String(source.DEVELOPER_SECRETS_MASTER_KEY || "").trim(),
      ipGeolocationEndpoint: String(source.IP_GEOLOCATION_ENDPOINT || "").trim(),
    },
    remoteTerminal: { installTokenSecret: String(source.RTM_INSTALL_TOKEN_SECRET || "").trim() },
    monthlyPass: {
      defaultPageSize: sanitizeInt(source.MONTHLY_PASS_DEFAULT_PAGE_SIZE, 20, 1, 1000),
      defaultQuotaWindowHours: sanitizeInt(source.MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS, 24, 1, 8760),
      maxQuotaWindowHours: sanitizeInt(source.MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS, 720, 1, 8760),
      maxAmountQuota: Number(source.MONTHLY_PASS_MAX_AMOUNT_QUOTA || "999999.9999"),
      maxIntegerQuota: sanitizeInt(source.MONTHLY_PASS_MAX_INTEGER_QUOTA, 999999, 1, 2147483647),
    },
    baiduMap: { ipLocationAk: String(source.BAIDU_IP_LOCATION_AK || "").trim() },
    archiveOss: {
      ...archiveOss,
      enabled: Boolean(
        archiveOss.endpoint &&
          archiveOss.region &&
          archiveOss.bucket &&
          archiveOss.accessKeyId &&
          archiveOss.accessKeySecret,
      ),
    },
    distributedLock: {
      acquireTimeoutMs: sanitizeInt(source.DISTRIBUTED_LOCK_ACQUIRE_TIMEOUT_MS, 5000, 100, 60000),
      retryIntervalMs: sanitizeInt(source.DISTRIBUTED_LOCK_RETRY_INTERVAL_MS, 100, 10, 2000),
      defaultTtlMs: sanitizeInt(source.DISTRIBUTED_LOCK_DEFAULT_TTL_MS, 10000, 500, 120000),
      failClosed: source.DISTRIBUTED_LOCK_FAIL_CLOSED !== "false",
    },
  };
}
