import { RATE_LIMITER_CONFIG } from "@/config/rate-limiter";
import type { MessageDescriptor } from "@/locales";
import { getLogger, LogCategory } from "@/util/logger";
import { EmailRateLimitLogRepository } from "@/store/auth/email-rate-limit-log.repository";
import type { EmailRateLimitLogStore } from "@/store/auth/email-rate-limit-log.store";
import { TooManyRequestsError } from "@/util/errors";
import { RedisService } from "./redis.service";

const logger = getLogger("RateLimiterService", LogCategory.BUSINESS);

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfter?: number; // 秒数
}

interface RedisWindowRateLimitRule {
  key: string;
  maxRequests: number;
  windowMinutes: number;
  reason: string;
}

interface CountWindowRateLimitRule {
  currentCount: number;
  maxRequests: number;
  windowMinutes: number;
  reason: string;
}

interface BackoffRateLimitState {
  count: number;
  lastAttempt: number;
  lockoutUntil: number;
}

export type RedisWindowRateLimitPolicyName =
  | "login"
  | "twoFactorVerification"
  | "twoFactorEmailSend"
  | "twoFactorTrustedDevice";

export type CountWindowRateLimitPolicyName = "relayCustomKeyCreate";

export type BackoffRateLimitPolicyName = "twoFactorAttempt" | "relayCustomKeySet";

export type EmailActionRateLimitPolicyName = "emailVerification" | "passwordResetCode";

type RedisWindowRateLimitPolicyContextMap = {
  login: { ipAddress: string; username: string };
  twoFactorVerification: { ipAddress: string; challengeToken: string };
  twoFactorEmailSend: { ipAddress: string; challengeToken: string };
  twoFactorTrustedDevice: { ipAddress: string; userId: string };
};

type CountWindowRateLimitPolicyContextMap = {
  relayCustomKeyCreate: { currentCount: number; maxRequests: number; windowMinutes: number };
};

type BackoffRateLimitPolicyContextMap = {
  twoFactorAttempt: { identifier: string };
  relayCustomKeySet: { userId: string };
};

type EmailActionRateLimitPolicyContextMap = {
  emailVerification: { ipAddress: string; email: string };
  passwordResetCode: { ipAddress: string; email: string };
};

type EmailActionRateLimitPolicy = {
  ipAddress: string;
  email: string;
  action: string;
  perIp: { maxRequests: number; windowMinutes: number };
  perIpEmail: { maxRequests: number; windowMinutes: number };
  ipReason: string;
  ipEmailReason: string;
  ipLogMessage: string;
  ipEmailLogMessage: string;
  createLogErrorMessage: string;
};

export interface RateLimitErrorDescriptor {
  key: MessageDescriptor["key"];
  message: string;
}

interface BackoffRateLimitErrorOptions {
  windowMs: number;
  errorMessage?: string;
  messageKey?: MessageDescriptor["key"];
  messageParams?: MessageDescriptor["params"];
}

export class RateLimiterService {
  private static instance: RateLimiterService;

  private constructor(
    private readonly emailRateLimitLogRepository: EmailRateLimitLogStore = EmailRateLimitLogRepository.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
  ) {}

  static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) RateLimiterService.instance = new RateLimiterService();

    return RateLimiterService.instance;
  }

  async checkRedisWindowRateLimit(
    rules: RedisWindowRateLimitRule[],
    options?: { failOpenWithoutRedis?: boolean; scope?: string },
  ): Promise<RateLimitCheckResult> {
    const failOpenWithoutRedis = options?.failOpenWithoutRedis === true;
    const scope = options?.scope || "checkRedisWindowRateLimit";

    if (failOpenWithoutRedis && this.shouldFailOpenWithoutRedis(scope))
      return {
        allowed: true,
        reason: "RATE_LIMIT_BACKEND_UNAVAILABLE",
      };

    const counts = await Promise.all(rules.map((rule) => this.redisService.get(rule.key)));

    for (const [index, rule] of rules.entries()) {
      const count = Number(counts[index] || "0");
      if (count < rule.maxRequests) continue;

      const retryAfter = await this.getRetryAfterSeconds(rule.key);
      return {
        allowed: false,
        reason: rule.reason,
        retryAfter,
      };
    }

    return { allowed: true };
  }

  async consumeRedisWindowRateLimit(
    rules: Array<Pick<RedisWindowRateLimitRule, "key" | "windowMinutes">>,
  ): Promise<void> {
    await Promise.all(rules.map((rule) => this.redisService.increment(rule.key, rule.windowMinutes * 60)));
  }

  checkCountWindowRateLimit(rule: CountWindowRateLimitRule): RateLimitCheckResult {
    if (rule.currentCount < rule.maxRequests) return { allowed: true };

    return {
      allowed: false,
      reason: rule.reason,
      retryAfter: rule.windowMinutes * 60,
    };
  }

  async assertBackoffRateLimit(key: string, options: BackoffRateLimitErrorOptions): Promise<void> {
    const record = await this.getBackoffRateLimitState(key);
    if (!record) return;

    const now = Date.now();
    if (now - record.lastAttempt > options.windowMs) {
      await this.redisService.delete(key);
      return;
    }

    if (record.lockoutUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((record.lockoutUntil - now) / 1000));
      throw new TooManyRequestsError(options.errorMessage || "请求过于频繁，请稍后再试", retryAfter, undefined, {
        messageKey: options.messageKey,
        messageParams: options.messageParams,
      });
    }
  }

  async markBackoffRateLimitFailure(
    key: string,
    options: { windowMs: number; maxAttempts: number; baseBackoffMs: number },
  ): Promise<void> {
    const now = Date.now();
    const existing = await this.getBackoffRateLimitState(key);
    const stale = !existing || now - existing.lastAttempt > options.windowMs;

    if (stale) {
      await this.redisService.set(
        key,
        JSON.stringify({
          count: 1,
          lastAttempt: now,
          lockoutUntil: 0,
        }),
        Math.ceil(options.windowMs / 1000),
      );
      return;
    }

    const count = existing.count + 1;
    const overLimitCount = Math.max(0, count - options.maxAttempts + 1);
    const backoff =
      overLimitCount <= 0 ? 0 : Math.min(options.baseBackoffMs * 2 ** (overLimitCount - 1), options.windowMs);

    await this.redisService.set(
      key,
      JSON.stringify({
        count,
        lastAttempt: now,
        lockoutUntil: backoff > 0 ? now + backoff : 0,
      }),
      Math.ceil(options.windowMs / 1000),
    );
  }

  async clearBackoffRateLimit(key: string): Promise<void> {
    await this.redisService.delete(key);
  }

  async checkNamedRedisWindowRateLimit<TPolicyName extends RedisWindowRateLimitPolicyName>(
    policyName: TPolicyName,
    context: RedisWindowRateLimitPolicyContextMap[TPolicyName],
  ): Promise<RateLimitCheckResult> {
    const policy = this.getRedisWindowPolicy(policyName, context);
    return this.checkRedisWindowRateLimit(policy.rules, policy.options);
  }

  async consumeNamedRedisWindowRateLimit<TPolicyName extends RedisWindowRateLimitPolicyName>(
    policyName: TPolicyName,
    context: RedisWindowRateLimitPolicyContextMap[TPolicyName],
  ): Promise<void> {
    const policy = this.getRedisWindowPolicy(policyName, context);
    if (policy.options?.failOpenWithoutRedis && this.shouldFailOpenWithoutRedis(`consume:${policyName}`)) return;

    await this.consumeRedisWindowRateLimit(
      policy.rules.map((rule) => ({
        key: rule.key,
        windowMinutes: rule.windowMinutes,
      })),
    );
  }

  checkNamedCountWindowRateLimit<TPolicyName extends CountWindowRateLimitPolicyName>(
    policyName: TPolicyName,
    context: CountWindowRateLimitPolicyContextMap[TPolicyName],
  ): RateLimitCheckResult {
    const rule = this.getCountWindowPolicy(policyName, context);
    return this.checkCountWindowRateLimit(rule);
  }

  async assertNamedBackoffRateLimit<TPolicyName extends BackoffRateLimitPolicyName>(
    policyName: TPolicyName,
    context: BackoffRateLimitPolicyContextMap[TPolicyName],
  ): Promise<void> {
    const policy = this.getBackoffPolicy(policyName, context);
    await this.assertBackoffRateLimit(policy.key, {
      windowMs: policy.windowMs,
      errorMessage: policy.errorMessage,
    });
  }

  async markNamedBackoffRateLimitFailure<TPolicyName extends BackoffRateLimitPolicyName>(
    policyName: TPolicyName,
    context: BackoffRateLimitPolicyContextMap[TPolicyName],
  ): Promise<void> {
    const policy = this.getBackoffPolicy(policyName, context);
    await this.markBackoffRateLimitFailure(policy.key, {
      windowMs: policy.windowMs,
      maxAttempts: policy.maxAttempts,
      baseBackoffMs: policy.baseBackoffMs,
    });
  }

  async clearNamedBackoffRateLimit<TPolicyName extends BackoffRateLimitPolicyName>(
    policyName: TPolicyName,
    context: BackoffRateLimitPolicyContextMap[TPolicyName],
  ): Promise<void> {
    const policy = this.getBackoffPolicy(policyName, context);
    await this.clearBackoffRateLimit(policy.key);
  }

  async checkNamedEmailActionRateLimit<TPolicyName extends EmailActionRateLimitPolicyName>(
    policyName: TPolicyName,
    context: EmailActionRateLimitPolicyContextMap[TPolicyName],
  ): Promise<RateLimitCheckResult> {
    const policy = this.getEmailActionPolicy(policyName, context);

    const ipCount = await this.countRequests(policy.ipAddress, null, policy.action, policy.perIp.windowMinutes);

    if (ipCount >= policy.perIp.maxRequests) {
      const retryAfter = await this.calculateRetryAfter(
        policy.ipAddress,
        null,
        policy.action,
        policy.perIp.windowMinutes,
      );
      logger.warn(`${policy.ipLogMessage}: ${policy.ipAddress}, count: ${ipCount}`);
      return {
        allowed: false,
        reason: policy.ipReason,
        retryAfter,
      };
    }

    const ipEmailCount = await this.countRequests(
      policy.ipAddress,
      policy.email,
      policy.action,
      policy.perIpEmail.windowMinutes,
    );

    if (ipEmailCount >= policy.perIpEmail.maxRequests) {
      const retryAfter = await this.calculateRetryAfter(
        policy.ipAddress,
        policy.email,
        policy.action,
        policy.perIpEmail.windowMinutes,
      );
      logger.warn(`${policy.ipEmailLogMessage}: ${policy.ipAddress} + ${policy.email}, count: ${ipEmailCount}`);
      return {
        allowed: false,
        reason: policy.ipEmailReason,
        retryAfter,
      };
    }

    return { allowed: true };
  }

  async logNamedEmailActionRequest<TPolicyName extends EmailActionRateLimitPolicyName>(
    policyName: TPolicyName,
    context: EmailActionRateLimitPolicyContextMap[TPolicyName],
  ): Promise<void> {
    const policy = this.getEmailActionPolicy(policyName, context);

    try {
      await this.emailRateLimitLogRepository.create(policy.ipAddress, policy.email, policy.action, new Date());
    } catch (error) {
      logger.error(policy.createLogErrorMessage, { error });
    }
  }

  getRateLimitErrorDescriptor(reason?: string): RateLimitErrorDescriptor {
    switch (reason) {
      case "IP_RATE_LIMIT_EXCEEDED":
        return { key: "auth.rateLimit.ip", message: "您的 IP 地址请求过于频繁，请稍后再试" };
      case "IP_EMAIL_RATE_LIMIT_EXCEEDED":
        return { key: "auth.rateLimit.email", message: "该邮箱地址请求过于频繁，请稍后再试" };
      case "TWO_FACTOR_IP_RATE_LIMIT_EXCEEDED":
        return { key: "auth.twoFactorRateLimit.ip", message: "您的验证请求过于频繁，请稍后再试" };
      case "TWO_FACTOR_CHALLENGE_RATE_LIMIT_EXCEEDED":
        return {
          key: "auth.twoFactorRateLimit.challenge",
          message: "当前验证会话尝试次数过多，请重新登录后再试",
        };
      case "TWO_FACTOR_EMAIL_SEND_IP_RATE_LIMIT_EXCEEDED":
        return {
          key: "auth.twoFactorEmailRateLimit.ip",
          message: "您的验证码发送请求过于频繁，请稍后再试",
        };
      case "TWO_FACTOR_EMAIL_SEND_CHALLENGE_RATE_LIMIT_EXCEEDED":
        return {
          key: "auth.twoFactorEmailRateLimit.challenge",
          message: "当前验证会话发送次数过多，请稍后再试",
        };
      case "TWO_FACTOR_TRUSTED_DEVICE_IP_RATE_LIMIT_EXCEEDED":
        return { key: "user.trustedDeviceRateLimitIp", message: "可信设备操作过于频繁，请稍后再试" };
      case "TWO_FACTOR_TRUSTED_DEVICE_USER_RATE_LIMIT_EXCEEDED":
        return {
          key: "user.trustedDeviceRateLimitUser",
          message: "当前账号可信设备操作过于频繁，请稍后再试",
        };
      default:
        return { key: "errors.tooManyRequests", message: "请求过于频繁，请稍后再试" };
    }
  }

  /**
   * 检查邮件验证码发送频率限制
   */
  async checkEmailVerificationRateLimit(ipAddress: string, email: string): Promise<RateLimitCheckResult> {
    return this.checkNamedEmailActionRateLimit("emailVerification", { ipAddress, email });
  }

  /**
   * 记录验证码请求
   */
  async logEmailVerificationRequest(ipAddress: string, email: string): Promise<void> {
    await this.logNamedEmailActionRequest("emailVerification", { ipAddress, email });
  }

  /**
   * 检查找回密码验证码发送频率限制
   */
  async checkPasswordResetCodeRateLimit(ipAddress: string, email: string): Promise<RateLimitCheckResult> {
    return this.checkNamedEmailActionRateLimit("passwordResetCode", { ipAddress, email });
  }

  /**
   * 记录找回密码验证码请求
   */
  async logPasswordResetCodeRequest(ipAddress: string, email: string): Promise<void> {
    await this.logNamedEmailActionRequest("passwordResetCode", { ipAddress, email });
  }

  /**
   * 统计时间窗口内的请求次数
   */
  private async countRequests(
    ipAddress: string,
    email: string | null,
    action: string,
    windowMinutes: number,
  ): Promise<number> {
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    return this.emailRateLimitLogRepository.countRequests(ipAddress, email, action, windowStart);
  }

  /**
   * 计算需要等待的秒数
   */
  private async calculateRetryAfter(
    ipAddress: string,
    email: string | null,
    action: string,
    windowMinutes: number,
  ): Promise<number> {
    const oldestRequest = await this.emailRateLimitLogRepository.findOldestRequest(ipAddress, email, action);

    if (!oldestRequest) return 0;

    const windowMs = windowMinutes * 60 * 1000;
    const oldestTime = oldestRequest.requestTime.getTime();
    const now = Date.now();
    const retryAfterMs = oldestTime + windowMs - now;

    return Math.max(0, Math.ceil(retryAfterMs / 1000));
  }

  /**
   * 清理过期的频率限制日志
   */
  async cleanupOldLogs(): Promise<number> {
    const retentionDays = RATE_LIMITER_CONFIG.cleanupRetentionDays;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const deletedCount = await this.emailRateLimitLogRepository.deleteOlderThan(cutoffDate);

      logger.info(`Cleaned up ${deletedCount} old rate limit logs`);
      return deletedCount;
    } catch (error) {
      logger.error("Failed to cleanup old rate limit logs", { error });
      return 0;
    }
  }

  private getRedisWindowPolicy<TPolicyName extends RedisWindowRateLimitPolicyName>(
    policyName: TPolicyName,
    context: RedisWindowRateLimitPolicyContextMap[TPolicyName],
  ): {
    rules: RedisWindowRateLimitRule[];
    options?: { failOpenWithoutRedis?: boolean; scope?: string };
  } {
    switch (policyName) {
      case "login": {
        const { ipAddress, username } = context as RedisWindowRateLimitPolicyContextMap["login"];
        const config = RATE_LIMITER_CONFIG.login;
        return {
          rules: [
            {
              key: this.getLoginIpKey(ipAddress),
              maxRequests: config.perIp.maxRequests,
              windowMinutes: config.perIp.windowMinutes,
              reason: "LOGIN_IP_RATE_LIMIT_EXCEEDED",
            },
            {
              key: this.getLoginUserKey(username),
              maxRequests: config.perUser.maxRequests,
              windowMinutes: config.perUser.windowMinutes,
              reason: "LOGIN_USER_RATE_LIMIT_EXCEEDED",
            },
          ],
          options: { failOpenWithoutRedis: true, scope: "checkLoginRateLimit" },
        };
      }
      case "twoFactorVerification": {
        const { ipAddress, challengeToken } = context as RedisWindowRateLimitPolicyContextMap["twoFactorVerification"];
        const config = RATE_LIMITER_CONFIG.twoFactorVerification;
        return {
          rules: [
            {
              key: this.getTwoFactorIpKey(ipAddress),
              maxRequests: config.perIp.maxRequests,
              windowMinutes: config.perIp.windowMinutes,
              reason: "TWO_FACTOR_IP_RATE_LIMIT_EXCEEDED",
            },
            {
              key: this.getTwoFactorChallengeKey(challengeToken),
              maxRequests: config.perChallenge.maxRequests,
              windowMinutes: config.perChallenge.windowMinutes,
              reason: "TWO_FACTOR_CHALLENGE_RATE_LIMIT_EXCEEDED",
            },
          ],
          options: { failOpenWithoutRedis: true, scope: "checkTwoFactorVerificationRateLimit" },
        };
      }
      case "twoFactorEmailSend": {
        const { ipAddress, challengeToken } = context as RedisWindowRateLimitPolicyContextMap["twoFactorEmailSend"];
        const config = RATE_LIMITER_CONFIG.twoFactorEmailSend;
        return {
          rules: [
            {
              key: this.getTwoFactorEmailSendIpKey(ipAddress),
              maxRequests: config.perIp.maxRequests,
              windowMinutes: config.perIp.windowMinutes,
              reason: "TWO_FACTOR_EMAIL_SEND_IP_RATE_LIMIT_EXCEEDED",
            },
            {
              key: this.getTwoFactorEmailSendChallengeKey(challengeToken),
              maxRequests: config.perChallenge.maxRequests,
              windowMinutes: config.perChallenge.windowMinutes,
              reason: "TWO_FACTOR_EMAIL_SEND_CHALLENGE_RATE_LIMIT_EXCEEDED",
            },
          ],
          options: { failOpenWithoutRedis: true, scope: "checkTwoFactorEmailSendRateLimit" },
        };
      }
      case "twoFactorTrustedDevice": {
        const { ipAddress, userId } = context as RedisWindowRateLimitPolicyContextMap["twoFactorTrustedDevice"];
        const config = RATE_LIMITER_CONFIG.twoFactorTrustedDevice;
        return {
          rules: [
            {
              key: this.getTwoFactorTrustedDeviceIpKey(ipAddress),
              maxRequests: config.perIp.maxRequests,
              windowMinutes: config.perIp.windowMinutes,
              reason: "TWO_FACTOR_TRUSTED_DEVICE_IP_RATE_LIMIT_EXCEEDED",
            },
            {
              key: this.getTwoFactorTrustedDeviceUserKey(userId),
              maxRequests: config.perUser.maxRequests,
              windowMinutes: config.perUser.windowMinutes,
              reason: "TWO_FACTOR_TRUSTED_DEVICE_USER_RATE_LIMIT_EXCEEDED",
            },
          ],
          options: { failOpenWithoutRedis: true, scope: "checkTwoFactorTrustedDeviceOperationRateLimit" },
        };
      }
    }
  }

  private getEmailActionPolicy<TPolicyName extends EmailActionRateLimitPolicyName>(
    policyName: TPolicyName,
    context: EmailActionRateLimitPolicyContextMap[TPolicyName],
  ): EmailActionRateLimitPolicy {
    const baseConfig = RATE_LIMITER_CONFIG.emailVerification;

    switch (policyName) {
      case "emailVerification": {
        const { ipAddress, email } = context as EmailActionRateLimitPolicyContextMap["emailVerification"];
        return {
          ipAddress,
          email,
          action: "verification_code",
          perIp: baseConfig.perIp,
          perIpEmail: baseConfig.perIpEmail,
          ipReason: "IP_RATE_LIMIT_EXCEEDED",
          ipEmailReason: "IP_EMAIL_RATE_LIMIT_EXCEEDED",
          ipLogMessage: "IP rate limit exceeded",
          ipEmailLogMessage: "IP+Email rate limit exceeded",
          createLogErrorMessage: "Failed to log rate limit request",
        };
      }
      case "passwordResetCode": {
        const { ipAddress, email } = context as EmailActionRateLimitPolicyContextMap["passwordResetCode"];
        return {
          ipAddress,
          email,
          action: "password_reset_code",
          perIp: baseConfig.perIp,
          perIpEmail: baseConfig.perIpEmail,
          ipReason: "IP_RATE_LIMIT_EXCEEDED",
          ipEmailReason: "IP_EMAIL_RATE_LIMIT_EXCEEDED",
          ipLogMessage: "Password reset IP rate limit exceeded",
          ipEmailLogMessage: "Password reset IP+Email rate limit exceeded",
          createLogErrorMessage: "Failed to log password reset rate limit request",
        };
      }
    }
  }

  private getCountWindowPolicy<TPolicyName extends CountWindowRateLimitPolicyName>(
    policyName: TPolicyName,
    context: CountWindowRateLimitPolicyContextMap[TPolicyName],
  ): CountWindowRateLimitRule {
    switch (policyName) {
      case "relayCustomKeyCreate": {
        const { currentCount, maxRequests, windowMinutes } =
          context as CountWindowRateLimitPolicyContextMap["relayCustomKeyCreate"];
        return {
          currentCount,
          maxRequests,
          windowMinutes,
          reason: "RELAY_CUSTOM_KEY_CREATE_RATE_LIMIT_EXCEEDED",
        };
      }
    }
  }

  private getBackoffPolicy<TPolicyName extends BackoffRateLimitPolicyName>(
    policyName: TPolicyName,
    context: BackoffRateLimitPolicyContextMap[TPolicyName],
  ): {
    key: string;
    windowMs: number;
    maxAttempts: number;
    baseBackoffMs: number;
    errorMessage: string;
  } {
    switch (policyName) {
      case "twoFactorAttempt": {
        const { identifier } = context as BackoffRateLimitPolicyContextMap["twoFactorAttempt"];
        return {
          key: `two_factor:rate_limit:${identifier}`,
          windowMs: 15 * 60 * 1000,
          maxAttempts: 5,
          baseBackoffMs: 1000,
          errorMessage: "请求过于频繁，请稍后再试",
        };
      }
      case "relayCustomKeySet": {
        const { userId } = context as BackoffRateLimitPolicyContextMap["relayCustomKeySet"];
        return {
          key: `relay:custom_key:set_rate_limit:${userId}`,
          windowMs: 10 * 60 * 1000,
          maxAttempts: 5,
          baseBackoffMs: 1000,
          errorMessage: "自定义Key操作过于频繁，请稍后再试",
        };
      }
    }
  }

  private getLoginIpKey(ipAddress: string): string {
    return `rate_limit:login:ip:${ipAddress}`;
  }

  private getLoginUserKey(username: string): string {
    return `rate_limit:login:user:${username}`;
  }

  private async getBackoffRateLimitState(key: string): Promise<BackoffRateLimitState | null> {
    const recordRaw = await this.redisService.get(key);
    if (!recordRaw) return null;

    try {
      const parsed = JSON.parse(recordRaw) as Partial<BackoffRateLimitState>;
      if (
        typeof parsed.count !== "number" ||
        typeof parsed.lastAttempt !== "number" ||
        typeof parsed.lockoutUntil !== "number"
      ) {
        await this.redisService.delete(key);
        return null;
      }

      return {
        count: parsed.count,
        lastAttempt: parsed.lastAttempt,
        lockoutUntil: parsed.lockoutUntil,
      };
    } catch {
      await this.redisService.delete(key);
      return null;
    }
  }

  private getTwoFactorIpKey(ipAddress: string): string {
    return `rate_limit:2fa:ip:${ipAddress}`;
  }

  private getTwoFactorChallengeKey(challengeToken: string): string {
    return `rate_limit:2fa:challenge:${challengeToken}`;
  }

  private getTwoFactorEmailSendIpKey(ipAddress: string): string {
    return `rate_limit:2fa_email_send:ip:${ipAddress}`;
  }

  private getTwoFactorEmailSendChallengeKey(challengeToken: string): string {
    return `rate_limit:2fa_email_send:challenge:${challengeToken}`;
  }

  private getTwoFactorTrustedDeviceIpKey(ipAddress: string): string {
    return `rate_limit:2fa_trusted_device:ip:${ipAddress}`;
  }

  private getTwoFactorTrustedDeviceUserKey(userId: string): string {
    return `rate_limit:2fa_trusted_device:user:${userId}`;
  }

  private async getRetryAfterSeconds(key: string): Promise<number> {
    const ttl = await this.redisService.ttl(key);
    if (ttl == null || ttl < 0) return 0;
    return ttl;
  }

  private shouldFailOpenWithoutRedis(scope: string): boolean {
    if (this.redisService.isRedisAvailable()) return false;

    logger.warn(`Redis unavailable, fail-open for ${scope}`);
    return true;
  }
}
