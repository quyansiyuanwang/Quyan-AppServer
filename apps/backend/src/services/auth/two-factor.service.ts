import { randomBytes, createHash, createHmac, timingSafeEqual } from "crypto";
import QRCode from "qrcode";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import { RedisService } from "@/services/infrastructure/redis.service";
import { BadRequestError, UnauthorizedError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import {
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_DEFAULT,
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MAX,
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MIN,
} from "@/constant/two-factor";
import { TwoFactorCredentialRepository } from "@/store/auth/two-factor.repository";
import type { TwoFactorCredentialStore } from "@/store/auth/two-factor.store";
import { EnvSpace } from "@/config/env";
import { EmailService } from "./email.service";
import { revokeAllUserSessions } from "@/util/auth";
import { getLogger, LogCategory } from "@/util/logger";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { NotificationEvent } from "@/constant/notification-event";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";

interface TwoFactorSetupSession {
  userId: string;
  secret: string;
}

interface TwoFactorLoginChallenge {
  userId: string;
}

interface VerifyPayloadInput {
  code?: string;
  recoveryCode?: string;
  emailCode?: string;
}

type VerifyPayload =
  | {
      code: string;
      recoveryCode?: undefined;
      emailCode?: undefined;
    }
  | {
      code?: undefined;
      recoveryCode: string;
      emailCode?: undefined;
    }
  | {
      code?: undefined;
      recoveryCode?: undefined;
      emailCode: string;
    };

interface TwoFactorStatus {
  enabled: boolean;
  passkeyRequired: boolean;
  hasRecoveryCodes: boolean;
  trustedDeviceCapabilities: {
    pageSizeMin: number;
    pageSizeMax: number;
    pageSizeDefault: number;
  };
}

interface LoginChallengeResult {
  challengeToken: string;
  expiresIn: number;
}

interface SetupResult {
  setupToken: string;
  qrCodeDataUrl: string;
  otpauthUrl: string;
  secret: string;
  expiresIn: number;
}

interface ConfirmSetupResult {
  enabled: boolean;
  passkeyRequired: boolean;
  recoveryCodes: string[];
}

interface ToggleResult {
  enabled: boolean;
  passkeyRequired: boolean;
}

interface RegenerateRecoveryCodesResult {
  recoveryCodes: string[];
}

interface TwoFactorLoginReminder {
  shouldSetupTwoFactor: true;
  message: string;
  nextRemindAt: string;
  intervalDays: number;
}

interface TrustContext {
  ipAddress: string;
  userAgent?: string | null;
  fingerprint?: string | null;
  trustedDeviceToken?: string | null;
}

// Internal trusted-device data shapes used only within this service module.
interface TrustedDeviceSnapshot {
  version: 1;
  trustedAt: string;
  lastUsedAt: string;
  ipAddress: string;
  userAgent: string;
  fingerprint: string | null;
}

interface TrustedDevice {
  deviceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  fingerprint: string | null;
  trustedAt: string | null;
  lastUsedAt: string | null;
  expiresInSeconds: number | null;
}

interface TrustedDeviceGrant {
  trustedDeviceToken: string;
  expiresIn: number;
}

interface VerifiedTrustedDeviceToken {
  deviceId: string;
}

interface ParsedTrustedDeviceToken {
  version: string;
  deviceId: string;
  signature: string;
}

const DEFAULT_TOTP_INTERVAL_SECONDS = 30;
const TOTP_DIGITS = 6;
const SETUP_SESSION_TTL_SECONDS = 10 * 60;
const LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
const DEFAULT_RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_CHUNK = 4;
const RECOVERY_CODE_BYTE_LENGTH = 6;
const TRUSTED_DEVICE_TOKEN_VERSION = "v1";
const TRUSTED_DEVICE_TOKEN_LEGACY_VERSION = "legacy";
const TRUSTED_DEVICE_ID_PATTERN = /^[a-fA-F0-9]{64}$/;
const TRUSTED_DEVICE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const TRUSTED_DEVICE_USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TRUSTED_DEVICE_LIST_MAX = 200;
const TRUSTED_DEVICE_SECRET_MIN_LENGTH = 64;
const TRUSTED_DEVICE_METRICS_TTL_SECONDS = 90 * 24 * 60 * 60;
const TRUSTED_DEVICE_IP_MAX_LENGTH = 256;
const TRUSTED_DEVICE_USER_AGENT_MAX_LENGTH = 1024;
const TRUSTED_DEVICE_FINGERPRINT_MAX_LENGTH = 1024;
const TRUSTED_DEVICE_REVOKE_COOLDOWN_SECONDS = 30;
const TRUSTED_DEVICE_REVOKE_MARKER_VALUE = "1";

const logger = getLogger("TwoFactorService", LogCategory.AUTH);

type TrustedDeviceMetric = "verify_hit" | "verify_miss" | "created" | "deleted";

export class TwoFactorService {
  private static instance: TwoFactorService;
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly BASE_BACKOFF_MS = 1000;
  private static readonly LOCKOUT_MS = 15 * 60 * 1000;

  private constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly twoFactorCredentialRepository: TwoFactorCredentialStore = TwoFactorCredentialRepository.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
    private readonly emailService: EmailService = EmailService.getInstance(),
    private readonly rateLimiterService: RateLimiterService = RateLimiterService.getInstance(),
  ) {}

  public static getInstance(): TwoFactorService {
    if (!TwoFactorService.instance) TwoFactorService.instance = new TwoFactorService();

    return TwoFactorService.instance;
  }

  async getStatus(userId: string): Promise<TwoFactorStatus> {
    const [user, credential] = await Promise.all([
      this.userRepository.findById(userId),
      this.twoFactorCredentialRepository.findByUserId(userId),
    ]);

    if (!user) throw new BadRequestError("用户不存在", CustomCode.NOT_FOUND);

    const recoveryCodeHashes = this.parseRecoveryCodeHashes(credential?.recoveryCodeHashes);

    return {
      enabled: Boolean(user.twoFactorEnabled),
      passkeyRequired: Boolean(user.twoFactorPasskeyRequired),
      hasRecoveryCodes: recoveryCodeHashes.length > 0,
      trustedDeviceCapabilities: {
        pageSizeMin: TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MIN,
        pageSizeMax: TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MAX,
        pageSizeDefault: TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_DEFAULT,
      },
    };
  }

  async beginSetup(userId: string): Promise<SetupResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new BadRequestError("用户不存在", CustomCode.NOT_FOUND);

    const setupToken = this.generateOpaqueToken(32);
    const secret = this.generateBase32Secret(32);

    const setupSession: TwoFactorSetupSession = {
      userId,
      secret,
    };

    await this.redisService.set(this.setupKey(setupToken), JSON.stringify(setupSession), SETUP_SESSION_TTL_SECONDS);

    const appName = EnvSpace.webAuthnConfig?.rpName || "AppServer";
    const accountLabel = encodeURIComponent(`${appName}:${user.username}`);
    const issuer = encodeURIComponent(appName);
    const otpauthUrl = `otpauth://totp/${accountLabel}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${this.getTotpIntervalSeconds()}`;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
    });

    return {
      setupToken,
      qrCodeDataUrl,
      otpauthUrl,
      secret,
      expiresIn: SETUP_SESSION_TTL_SECONDS,
    };
  }

  async confirmSetup(userId: string, setupToken: string, code: string): Promise<ConfirmSetupResult> {
    const setupSession = await this.getSetupSessionOrThrow(setupToken);
    if (setupSession.userId !== userId)
      throw new UnauthorizedError("无效的二次验证配置会话", CustomCode.TWO_FACTOR_SETUP_SESSION_EXPIRED);

    const rateLimitIdentifier = this.rateLimitIdentifier("setup_confirm", userId);
    await this.checkRateLimit(rateLimitIdentifier);

    const verified = this.verifyTotpCode(setupSession.secret, code);
    if (!verified) {
      await this.markRateLimitFailure(rateLimitIdentifier);
      throw new UnauthorizedError("二次验证码错误", CustomCode.TWO_FACTOR_CODE_INVALID);
    }

    await this.clearRateLimit(rateLimitIdentifier);

    const recoveryCodes = this.generateRecoveryCodes(this.getRecoveryCodeCount());
    const recoveryCodeHashes = recoveryCodes.map((item) => this.hashRecoveryCode(item));

    await this.twoFactorCredentialRepository.upsertByUserId(userId, {
      secret: setupSession.secret,
      recoveryCodeHashes,
    });

    await this.userRepository.updateById(userId, {
      twoFactorEnabled: true,
    });

    await this.redisService.delete(this.setupKey(setupToken));
    await this.clearLoginReminderCooldown(userId);

    const updatedUser = await this.userRepository.findById(userId);

    // Fire-and-forget: notify user that 2FA was enabled
    this.dispatchTwoFactorStatusNotification(userId, true).catch(() => {});

    return {
      enabled: Boolean(updatedUser?.twoFactorEnabled),
      passkeyRequired: Boolean(updatedUser?.twoFactorPasskeyRequired),
      recoveryCodes,
    };
  }

  async disable(userId: string, payload: VerifyPayloadInput): Promise<ToggleResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new BadRequestError("用户不存在", CustomCode.NOT_FOUND);
    if (!user.twoFactorEnabled) throw new BadRequestError("二次验证未开启", CustomCode.TWO_FACTOR_NOT_ENABLED);

    await this.verifyUserFactorOrRecoveryCode(userId, payload);

    await Promise.all([
      this.twoFactorCredentialRepository.deleteByUserId(userId),
      this.userRepository.updateById(userId, {
        twoFactorEnabled: false,
        twoFactorPasskeyRequired: false,
      }),
    ]);

    await Promise.all([
      this.clearAllTrustedWithinWindow(userId),
      this.clearLoginReminderCooldown(userId),
      revokeAllUserSessions(userId),
    ]);

    // Fire-and-forget: notify user that 2FA was disabled
    this.dispatchTwoFactorStatusNotification(userId, false).catch(() => {});

    return {
      enabled: false,
      passkeyRequired: false,
    };
  }

  async updatePasskeyPolicy(userId: string, passkeyRequired: boolean): Promise<ToggleResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new BadRequestError("用户不存在", CustomCode.NOT_FOUND);
    if (!user.twoFactorEnabled) throw new BadRequestError("二次验证未开启", CustomCode.TWO_FACTOR_NOT_ENABLED);

    const updated = await this.userRepository.updateById(userId, {
      twoFactorPasskeyRequired: passkeyRequired,
    });

    return {
      enabled: Boolean(updated.twoFactorEnabled),
      passkeyRequired: Boolean(updated.twoFactorPasskeyRequired),
    };
  }

  async regenerateRecoveryCodes(userId: string, payload: VerifyPayloadInput): Promise<RegenerateRecoveryCodesResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new BadRequestError("用户不存在", CustomCode.NOT_FOUND);
    if (!user.twoFactorEnabled) throw new BadRequestError("二次验证未开启", CustomCode.TWO_FACTOR_NOT_ENABLED);

    await this.verifyUserFactorOrRecoveryCode(userId, payload);

    const recoveryCodes = this.generateRecoveryCodes(this.getRecoveryCodeCount());
    const recoveryCodeHashes = recoveryCodes.map((item) => this.hashRecoveryCode(item));

    await this.twoFactorCredentialRepository.updateRecoveryCodeHashes(userId, recoveryCodeHashes);

    return {
      recoveryCodes,
    };
  }

  async createLoginChallenge(userId: string): Promise<LoginChallengeResult> {
    const challengeToken = this.generateOpaqueToken(32);
    const payload: TwoFactorLoginChallenge = { userId };
    await this.redisService.set(
      this.loginChallengeKey(challengeToken),
      JSON.stringify(payload),
      LOGIN_CHALLENGE_TTL_SECONDS,
    );

    return {
      challengeToken,
      expiresIn: LOGIN_CHALLENGE_TTL_SECONDS,
    };
  }

  async consumeLoginReminder(userId: string, twoFactorEnabled: boolean): Promise<TwoFactorLoginReminder | null> {
    if (twoFactorEnabled) return null;
    if (!EnvSpace.twoFactorConfig.reminderEnabled) return null;
    if (!this.redisService.isRedisAvailable()) return null;

    const intervalSeconds = this.getReminderIntervalSeconds();
    if (intervalSeconds <= 0) return null;

    const key = this.reminderCooldownKey(userId);
    const nextRemindAtEpoch = Math.floor(Date.now() / 1000) + intervalSeconds;
    const reserved = await this.redisService.setIfNotExists(key, nextRemindAtEpoch, intervalSeconds * 1000);
    if (reserved !== true) return null;

    return {
      shouldSetupTwoFactor: true,
      message: "建议开启二次验证以提升账号安全",
      nextRemindAt: new Date(nextRemindAtEpoch * 1000).toISOString(),
      intervalDays: Math.max(1, Number(EnvSpace.twoFactorConfig.reminderIntervalDays) || 7),
    };
  }

  async verifyLoginChallenge(challengeToken: string, payload: VerifyPayloadInput): Promise<string> {
    const challenge = await this.getLoginChallengeOrThrow(challengeToken);

    await this.verifyUserFactorOrRecoveryCode(challenge.userId, payload);
    await this.redisService.delete(this.loginChallengeKey(challengeToken));

    return challenge.userId;
  }

  async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    return Boolean(user?.twoFactorEnabled);
  }

  async shouldRequireSecondFactorForPasskey(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) return false;
    return Boolean(user.twoFactorEnabled && user.twoFactorPasskeyRequired);
  }

  async isTrustedWithinWindow(userId: string, context: TrustContext): Promise<boolean> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) {
      void this.recordTrustedDeviceMetric("verify_miss");
      return false;
    }

    const trustWindowSeconds = this.getTrustWindowSeconds();
    if (trustWindowSeconds <= 0) {
      void this.recordTrustedDeviceMetric("verify_miss");
      return false;
    }

    const verifiedToken = this.verifyTrustedDeviceToken(normalizedUserId, context.trustedDeviceToken);
    if (!verifiedToken) {
      void this.recordTrustedDeviceMetric("verify_miss");
      return false;
    }

    if (await this.isTrustedDeviceRevoked(normalizedUserId, verifiedToken.deviceId)) {
      void this.recordTrustedDeviceMetric("verify_miss");
      return false;
    }

    const key = this.trustedDeviceKey(normalizedUserId, verifiedToken.deviceId);
    const [rawValue, ttlSeconds] = await Promise.all([this.redisService.get(key), this.redisService.ttl(key)]);
    const trusted = Boolean(rawValue);

    if (trusted && ttlSeconds !== null && ttlSeconds > 0)
      void this.touchTrustedDeviceLastUsed(key, rawValue, ttlSeconds, context);

    void this.recordTrustedDeviceMetric(trusted ? "verify_hit" : "verify_miss");
    return trusted;
  }

  async markTrustedWithinWindow(
    userId: string,
    context: TrustContext,
    customWindowSeconds?: number,
  ): Promise<TrustedDeviceGrant | null> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return null;

    const trustWindowSeconds = customWindowSeconds ?? this.getTrustWindowSeconds();
    if (trustWindowSeconds <= 0) return null;

    const nowIso = new Date().toISOString();
    const snapshot: TrustedDeviceSnapshot = {
      version: 1,
      trustedAt: nowIso,
      lastUsedAt: nowIso,
      ipAddress: this.normalizeTrustedDeviceText(context.ipAddress, "unknown", TRUSTED_DEVICE_IP_MAX_LENGTH),
      userAgent: this.normalizeTrustedDeviceText(context.userAgent, "", TRUSTED_DEVICE_USER_AGENT_MAX_LENGTH),
      fingerprint: this.normalizeTrustedDeviceTextOrNull(context.fingerprint, TRUSTED_DEVICE_FINGERPRINT_MAX_LENGTH),
    };

    const existingToken = this.verifyTrustedDeviceToken(normalizedUserId, context.trustedDeviceToken);
    let deviceId = existingToken?.deviceId || null;
    if (deviceId && (await this.isTrustedDeviceRevoked(normalizedUserId, deviceId))) deviceId = null;
    let reusedByFingerprint = false;
    if (!deviceId && snapshot.fingerprint) {
      const matchedDeviceId = await this.findTrustedDeviceIdByFingerprint(normalizedUserId, snapshot.fingerprint);
      if (matchedDeviceId) {
        deviceId = matchedDeviceId;
        reusedByFingerprint = true;
      }
    }

    const resolvedDeviceId = deviceId || this.generateTrustedDeviceId();
    const key = this.trustedDeviceKey(normalizedUserId, resolvedDeviceId);

    await this.redisService.set(key, JSON.stringify(snapshot), trustWindowSeconds);
    if (snapshot.fingerprint)
      await this.clearDuplicateTrustedDevicesByFingerprint(normalizedUserId, resolvedDeviceId, snapshot.fingerprint);

    if (!existingToken && !reusedByFingerprint) void this.recordTrustedDeviceMetric("created");

    return {
      trustedDeviceToken: this.createTrustedDeviceToken(normalizedUserId, resolvedDeviceId),
      expiresIn: trustWindowSeconds,
    };
  }

  /**
   * 创建一次性可信令牌（用于高危接口的单次重试）
   * @param userId 用户 ID
   * @param expiresInSeconds 过期时间（秒），默认 30 秒
   * @returns 一次性令牌
   */
  async createOneTimeTrustedToken(userId: string, expiresInSeconds: number = 30): Promise<string> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) throw new Error("Invalid user ID");

    // 生成随机 nonce
    const nonce = randomBytes(32).toString("hex");
    const key = this.oneTimeTrustedTokenKey(normalizedUserId, nonce);

    // 存储到 Redis，设置过期时间
    await this.redisService.set(key, "1", expiresInSeconds);

    return nonce;
  }

  /**
   * 验证一次性可信令牌（不删除，允许在有效期内多次使用）
   * @param userId 用户 ID
   * @param nonce 一次性令牌
   * @returns 是否有效
   */
  async verifyOneTimeTrustedToken(userId: string, nonce: string | undefined): Promise<boolean> {
    if (!nonce) return false;

    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return false;

    const key = this.oneTimeTrustedTokenKey(normalizedUserId, nonce);

    // 检查令牌是否存在（不删除）
    const exists = await this.redisService.get(key);
    return Boolean(exists);
  }

  /**
   * 验证并消费一次性可信令牌（验证后立即删除）
   * @param userId 用户 ID
   * @param nonce 一次性令牌
   * @returns 是否有效
   */
  async verifyAndConsumeOneTimeTrustedToken(userId: string, nonce: string | undefined): Promise<boolean> {
    if (!nonce) return false;

    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return false;

    const key = this.oneTimeTrustedTokenKey(normalizedUserId, nonce);

    // 检查令牌是否存在
    const exists = await this.redisService.get(key);
    if (!exists) return false;

    // 立即删除令牌（确保只能使用一次）
    await this.redisService.delete(key);

    return true;
  }

  async listTrustedDevicesWithinWindow(userId: string): Promise<TrustedDevice[]> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return [];
    if (!this.redisService.isRedisAvailable()) return [];

    const allTrustedKeys = await this.redisService.getKeysByPattern(
      `two_factor:trusted:${normalizedUserId}:*`,
      TRUSTED_DEVICE_LIST_MAX,
    );
    if (!allTrustedKeys.length) return [];

    const uniqueKeys = Array.from(new Set(allTrustedKeys));
    const devices = await Promise.all(
      uniqueKeys.map(async (key) => {
        const deviceId = this.extractTrustedDeviceIdFromKey(normalizedUserId, key);
        if (!deviceId) return null;

        const [rawValue, ttlSeconds] = await Promise.all([this.redisService.get(key), this.redisService.ttl(key)]);
        const snapshot = this.parseTrustedDeviceSnapshot(rawValue);

        return {
          deviceId,
          ipAddress: snapshot?.ipAddress ?? null,
          userAgent: snapshot?.userAgent ?? null,
          fingerprint: snapshot?.fingerprint ?? null,
          trustedAt: snapshot?.trustedAt ?? null,
          lastUsedAt: snapshot?.lastUsedAt ?? null,
          expiresInSeconds: ttlSeconds !== null && ttlSeconds >= 0 ? ttlSeconds : null,
        } as TrustedDevice;
      }),
    );

    return devices
      .filter((item): item is TrustedDevice => Boolean(item))
      .sort((left, right) => {
        const leftLastUsedAt = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0;
        const rightLastUsedAt = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0;
        if (leftLastUsedAt !== rightLastUsedAt) return rightLastUsedAt - leftLastUsedAt;

        const leftTime = left.trustedAt ? Date.parse(left.trustedAt) : 0;
        const rightTime = right.trustedAt ? Date.parse(right.trustedAt) : 0;
        if (leftTime !== rightTime) return rightTime - leftTime;

        const leftTtl = left.expiresInSeconds ?? -1;
        const rightTtl = right.expiresInSeconds ?? -1;
        return rightTtl - leftTtl;
      });
  }

  async removeTrustedDeviceWithinWindow(userId: string, deviceId: string): Promise<boolean> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return false;

    const normalizedDeviceId = deviceId.trim().toLowerCase();
    if (!TRUSTED_DEVICE_ID_PATTERN.test(normalizedDeviceId)) return false;

    const key = this.trustedDeviceKey(normalizedUserId, normalizedDeviceId);
    const ownedByUser = await this.isTrustedDeviceOwnedByUser(normalizedUserId, normalizedDeviceId);
    if (!ownedByUser) return false;

    await this.markTrustedDeviceRevoked(normalizedUserId, normalizedDeviceId);

    const deleted = await this.redisService.delete(key);
    if (deleted && deleted > 0) void this.recordTrustedDeviceMetric("deleted");
    return Boolean(deleted && deleted > 0);
  }

  async clearTrustedWithinWindow(userId: string, context: TrustContext): Promise<void> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return;

    const verifiedToken = this.verifyTrustedDeviceToken(normalizedUserId, context.trustedDeviceToken);
    if (verifiedToken)
      await Promise.all([
        this.redisService.delete(this.trustedDeviceKey(normalizedUserId, verifiedToken.deviceId)),
        this.markTrustedDeviceRevoked(normalizedUserId, verifiedToken.deviceId),
      ]);

    await this.clearAllTrustedWithinWindow(normalizedUserId);
  }

  async clearAllTrustedWithinWindow(userId: string): Promise<void> {
    const normalizedUserId = this.normalizeTrustedDeviceUserId(userId);
    if (!normalizedUserId) return;
    if (!this.redisService.isRedisAvailable()) return;

    const allTrustedKeys = await this.redisService.getKeysByPattern(`two_factor:trusted:${normalizedUserId}:*`);
    if (allTrustedKeys.length > 0) await this.redisService.deleteMany(allTrustedKeys);
  }

  async sendLoginEmailCode(challengeToken: string): Promise<{ message: string; maskedEmail?: string }> {
    const challenge = await this.getLoginChallengeOrThrow(challengeToken);
    const user = await this.userRepository.findById(challenge.userId);
    if (!user || !user.email)
      throw new BadRequestError("当前账号未绑定邮箱，无法使用邮箱验证码", CustomCode.VERIFICATION_CODE_INVALID);

    await this.emailService.sendLoginVerificationCode(user.email);

    return {
      message: "验证码已发送",
      maskedEmail: this.maskEmail(user.email),
    };
  }

  private async verifyUserFactorOrRecoveryCode(userId: string, payloadInput: VerifyPayloadInput): Promise<void> {
    const rateLimitIdentifier = this.rateLimitIdentifier("factor_verify", userId);
    await this.checkRateLimit(rateLimitIdentifier);

    const payload = this.normalizeVerifyPayload(payloadInput);
    const credential = await this.twoFactorCredentialRepository.findByUserId(userId);
    if (!credential) throw new UnauthorizedError("二次验证失败", CustomCode.TWO_FACTOR_CODE_INVALID);

    try {
      if (payload.code) {
        const verified = this.verifyTotpCode(credential.secret, payload.code);
        if (!verified) throw new UnauthorizedError("二次验证码错误", CustomCode.TWO_FACTOR_CODE_INVALID);

        await this.twoFactorCredentialRepository.updateLastUsedAt(userId, new Date());
        await this.clearRateLimit(rateLimitIdentifier);
        return;
      }

      if (payload.emailCode) {
        const user = await this.userRepository.findById(userId);
        if (!user || !user.email) throw new UnauthorizedError("二次验证失败", CustomCode.TWO_FACTOR_CODE_INVALID);

        const verified = await this.emailService.verifyCode(user.email, payload.emailCode);
        if (!verified) throw new UnauthorizedError("邮箱验证码错误", CustomCode.TWO_FACTOR_CODE_INVALID);

        await this.twoFactorCredentialRepository.updateLastUsedAt(userId, new Date());
        await this.clearRateLimit(rateLimitIdentifier);
        return;
      }

      const recoveryCode = payload.recoveryCode;
      if (!recoveryCode) throw new UnauthorizedError("二次验证失败", CustomCode.TWO_FACTOR_CODE_INVALID);

      const recoveryCodeHashes = this.parseRecoveryCodeHashes(credential.recoveryCodeHashes);
      const hashed = this.hashRecoveryCode(recoveryCode);
      const matchedIndex = this.findMatchingHashIndex(recoveryCodeHashes, hashed);

      if (matchedIndex < 0) throw new UnauthorizedError("恢复码错误", CustomCode.TWO_FACTOR_CODE_INVALID);

      const nextHashes = recoveryCodeHashes.filter((_item, index) => index !== matchedIndex);
      await Promise.all([
        this.twoFactorCredentialRepository.updateRecoveryCodeHashes(userId, nextHashes),
        this.twoFactorCredentialRepository.updateLastUsedAt(userId, new Date()),
      ]);

      await this.clearRateLimit(rateLimitIdentifier);
    } catch (error) {
      if (this.shouldCountRateLimitFailure(error)) await this.markRateLimitFailure(rateLimitIdentifier);
      throw error;
    }
  }

  private verifyTotpCode(secret: string, code: string): boolean {
    const normalized = code.trim();
    if (!/^\d{6}$/.test(normalized)) return false;

    const interval = this.getTotpIntervalSeconds();
    const windowSteps = this.getTotpWindowSteps();
    const nowCounter = Math.floor(Date.now() / 1000 / interval);

    for (let offset = -windowSteps; offset <= windowSteps; offset++)
      if (this.generateTotpAtCounter(secret, nowCounter + offset) === normalized) return true;

    return false;
  }

  private generateTotpAtCounter(secret: string, counter: number): string {
    const key = this.base32ToBuffer(secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuffer.writeUInt32BE(counter % 0x100000000, 4);

    const hmac = createHmac("sha1", key);
    hmac.update(counterBuffer);
    const digest = hmac.digest();

    const offset = digest[digest.length - 1]! & 0x0f;
    const binary =
      ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;

    const otp = binary % 10 ** TOTP_DIGITS;
    return otp.toString().padStart(TOTP_DIGITS, "0");
  }

  private parseRecoveryCodeHashes(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => String(item || "").trim()).filter(Boolean);
  }

  private hashRecoveryCode(code: string): string {
    return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
  }

  private normalizeVerifyPayload(payload: VerifyPayloadInput): VerifyPayload {
    const code = payload.code?.trim() || undefined;
    const recoveryCode = payload.recoveryCode?.trim() || undefined;
    const emailCode = payload.emailCode?.trim() || undefined;

    const provided = [Boolean(code), Boolean(recoveryCode), Boolean(emailCode)].filter(Boolean).length;
    if (provided !== 1) throw new UnauthorizedError("二次验证失败", CustomCode.TWO_FACTOR_CODE_INVALID);

    if (code) return { code };
    if (recoveryCode) return { recoveryCode };
    return { emailCode: emailCode! };
  }

  private findMatchingHashIndex(hashes: string[], targetHash: string): number {
    let matchedIndex = -1;

    // Iterate over all hashes to avoid leaking match-position timing information.
    for (let i = 0; i < hashes.length; i++) {
      const isMatch = this.constantTimeEqual(hashes[i]!, targetHash);
      if (isMatch && matchedIndex < 0) matchedIndex = i;
    }

    return matchedIndex;
  }

  private constantTimeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private generateRecoveryCodes(count: number): string[] {
    const codes = new Set<string>();
    while (codes.size < count) {
      const part = randomBytes(RECOVERY_CODE_BYTE_LENGTH)
        .toString("hex")
        .slice(0, RECOVERY_CODE_CHUNK * 2);
      const normalized = part.toUpperCase();
      const code = `${normalized.slice(0, RECOVERY_CODE_CHUNK)}-${normalized.slice(RECOVERY_CODE_CHUNK)}`;
      codes.add(code);
    }

    return Array.from(codes);
  }

  private generateOpaqueToken(bytes: number): string {
    return randomBytes(bytes).toString("base64url");
  }

  private generateBase32Secret(length: number): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes = randomBytes(length);
    let output = "";

    for (let i = 0; i < bytes.length; i++) {
      const index = bytes[i]! % alphabet.length;
      output += alphabet[index];
    }

    return output;
  }

  private base32ToBuffer(input: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const normalized = input.toUpperCase().replace(/=+$/, "");
    let bits = "";

    for (const char of normalized) {
      const value = alphabet.indexOf(char);
      if (value < 0) throw new Error("Invalid base32 secret");
      bits += value.toString(2).padStart(5, "0");
    }

    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      const chunk = bits.slice(i, i + 8);
      bytes.push(parseInt(chunk, 2));
    }

    return Buffer.from(bytes);
  }

  private async getSetupSessionOrThrow(setupToken: string): Promise<TwoFactorSetupSession> {
    const raw = await this.redisService.get(this.setupKey(setupToken));
    if (!raw) throw new BadRequestError("二次验证配置会话已过期", CustomCode.TWO_FACTOR_SETUP_SESSION_EXPIRED);

    return JSON.parse(raw) as TwoFactorSetupSession;
  }

  private async getLoginChallengeOrThrow(challengeToken: string): Promise<TwoFactorLoginChallenge> {
    const raw = await this.redisService.get(this.loginChallengeKey(challengeToken));
    if (!raw) throw new UnauthorizedError("二次验证会话已过期", CustomCode.TWO_FACTOR_CHALLENGE_EXPIRED);

    return JSON.parse(raw) as TwoFactorLoginChallenge;
  }

  private setupKey(setupToken: string): string {
    return `two_factor:setup:${setupToken}`;
  }

  private loginChallengeKey(challengeToken: string): string {
    return `two_factor:login_challenge:${challengeToken}`;
  }

  private getTrustWindowSeconds(): number {
    const minutes = Math.max(0, Number(EnvSpace.twoFactorTrustWindowMinutes));
    if (!Number.isFinite(minutes)) return 0;
    return Math.floor(minutes * 60);
  }

  private getTotpIntervalSeconds(): number {
    const configured = Number(EnvSpace.twoFactorConfig.totpIntervalSeconds);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TOTP_INTERVAL_SECONDS;
    return Math.floor(configured);
  }

  private getTotpWindowSteps(): number {
    const configured = Number(EnvSpace.twoFactorConfig.totpWindowSteps);
    if (!Number.isFinite(configured) || configured < 0) return 1;
    return Math.floor(configured);
  }

  private getRecoveryCodeCount(): number {
    const configured = Number(EnvSpace.twoFactorConfig.recoveryCodeCount);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_RECOVERY_CODE_COUNT;
    return Math.floor(configured);
  }

  private getReminderIntervalSeconds(): number {
    const configuredDays = Number(EnvSpace.twoFactorConfig.reminderIntervalDays);
    if (!Number.isFinite(configuredDays) || configuredDays <= 0) return 0;
    return Math.floor(configuredDays * 24 * 60 * 60);
  }

  private async recordTrustedDeviceMetric(metric: TrustedDeviceMetric): Promise<void> {
    try {
      const hourBucket = RedisService.getCurrentHourTimestamp();
      const key = `metrics:two_factor:trusted_device:${metric}:${hourBucket}`;
      await this.redisService.increment(key, TRUSTED_DEVICE_METRICS_TTL_SECONDS, 1);
    } catch (error) {
      // Metrics are best effort and must not affect auth flow.
      if (!EnvSpace.isProduction) logger.warn("Trusted-device metric recording failed", { metric, error });
    }
  }

  private trustedDeviceKey(userId: string, deviceId: string): string {
    return `two_factor:trusted:${userId}:${deviceId}`;
  }

  /**
   * 一次性临时可信令牌 key（用于高危接口的单次重试）
   * 使用后立即删除，确保只能使用一次
   */
  private oneTimeTrustedTokenKey(userId: string, nonce: string): string {
    return `two_factor:onetime:${userId}:${nonce}`;
  }

  private generateTrustedDeviceId(): string {
    return randomBytes(32).toString("hex");
  }

  private getTrustedDeviceSecret(): string {
    const configured = EnvSpace.trustedDeviceSecret;
    if (!configured) throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be configured");
    if (configured.length < TRUSTED_DEVICE_SECRET_MIN_LENGTH)
      throw new Error(
        `TWO_FACTOR_TRUSTED_DEVICE_SECRET must be at least ${TRUSTED_DEVICE_SECRET_MIN_LENGTH} characters`,
      );

    const accessSecret = EnvSpace.accessTokenSecret;
    if (accessSecret && configured === accessSecret)
      throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be different from JWT_ACCESS_SECRET");

    return configured;
  }

  private signTrustedDeviceTokenV1(userId: string, deviceId: string): string {
    return createHmac("sha256", this.getTrustedDeviceSecret())
      .update(`${TRUSTED_DEVICE_TOKEN_VERSION}:${userId}:${deviceId}`)
      .digest("base64url");
  }

  private signTrustedDeviceTokenLegacy(userId: string, deviceId: string): string {
    return createHmac("sha256", this.getTrustedDeviceSecret()).update(`${userId}:${deviceId}`).digest("base64url");
  }

  private createTrustedDeviceToken(userId: string, deviceId: string): string {
    const signature = this.signTrustedDeviceTokenV1(userId, deviceId);
    return `${TRUSTED_DEVICE_TOKEN_VERSION}.${deviceId}.${signature}`;
  }

  private parseTrustedDeviceToken(token?: string | null): ParsedTrustedDeviceToken | null {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) return null;

    const segments = normalizedToken.split(".");
    if (segments.length !== 2 && segments.length !== 3) return null;

    const hasVersionPrefix = segments.length === 3;
    const version = hasVersionPrefix
      ? String(segments[0] || "")
          .trim()
          .toLowerCase()
      : TRUSTED_DEVICE_TOKEN_LEGACY_VERSION;
    const rawDeviceId = hasVersionPrefix ? segments[1] : segments[0];
    const rawSignature = hasVersionPrefix ? segments[2] : segments[1];

    const deviceId = String(rawDeviceId || "")
      .trim()
      .toLowerCase();
    const signature = String(rawSignature || "").trim();

    if (!TRUSTED_DEVICE_ID_PATTERN.test(deviceId)) return null;
    if (!TRUSTED_DEVICE_SIGNATURE_PATTERN.test(signature)) return null;
    if (version !== TRUSTED_DEVICE_TOKEN_VERSION && version !== TRUSTED_DEVICE_TOKEN_LEGACY_VERSION) return null;

    return {
      version,
      deviceId,
      signature,
    };
  }

  private verifyTrustedDeviceToken(userId: string, token?: string | null): VerifiedTrustedDeviceToken | null {
    const parsed = this.parseTrustedDeviceToken(token);
    if (!parsed) return null;

    const expectedSignature =
      parsed.version === TRUSTED_DEVICE_TOKEN_VERSION
        ? this.signTrustedDeviceTokenV1(userId, parsed.deviceId)
        : this.signTrustedDeviceTokenLegacy(userId, parsed.deviceId);

    if (!this.constantTimeEqual(parsed.signature, expectedSignature)) return null;

    return {
      deviceId: parsed.deviceId,
    };
  }

  private extractTrustedDeviceIdFromKey(userId: string, key: string): string | null {
    const prefix = `two_factor:trusted:${userId}:`;
    if (!key.startsWith(prefix)) return null;

    const deviceId = key.slice(prefix.length).trim().toLowerCase();
    if (!TRUSTED_DEVICE_ID_PATTERN.test(deviceId)) return null;

    return deviceId;
  }

  private parseTrustedDeviceSnapshot(raw: string | null): TrustedDeviceSnapshot | null {
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<TrustedDeviceSnapshot>;
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.version !== 1) return null;
      if (typeof parsed.trustedAt !== "string") return null;
      if (Number.isNaN(Date.parse(parsed.trustedAt))) return null;

      const parsedLastUsedAt =
        typeof parsed.lastUsedAt === "string" && !Number.isNaN(Date.parse(parsed.lastUsedAt))
          ? parsed.lastUsedAt
          : parsed.trustedAt;

      return {
        version: 1,
        trustedAt: parsed.trustedAt,
        lastUsedAt: parsedLastUsedAt,
        ipAddress: this.normalizeTrustedDeviceText(parsed.ipAddress, "", TRUSTED_DEVICE_IP_MAX_LENGTH),
        userAgent: this.normalizeTrustedDeviceText(parsed.userAgent, "", TRUSTED_DEVICE_USER_AGENT_MAX_LENGTH),
        fingerprint: this.normalizeTrustedDeviceTextOrNull(parsed.fingerprint, TRUSTED_DEVICE_FINGERPRINT_MAX_LENGTH),
      };
    } catch {
      return null;
    }
  }

  private async findTrustedDeviceIdByFingerprint(userId: string, fingerprint: string): Promise<string | null> {
    if (!this.redisService.isRedisAvailable()) return null;

    const allTrustedKeys = await this.redisService.getKeysByPattern(
      `two_factor:trusted:${userId}:*`,
      TRUSTED_DEVICE_LIST_MAX,
    );
    if (!allTrustedKeys.length) return null;

    const uniqueKeys = Array.from(new Set(allTrustedKeys));
    const candidates = await Promise.all(
      uniqueKeys.map(async (key) => {
        const deviceId = this.extractTrustedDeviceIdFromKey(userId, key);
        if (!deviceId) return null;

        const [rawValue, ttlSeconds] = await Promise.all([this.redisService.get(key), this.redisService.ttl(key)]);
        const snapshot = this.parseTrustedDeviceSnapshot(rawValue);
        if (!snapshot || snapshot.fingerprint !== fingerprint) return null;

        const trustedAtMs = Date.parse(snapshot.trustedAt);
        return {
          deviceId,
          trustedAtMs: Number.isNaN(trustedAtMs) ? 0 : trustedAtMs,
          ttlSeconds: ttlSeconds !== null && ttlSeconds >= 0 ? ttlSeconds : -1,
        };
      }),
    );

    const matched = candidates
      .filter((item): item is { deviceId: string; trustedAtMs: number; ttlSeconds: number } => Boolean(item))
      .sort((left, right) => {
        if (left.trustedAtMs !== right.trustedAtMs) return right.trustedAtMs - left.trustedAtMs;
        return right.ttlSeconds - left.ttlSeconds;
      });

    return matched[0]?.deviceId || null;
  }

  private async clearDuplicateTrustedDevicesByFingerprint(
    userId: string,
    keepDeviceId: string,
    fingerprint: string,
  ): Promise<void> {
    if (!this.redisService.isRedisAvailable()) return;

    const allTrustedKeys = await this.redisService.getKeysByPattern(
      `two_factor:trusted:${userId}:*`,
      TRUSTED_DEVICE_LIST_MAX,
    );
    if (!allTrustedKeys.length) return;

    const uniqueKeys = Array.from(new Set(allTrustedKeys));
    const duplicateKeys = await Promise.all(
      uniqueKeys.map(async (key) => {
        const deviceId = this.extractTrustedDeviceIdFromKey(userId, key);
        if (!deviceId || deviceId === keepDeviceId) return null;

        const rawValue = await this.redisService.get(key);
        const snapshot = this.parseTrustedDeviceSnapshot(rawValue);
        if (!snapshot || snapshot.fingerprint !== fingerprint) return null;

        return key;
      }),
    );

    const keysToDelete = duplicateKeys.filter((key): key is string => Boolean(key));
    if (keysToDelete.length > 0) await this.redisService.deleteMany(keysToDelete);
  }

  private normalizeTrustedDeviceUserId(userId: string): string | null {
    const normalizedUserId = userId.trim();
    if (!TRUSTED_DEVICE_USER_ID_PATTERN.test(normalizedUserId)) return null;
    return normalizedUserId;
  }

  private normalizeTrustedDeviceText(value: unknown, fallback: string, maxLength: number): string {
    if (typeof value !== "string") return fallback;

    const normalized = value.trim();
    if (!normalized) return fallback;
    return normalized.slice(0, maxLength);
  }

  private normalizeTrustedDeviceTextOrNull(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;

    const normalized = value.trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
  }

  private async touchTrustedDeviceLastUsed(
    key: string,
    rawValue: string | null,
    ttlSeconds: number,
    context: TrustContext,
  ): Promise<void> {
    if (ttlSeconds <= 0) return;

    const nowIso = new Date().toISOString();
    const parsed = this.parseTrustedDeviceSnapshot(rawValue);

    const snapshot: TrustedDeviceSnapshot = {
      version: 1,
      trustedAt: parsed?.trustedAt || nowIso,
      lastUsedAt: nowIso,
      ipAddress:
        parsed?.ipAddress ||
        this.normalizeTrustedDeviceText(context.ipAddress, "unknown", TRUSTED_DEVICE_IP_MAX_LENGTH),
      userAgent:
        parsed?.userAgent ||
        this.normalizeTrustedDeviceText(context.userAgent, "", TRUSTED_DEVICE_USER_AGENT_MAX_LENGTH),
      fingerprint:
        parsed?.fingerprint ||
        this.normalizeTrustedDeviceTextOrNull(context.fingerprint, TRUSTED_DEVICE_FINGERPRINT_MAX_LENGTH),
    };

    await this.redisService.set(key, JSON.stringify(snapshot), ttlSeconds);
  }

  private trustedDeviceRevokedKey(userId: string, deviceId: string): string {
    return `two_factor:trusted:revoked:${userId}:${deviceId}`;
  }

  private async isTrustedDeviceOwnedByUser(userId: string, deviceId: string): Promise<boolean> {
    const key = this.trustedDeviceKey(userId, deviceId);
    const snapshot = await this.redisService.get(key);
    return Boolean(snapshot);
  }

  private async markTrustedDeviceRevoked(userId: string, deviceId: string): Promise<void> {
    await this.redisService.set(
      this.trustedDeviceRevokedKey(userId, deviceId),
      TRUSTED_DEVICE_REVOKE_MARKER_VALUE,
      TRUSTED_DEVICE_REVOKE_COOLDOWN_SECONDS,
    );
  }

  private async isTrustedDeviceRevoked(userId: string, deviceId: string): Promise<boolean> {
    const marker = await this.redisService.get(this.trustedDeviceRevokedKey(userId, deviceId));
    return Boolean(marker);
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split("@");
    if (!name || !domain) return email;
    if (name.length <= 2) return `${name[0] || "*"}*@${domain}`;

    const maskedName = `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}`;
    return `${maskedName}@${domain}`;
  }

  private reminderCooldownKey(userId: string): string {
    return `two_factor:reminder_cooldown:${userId}`;
  }

  private async clearLoginReminderCooldown(userId: string): Promise<void> {
    await this.redisService.delete(this.reminderCooldownKey(userId));
  }

  private rateLimitIdentifier(scope: string, identifier: string): string {
    return `two_factor:${scope}:${identifier}`;
  }

  private shouldCountRateLimitFailure(error: unknown): boolean {
    return error instanceof UnauthorizedError;
  }

  private rateLimitStateKey(identifier: string): string {
    return `two_factor:rate_limit:${identifier}`;
  }

  private async checkRateLimit(identifier: string): Promise<void> {
    await this.rateLimiterService.assertNamedBackoffRateLimit("twoFactorAttempt", {
      identifier,
    });
  }

  private async markRateLimitFailure(identifier: string): Promise<void> {
    await this.rateLimiterService.markNamedBackoffRateLimitFailure("twoFactorAttempt", {
      identifier,
    });
  }

  private async clearRateLimit(identifier: string): Promise<void> {
    await this.rateLimiterService.clearNamedBackoffRateLimit("twoFactorAttempt", { identifier });
  }

  private async dispatchTwoFactorStatusNotification(userId: string, enabled: boolean): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(userId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(NotificationEvent.TWO_FACTOR_STATUS_CHANGE)) return;

      NotificationService.getInstance().dispatch(userId, NotificationEvent.TWO_FACTOR_STATUS_CHANGE, {
        title: enabled ? "2FA 已开启" : "2FA 已关闭",
        content: enabled
          ? "您的账户已成功开启两步验证，账户安全性已提升。"
          : "您的账户已关闭两步验证。如非本人操作，请立即联系管理员。",
        data: { enabled },
      });
    } catch {
      // non-fatal
    }
  }
}
