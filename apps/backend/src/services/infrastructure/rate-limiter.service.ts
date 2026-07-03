import { RATE_LIMITER_CONFIG } from "@/config/rate-limiter";
import { getLogger, LogCategory } from "@/util/logger";
import { EmailRateLimitLogRepository } from "@/store/auth/email-rate-limit-log.repository";
import type { EmailRateLimitLogStore } from "@/store/auth/email-rate-limit-log.store";
import { RedisService } from "./redis.service";

const logger = getLogger("RateLimiterService", LogCategory.BUSINESS);

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfter?: number; // 秒数
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

  /**
   * 检查邮件验证码发送频率限制
   */
  async checkEmailVerificationRateLimit(ipAddress: string, email: string): Promise<RateLimitCheckResult> {
    const action = "verification_code";
    const config = RATE_LIMITER_CONFIG.emailVerification;

    // Tier 1: 检查 IP 级别限制
    const ipCount = await this.countRequests(ipAddress, null, action, config.perIp.windowMinutes);

    if (ipCount >= config.perIp.maxRequests) {
      const retryAfter = await this.calculateRetryAfter(ipAddress, null, action, config.perIp.windowMinutes);
      logger.warn(`IP rate limit exceeded: ${ipAddress}, count: ${ipCount}`);
      return {
        allowed: false,
        reason: "IP_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    // Tier 2: 检查 IP+邮箱组合限制
    const ipEmailCount = await this.countRequests(ipAddress, email, action, config.perIpEmail.windowMinutes);

    if (ipEmailCount >= config.perIpEmail.maxRequests) {
      const retryAfter = await this.calculateRetryAfter(ipAddress, email, action, config.perIpEmail.windowMinutes);
      logger.warn(`IP+Email rate limit exceeded: ${ipAddress} + ${email}, count: ${ipEmailCount}`);
      return {
        allowed: false,
        reason: "IP_EMAIL_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    return { allowed: true };
  }

  /**
   * 记录验证码请求
   */
  async logEmailVerificationRequest(ipAddress: string, email: string): Promise<void> {
    try {
      await this.emailRateLimitLogRepository.create(ipAddress, email, "verification_code", new Date());
    } catch (error) {
      logger.error("Failed to log rate limit request", { error });
    }
  }

  /**
   * 检查找回密码验证码发送频率限制
   */
  async checkPasswordResetCodeRateLimit(ipAddress: string, email: string): Promise<RateLimitCheckResult> {
    const action = "password_reset_code";
    const config = RATE_LIMITER_CONFIG.emailVerification;

    const ipCount = await this.countRequests(ipAddress, null, action, config.perIp.windowMinutes);

    if (ipCount >= config.perIp.maxRequests) {
      const retryAfter = await this.calculateRetryAfter(ipAddress, null, action, config.perIp.windowMinutes);
      logger.warn(`Password reset IP rate limit exceeded: ${ipAddress}, count: ${ipCount}`);
      return {
        allowed: false,
        reason: "IP_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    const ipEmailCount = await this.countRequests(ipAddress, email, action, config.perIpEmail.windowMinutes);

    if (ipEmailCount >= config.perIpEmail.maxRequests) {
      const retryAfter = await this.calculateRetryAfter(ipAddress, email, action, config.perIpEmail.windowMinutes);
      logger.warn(`Password reset IP+Email rate limit exceeded: ${ipAddress} + ${email}, count: ${ipEmailCount}`);
      return {
        allowed: false,
        reason: "IP_EMAIL_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    return { allowed: true };
  }

  /**
   * 记录找回密码验证码请求
   */
  async logPasswordResetCodeRequest(ipAddress: string, email: string): Promise<void> {
    try {
      await this.emailRateLimitLogRepository.create(ipAddress, email, "password_reset_code", new Date());
    } catch (error) {
      logger.error("Failed to log password reset rate limit request", { error });
    }
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

  /**
   * 检查 2FA 验证频率限制（IP + challenge 双层）
   */
  async checkTwoFactorVerificationRateLimit(ipAddress: string, challengeToken: string): Promise<RateLimitCheckResult> {
    if (this.shouldFailOpenWithoutRedis("checkTwoFactorVerificationRateLimit"))
      return {
        allowed: true,
        reason: "RATE_LIMIT_BACKEND_UNAVAILABLE",
      };

    const config = RATE_LIMITER_CONFIG.twoFactorVerification;
    const ipKey = this.getTwoFactorIpKey(ipAddress);
    const challengeKey = this.getTwoFactorChallengeKey(challengeToken);

    const [ipCountRaw, challengeCountRaw] = await Promise.all([
      this.redisService.get(ipKey),
      this.redisService.get(challengeKey),
    ]);

    const ipCount = Number(ipCountRaw || "0");
    if (ipCount >= config.perIp.maxRequests) {
      const retryAfter = await this.getRetryAfterSeconds(ipKey);
      return {
        allowed: false,
        reason: "TWO_FACTOR_IP_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    const challengeCount = Number(challengeCountRaw || "0");
    if (challengeCount >= config.perChallenge.maxRequests) {
      const retryAfter = await this.getRetryAfterSeconds(challengeKey);
      return {
        allowed: false,
        reason: "TWO_FACTOR_CHALLENGE_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    return { allowed: true };
  }

  /**
   * 记录 2FA 验证尝试（成功与失败都记，用于防刷）
   */
  async logTwoFactorVerificationAttempt(ipAddress: string, challengeToken: string): Promise<void> {
    if (this.shouldFailOpenWithoutRedis("logTwoFactorVerificationAttempt")) return;

    const config = RATE_LIMITER_CONFIG.twoFactorVerification;
    const ipKey = this.getTwoFactorIpKey(ipAddress);
    const challengeKey = this.getTwoFactorChallengeKey(challengeToken);

    await Promise.all([
      this.redisService.increment(ipKey, config.perIp.windowMinutes * 60),
      this.redisService.increment(challengeKey, config.perChallenge.windowMinutes * 60),
    ]);
  }

  /**
   * 检查 2FA 邮箱验证码发送频率限制（独立于验证码提交次数）
   */
  async checkTwoFactorEmailSendRateLimit(ipAddress: string, challengeToken: string): Promise<RateLimitCheckResult> {
    if (this.shouldFailOpenWithoutRedis("checkTwoFactorEmailSendRateLimit"))
      return {
        allowed: true,
        reason: "RATE_LIMIT_BACKEND_UNAVAILABLE",
      };

    const config = RATE_LIMITER_CONFIG.twoFactorEmailSend;
    const ipKey = this.getTwoFactorEmailSendIpKey(ipAddress);
    const challengeKey = this.getTwoFactorEmailSendChallengeKey(challengeToken);

    const [ipCountRaw, challengeCountRaw] = await Promise.all([
      this.redisService.get(ipKey),
      this.redisService.get(challengeKey),
    ]);

    const ipCount = Number(ipCountRaw || "0");
    if (ipCount >= config.perIp.maxRequests) {
      const retryAfter = await this.getRetryAfterSeconds(ipKey);
      return {
        allowed: false,
        reason: "TWO_FACTOR_EMAIL_SEND_IP_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    const challengeCount = Number(challengeCountRaw || "0");
    if (challengeCount >= config.perChallenge.maxRequests) {
      const retryAfter = await this.getRetryAfterSeconds(challengeKey);
      return {
        allowed: false,
        reason: "TWO_FACTOR_EMAIL_SEND_CHALLENGE_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    return { allowed: true };
  }

  /**
   * 记录 2FA 邮箱验证码发送请求（与验证码提交计数分离）
   */
  async logTwoFactorEmailSendAttempt(ipAddress: string, challengeToken: string): Promise<void> {
    if (this.shouldFailOpenWithoutRedis("logTwoFactorEmailSendAttempt")) return;

    const config = RATE_LIMITER_CONFIG.twoFactorEmailSend;
    const ipKey = this.getTwoFactorEmailSendIpKey(ipAddress);
    const challengeKey = this.getTwoFactorEmailSendChallengeKey(challengeToken);

    await Promise.all([
      this.redisService.increment(ipKey, config.perIp.windowMinutes * 60),
      this.redisService.increment(challengeKey, config.perChallenge.windowMinutes * 60),
    ]);
  }

  /**
   * 检查 trusted-device 列表/删除操作频率限制（IP + user 双层）
   */
  async checkTwoFactorTrustedDeviceOperationRateLimit(
    ipAddress: string,
    userId: string,
  ): Promise<RateLimitCheckResult> {
    if (this.shouldFailOpenWithoutRedis("checkTwoFactorTrustedDeviceOperationRateLimit"))
      return {
        allowed: true,
        reason: "RATE_LIMIT_BACKEND_UNAVAILABLE",
      };

    const config = RATE_LIMITER_CONFIG.twoFactorTrustedDevice;
    const ipKey = this.getTwoFactorTrustedDeviceIpKey(ipAddress);
    const userKey = this.getTwoFactorTrustedDeviceUserKey(userId);

    const [ipCountRaw, userCountRaw] = await Promise.all([
      this.redisService.get(ipKey),
      this.redisService.get(userKey),
    ]);

    const ipCount = Number(ipCountRaw || "0");
    if (ipCount >= config.perIp.maxRequests) {
      const retryAfter = await this.getRetryAfterSeconds(ipKey);
      return {
        allowed: false,
        reason: "TWO_FACTOR_TRUSTED_DEVICE_IP_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    const userCount = Number(userCountRaw || "0");
    if (userCount >= config.perUser.maxRequests) {
      const retryAfter = await this.getRetryAfterSeconds(userKey);
      return {
        allowed: false,
        reason: "TWO_FACTOR_TRUSTED_DEVICE_USER_RATE_LIMIT_EXCEEDED",
        retryAfter,
      };
    }

    return { allowed: true };
  }

  /**
   * 记录 trusted-device 列表/删除操作请求
   */
  async logTwoFactorTrustedDeviceOperationAttempt(ipAddress: string, userId: string): Promise<void> {
    if (this.shouldFailOpenWithoutRedis("logTwoFactorTrustedDeviceOperationAttempt")) return;

    const config = RATE_LIMITER_CONFIG.twoFactorTrustedDevice;
    const ipKey = this.getTwoFactorTrustedDeviceIpKey(ipAddress);
    const userKey = this.getTwoFactorTrustedDeviceUserKey(userId);

    await Promise.all([
      this.redisService.increment(ipKey, config.perIp.windowMinutes * 60),
      this.redisService.increment(userKey, config.perUser.windowMinutes * 60),
    ]);
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
