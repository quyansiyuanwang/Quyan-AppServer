/**
 * 频率限制配置
 */

import { env } from "./env";

const toSafePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

export interface RateLimitRule {
  maxRequests: number;
  windowMinutes: number;
}

export interface RateLimiterConfig {
  login: {
    perIp: RateLimitRule;
    perUser: RateLimitRule;
  };
  emailVerification: {
    perIp: RateLimitRule;
    perIpEmail: RateLimitRule;
  };
  twoFactorVerification: {
    perIp: RateLimitRule;
    perChallenge: RateLimitRule;
  };
  twoFactorEmailSend: {
    perIp: RateLimitRule;
    perChallenge: RateLimitRule;
  };
  twoFactorTrustedDevice: {
    perIp: RateLimitRule;
    perUser: RateLimitRule;
  };
  cleanupRetentionDays: number;
}

/**
 * 默认配置
 * 可通过环境变量覆盖
 */
export const RATE_LIMITER_CONFIG: RateLimiterConfig = {
  login: {
    perIp: {
      maxRequests: toSafePositiveInt(env.rateLimit.login.perIp.maxRequests, 10),
      windowMinutes: toSafePositiveInt(env.rateLimit.login.perIp.windowMinutes, 1),
    },
    perUser: {
      maxRequests: toSafePositiveInt(env.rateLimit.login.perUser.maxRequests, 5),
      windowMinutes: toSafePositiveInt(env.rateLimit.login.perUser.windowMinutes, 1),
    },
  },
  emailVerification: {
    // 同一 IP 每小时最多 5 次请求（从 10 降低到 5）
    perIp: {
      maxRequests: toSafePositiveInt(env.rateLimit.emailVerification.perIp.maxRequests, 5),
      windowMinutes: toSafePositiveInt(env.rateLimit.emailVerification.perIp.windowMinutes, 60),
    },
    // 同一 IP+邮箱组合每小时最多 2 次请求（从 3 降低到 2）
    perIpEmail: {
      maxRequests: toSafePositiveInt(env.rateLimit.emailVerification.perIpEmail.maxRequests, 2),
      windowMinutes: toSafePositiveInt(env.rateLimit.emailVerification.perIpEmail.windowMinutes, 60),
    },
  },
  twoFactorVerification: {
    // 同一 IP 在验证窗口内最多尝试 20 次
    perIp: {
      maxRequests: toSafePositiveInt(env.rateLimit.twoFactorVerification.perIp.maxRequests, 20),
      windowMinutes: toSafePositiveInt(env.rateLimit.twoFactorVerification.perIp.windowMinutes, 10),
    },
    // 同一 challenge 最多尝试 5 次
    perChallenge: {
      maxRequests: toSafePositiveInt(env.rateLimit.twoFactorVerification.perChallenge.maxRequests, 5),
      windowMinutes: toSafePositiveInt(env.rateLimit.twoFactorVerification.perChallenge.windowMinutes, 10),
    },
  },
  twoFactorEmailSend: {
    // 同一 IP 在发送窗口内最多发送 10 次 2FA 邮箱验证码
    perIp: {
      maxRequests: toSafePositiveInt(env.rateLimit.twoFactorEmailSend.perIp.maxRequests, 10),
      windowMinutes: toSafePositiveInt(env.rateLimit.twoFactorEmailSend.perIp.windowMinutes, 10),
    },
    // 同一 challenge 最多发送 3 次，避免无限重发
    perChallenge: {
      maxRequests: toSafePositiveInt(env.rateLimit.twoFactorEmailSend.perChallenge.maxRequests, 3),
      windowMinutes: toSafePositiveInt(env.rateLimit.twoFactorEmailSend.perChallenge.windowMinutes, 10),
    },
  },
  twoFactorTrustedDevice: {
    // 同一 IP 在窗口内最多发起 60 次 trusted-device 列表/删除操作
    perIp: {
      maxRequests: toSafePositiveInt(env.rateLimit.twoFactorTrustedDevice.perIp.maxRequests, 60),
      windowMinutes: toSafePositiveInt(env.rateLimit.twoFactorTrustedDevice.perIp.windowMinutes, 10),
    },
    // 同一用户在窗口内最多发起 30 次 trusted-device 列表/删除操作
    perUser: {
      maxRequests: toSafePositiveInt(env.rateLimit.twoFactorTrustedDevice.perUser.maxRequests, 30),
      windowMinutes: toSafePositiveInt(env.rateLimit.twoFactorTrustedDevice.perUser.windowMinutes, 10),
    },
  },
  // 保留日志天数（用于定期清理）
  cleanupRetentionDays: toSafePositiveInt(env.rateLimit.cleanupRetentionDays, 7),
};
