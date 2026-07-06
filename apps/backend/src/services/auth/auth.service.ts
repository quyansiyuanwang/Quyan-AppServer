import { randomUUID } from "crypto";
import { JWTAccessIns, JWTRefreshIns } from "@/util/auth";
import { hashPassword } from "@/util/crypto";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyConsentRequiredError,
  TooManyRequestsError,
  UnauthorizedError,
} from "@/util/errors";
import { UserService } from "@/services/users/user.service";
import { UserRepository } from "@/store/users/user.repository";
import { GroupRepository } from "@/store/users/group.repository";
import type { UserStore } from "@/store/users/user.store";
import type { GroupStore } from "@/store/users/group.store";
import type { User, LegalPolicyVersion } from "@prisma/client";
import { CustomCode } from "@/constant/custom-code";
import BusinessLogService from "@/services/system/businesslog.service";
import { ConfigService } from "@/services/system/config.service";
import { EmailService } from "./email.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import type {
  AcceptPolicyConsentDto,
  AuthData,
  RegisterDto,
  ReplaySigningSessionData,
  ResetPasswordDto,
} from "@/api/dto/auth/auth.dto";
import type { Request } from "express";
import { validateAccountStatus } from "@/util/auth/account-status";
import { TwoFactorService } from "./two-factor.service";
import { extractClientFingerprint } from "@/util/client-fingerprint";
import { RedisService } from "@/services/infrastructure/redis.service";
import { LegalPolicyService } from "@/services/legal-policy/legal-policy.service";
import { LegalPolicyRepository } from "@/store/content/legal-policy.repository";
import type { LegalPolicyStore } from "@/store/content/legal-policy.store";
import { BusinessLogRepository } from "@/store/system/businesslog";
import type { BusinessLogStore } from "@/store/system/businesslog.store";
import type { LegalPolicyType } from "@/constant/legal-policy";
import {
  extractTrustedDeviceIdFromToken,
  extractTrustedDeviceToken,
  setTrustedDeviceTokenCookie,
} from "@/util/trusted-device-token";
import { clearRefreshTokenCookie, extractRefreshTokenCookie, setRefreshTokenCookie } from "@/util/auth-refresh-cookie";
import {
  buildForceOfflineAuthSessionKey,
  clearAuthSessionIdCookie,
  extractAuthSessionId,
  setAuthSessionIdCookie,
} from "@/util/auth-session";
import { clearCaptchaTrustCookie } from "@/util/captcha-trust-cookie";
import {
  buildReplaySigningSessionKey,
  createReplayProtectionUnavailableError,
  generateReplaySigningKey,
} from "@/util/replay-signing-session";
import { EnvSpace } from "@/config/env";
import { NotificationService } from "@/services/notification/notification.service";
import { NotificationEvent } from "@/constant/notification-event";
import { IpGeolocationService } from "@/services/infrastructure/ip-geolocation.service";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";

const getForceOfflineUserKey = (userId: string) => `user:force_offline:${userId}`;

interface PolicyConsentChallengePayload {
  userId: string;
  twoFactorEnabled: boolean;
  grantTrustedDevice: boolean;
  source: "password_login" | "two_factor_login" | "passkey_login";
}

interface CompleteAuthenticatedLoginOptions {
  twoFactorEnabled: boolean;
  grantTrustedDevice: boolean;
  source: PolicyConsentChallengePayload["source"];
  successDescription: string;
}

const POLICY_CONSENT_CHALLENGE_TTL_SECONDS = 10 * 60;

export class AuthService {
  constructor(
    private readonly userService: UserService = new UserService(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly emailService: EmailService = EmailService.getInstance(),
    private readonly twoFactorService: TwoFactorService = TwoFactorService.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
    private readonly legalPolicyService: LegalPolicyService = LegalPolicyService.getInstance(),
    private readonly legalPolicyRepository: LegalPolicyStore = LegalPolicyRepository.getInstance(),
    private readonly businessLogRepository: BusinessLogStore = BusinessLogRepository.getInstance(),
    private readonly rateLimiterService: RateLimiterService = RateLimiterService.getInstance(),
  ) {}

  private async issueAuthData(userId: string, status: number): Promise<AuthData> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UnauthorizedError("用户不存在", CustomCode.LOGIN_AUTH_FAILED);

    const updatedAt = user.updateTime.toISOString();
    const userDto = await this.userService.getUserById(user.id);
    if (!userDto) throw new UnauthorizedError("用户信息获取失败", CustomCode.LOGIN_AUTH_FAILED);

    return {
      access_token: JWTAccessIns.generateToken({ userId: user.id, updatedAt, status }),
      user: userDto,
    };
  }

  public async issueReplaySigningSession(request?: Request): Promise<ReplaySigningSessionData> {
    if (!this.redisService.isRedisAvailable()) throw createReplayProtectionUnavailableError();

    const sessionId = randomUUID();
    const fingerprint = request ? extractClientFingerprint(request) : undefined;
    const signingKey = generateReplaySigningKey(sessionId, fingerprint);
    const expiresIn = EnvSpace.replayProtectionConfig.signingSessionTtlSeconds;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await this.redisService.set(
      buildReplaySigningSessionKey(sessionId),
      JSON.stringify({
        signingKey,
        fingerprint,
        issuedAt: new Date().toISOString(),
        expiresAt,
      }),
      expiresIn,
    );

    return {
      sessionId,
      signingKey,
      algorithm: "HMAC-SHA256",
      expiresIn,
      expiresAt,
    };
  }

  /**
   * 获取客户端 IP 地址
   */
  private getClientIP(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  private getUserAgent(userAgent: string | string[] | undefined): string {
    if (Array.isArray(userAgent)) return userAgent[0] || "";
    return userAgent || "";
  }

  private policyConsentChallengeKey(challengeToken: string): string {
    return `auth:policy_consent:${challengeToken}`;
  }

  private async getCurrentPoliciesForConsent(required = true): Promise<LegalPolicyVersion[]> {
    try {
      return await this.legalPolicyService.getCurrentPublishedPolicyEntities();
    } catch (error) {
      if (error instanceof NotFoundError) {
        if (!required) return [];

        throw new BadRequestError("服务协议或隐私政策尚未发布，暂时无法完成当前操作");
      }

      throw error;
    }
  }

  private async createPolicyConsentChallenge(payload: PolicyConsentChallengePayload): Promise<{
    challengeToken: string;
    expiresIn: number;
  }> {
    const challengeToken = randomUUID();

    await this.redisService.set(
      this.policyConsentChallengeKey(challengeToken),
      JSON.stringify(payload),
      POLICY_CONSENT_CHALLENGE_TTL_SECONDS,
    );

    return {
      challengeToken,
      expiresIn: POLICY_CONSENT_CHALLENGE_TTL_SECONDS,
    };
  }

  private async consumePolicyConsentChallenge(challengeToken: string): Promise<PolicyConsentChallengePayload> {
    const key = this.policyConsentChallengeKey(challengeToken);
    const raw = await this.redisService.get(key);
    if (!raw) throw new UnauthorizedError("协议确认会话已过期，请重新登录", CustomCode.AUTH_FAILED);

    await this.redisService.delete(key);

    try {
      return JSON.parse(raw) as PolicyConsentChallengePayload;
    } catch {
      throw new UnauthorizedError("协议确认会话无效，请重新登录", CustomCode.AUTH_FAILED);
    }
  }

  private async assertCurrentPolicyConsentOrThrow(
    userId: string,
    options: Pick<CompleteAuthenticatedLoginOptions, "twoFactorEnabled" | "grantTrustedDevice" | "source">,
  ): Promise<void> {
    const currentPolicies = await this.getCurrentPoliciesForConsent(false);
    if (currentPolicies.length === 0) return;

    const policyVersionIds = currentPolicies.map((policy) => policy.id);
    const acceptedPolicyVersionIds = await this.legalPolicyRepository.findAcceptedPolicyVersionIds(
      userId,
      policyVersionIds,
    );

    if (acceptedPolicyVersionIds.length === policyVersionIds.length) return;

    const challenge = await this.createPolicyConsentChallenge({
      userId,
      twoFactorEnabled: options.twoFactorEnabled,
      grantTrustedDevice: options.grantTrustedDevice,
      source: options.source,
    });

    throw new PolicyConsentRequiredError("需要同意最新服务协议和隐私政策", {
      requiresPolicyConsent: true,
      challengeToken: challenge.challengeToken,
      expiresIn: challenge.expiresIn,
    });
  }

  private async recordPolicyAcceptances(
    userId: string,
    policies: LegalPolicyVersion[],
    request: Request | undefined,
    source: string,
  ): Promise<void> {
    const policyVersionIds = policies.map((policy) => policy.id);
    const acceptedPolicyVersionIds = await this.legalPolicyRepository.findAcceptedPolicyVersionIds(
      userId,
      policyVersionIds,
    );
    const acceptedSet = new Set(acceptedPolicyVersionIds);
    const pendingPolicies = policies.filter((policy) => !acceptedSet.has(policy.id));

    if (pendingPolicies.length === 0) return;

    const ipAddress = request ? this.getClientIP(request) : "unknown";
    const userAgent = request?.headers["user-agent"];
    const requestId = request?.headers["x-request-id"] as string | undefined;

    await Promise.all(
      pendingPolicies.map((policy) =>
        this.legalPolicyRepository.createAcceptance({
          userId,
          policyVersionId: policy.id,
          policyType: policy.policyType as LegalPolicyType,
          source,
          ipAddress,
          userAgent: this.getUserAgent(userAgent),
        }),
      ),
    );

    await this.businessLogService.logOperation({
      operationType: OperationType.LEGAL_POLICY_ACCEPT,
      operationCategory: OperationCategory.LEGAL_POLICY,
      actorUserId: userId,
      targetUserId: userId,
      description: "用户同意最新服务协议和隐私政策",
      success: true,
      metadata: {
        source,
        policyVersionIds: pendingPolicies.map((policy) => policy.id),
        policyTypes: pendingPolicies.map((policy) => policy.policyType),
      },
      ipAddress,
      userAgent,
      requestId,
    });
  }

  private extractBearerAccessToken(request?: Request): string | undefined {
    const authHeader = request?.headers["authorization"];
    if (!authHeader || typeof authHeader !== "string") return undefined;

    const normalized = authHeader.trim();
    if (!normalized) return undefined;

    if (/^Bearer\s+/i.test(normalized)) {
      const token = normalized.replace(/^Bearer\s+/i, "").trim();
      return token || undefined;
    }

    return undefined;
  }

  private async finalizeAuthenticatedLogin(
    user: User,
    request: Request | undefined,
    options: CompleteAuthenticatedLoginOptions,
  ): Promise<AuthData> {
    const ipAddress = request ? this.getClientIP(request) : "unknown";
    const userAgent = request?.headers["user-agent"];
    const normalizedUserAgent = this.getUserAgent(userAgent);
    const fingerprint = request ? extractClientFingerprint(request) : undefined;
    const trustedDeviceToken = request ? extractTrustedDeviceToken(request) : undefined;
    const requestId = request?.headers["x-request-id"] as string | undefined;

    const authData = (await this.issueAuthData(user.id, user.status)) as AuthData & {
      refresh_token?: string;
    };

    await this.redisService.delete(getForceOfflineUserKey(user.id));

    const refreshToken = JWTRefreshIns.generateToken({
      userId: user.id,
      updatedAt: user.updateTime.toISOString(),
      status: user.status,
    });

    if (request) {
      setRefreshTokenCookie(request, refreshToken);
      setAuthSessionIdCookie(request);
    } else authData.refresh_token = refreshToken;

    if (options.grantTrustedDevice) {
      const trustedGrant = await this.twoFactorService.markTrustedWithinWindow(user.id, {
        ipAddress,
        userAgent: normalizedUserAgent,
        fingerprint,
        trustedDeviceToken,
      });

      const oneTimeToken = await this.twoFactorService.createOneTimeTrustedToken(user.id, 30);

      if (request && trustedGrant)
        setTrustedDeviceTokenCookie(request, trustedGrant.trustedDeviceToken, trustedGrant.expiresIn);

      if (trustedGrant)
        await this.businessLogService.logOperation({
          operationType: OperationType.TWO_FACTOR_TRUSTED_DEVICE_CREATE,
          operationCategory: OperationCategory.AUTH,
          actorUserId: user.id,
          targetUserId: user.id,
          targetResourceType: "TWO_FACTOR_TRUSTED_DEVICE",
          targetResourceId: extractTrustedDeviceIdFromToken(trustedGrant.trustedDeviceToken),
          description: "二次验证通过后创建可信设备窗口记录（长期）+ 一次性令牌（用于重试）",
          success: true,
          metadata: {
            expiresInSeconds: trustedGrant.expiresIn,
            channel: options.source,
            oneTimeToken: oneTimeToken.substring(0, 8) + "...",
          },
          ipAddress,
          userAgent: normalizedUserAgent,
          requestId,
        });

      authData.oneTimeToken = oneTimeToken;
    }

    const twoFactorReminder = await this.twoFactorService.consumeLoginReminder(user.id, options.twoFactorEnabled);
    if (twoFactorReminder) authData.twoFactorReminder = twoFactorReminder;

    await this.businessLogService.logOperation({
      operationType: OperationType.LOGIN_SUCCESS,
      operationCategory: OperationCategory.AUTH,
      actorUserId: user.id,
      description: options.successDescription,
      success: true,
      ipAddress,
      userAgent,
      requestId,
    });

    // Abnormal login detection: IP geolocation change + non-trusted device
    if (!options.grantTrustedDevice && ipAddress !== "unknown")
      this.checkAbnormalLogin(user.id, ipAddress).catch(() => {});

    return authData;
  }

  public async completeAuthenticatedLogin(
    user: User,
    request: Request | undefined,
    options: CompleteAuthenticatedLoginOptions,
  ): Promise<AuthData> {
    validateAccountStatus(user.status, user.id, "login");

    await this.assertCurrentPolicyConsentOrThrow(user.id, options);

    return this.finalizeAuthenticatedLogin(user, request, options);
  }

  /**
   * Fire-and-forget: checks if the current login IP geolocation differs from the
   * previous successful login. If so, dispatches an ABNORMAL_LOGIN notification.
   */
  private async checkAbnormalLogin(userId: string, currentIp: string): Promise<void> {
    try {
      const geoService = IpGeolocationService.getInstance();
      const notificationService = NotificationService.getInstance();

      // Find the most recent previous LOGIN_SUCCESS for this user (skip the one just logged)
      const [previousLogin] = await this.businessLogRepository.findMany(
        {
          actorUserId: userId,
          operationType: OperationType.LOGIN_SUCCESS,
          ipAddress: { not: undefined },
        },
        {
          orderBy: { createTime: "desc" },
          skip: 1,
          take: 1,
        },
      );

      if (!previousLogin?.ipAddress) return;

      const [currentLocation, previousLocation] = await Promise.all([
        geoService.getLocation(currentIp),
        geoService.getLocation(previousLogin.ipAddress),
      ]);

      if (currentLocation !== previousLocation && currentLocation !== "未知地区" && previousLocation !== "未知地区")
        notificationService.dispatch(userId, NotificationEvent.ABNORMAL_LOGIN, {
          title: "账户异常登录提醒",
          content: `检测到您的账户从新地区登录，请确认是否为本人操作。`,
          data: {
            currentIp,
            currentLocation,
            previousLocation,
          },
        });
    } catch {
      // Non-fatal — never block login flow
    }
  }

  async login(username: string, password: string, request?: Request) {
    const ipAddress = request ? this.getClientIP(request) : "unknown";
    const userAgent = request?.headers["user-agent"];
    const normalizedUserAgent = this.getUserAgent(userAgent);
    const fingerprint = request ? extractClientFingerprint(request) : undefined;
    const trustedDeviceToken = request ? extractTrustedDeviceToken(request) : undefined;
    const requestId = request?.headers["x-request-id"] as string | undefined;

    // 登录频率限制：per-IP + per-account
    // 测试环境下跳过频率限制
    if (this.redisService.isRedisAvailable() && process.env.NODE_ENV !== "test") {
      const rateLimitCheck = await this.rateLimiterService.checkNamedRedisWindowRateLimit("login", {
        ipAddress,
        username,
      });
      if (!rateLimitCheck.allowed) {
        const isUserScoped = rateLimitCheck.reason === "LOGIN_USER_RATE_LIMIT_EXCEEDED";
        throw new TooManyRequestsError(
          isUserScoped ? "该账号登录尝试过于频繁，请稍后再试" : "登录尝试过于频繁，请稍后再试",
          rateLimitCheck.retryAfter || 60,
        );
      }

      await this.rateLimiterService.consumeNamedRedisWindowRateLimit("login", { ipAddress, username });
    }

    try {
      const user = await this.userRepository.findByUsername(username);
      if (!user) throw new UnauthorizedError("用户名或密码错误", CustomCode.LOGIN_AUTH_FAILED);

      const match = hashPassword(password) === user.password;
      if (!match) throw new UnauthorizedError("用户名或密码错误", CustomCode.LOGIN_AUTH_FAILED);

      // Check whether the account can log in based on AccountStatus.
      validateAccountStatus(user.status, user.id, "login");

      const twoFactorEnabled = await this.twoFactorService.isTwoFactorEnabled(user.id);
      if (twoFactorEnabled) {
        const trustedWithinWindow = await this.twoFactorService.isTrustedWithinWindow(user.id, {
          ipAddress,
          userAgent: normalizedUserAgent,
          fingerprint,
          trustedDeviceToken,
        });

        await this.businessLogService.logOperation({
          operationType: OperationType.TWO_FACTOR_TRUSTED_DEVICE_VERIFY,
          operationCategory: OperationCategory.AUTH,
          actorUserId: user.id,
          targetUserId: user.id,
          description: trustedWithinWindow ? "密码登录可信设备校验命中" : "密码登录可信设备校验未命中",
          success: true,
          metadata: {
            trustedWithinWindow,
            channel: "password_login",
          },
          ipAddress,
          userAgent: normalizedUserAgent,
          requestId,
        });

        if (!trustedWithinWindow) {
          const challenge = await this.twoFactorService.createLoginChallenge(user.id);
          return {
            requiresTwoFactor: true as const,
            challengeToken: challenge.challengeToken,
            expiresIn: challenge.expiresIn,
          };
        }
      }

      return this.completeAuthenticatedLogin(user, request, {
        twoFactorEnabled,
        grantTrustedDevice: false,
        source: "password_login",
        successDescription: `用户 '${user.username}' 登录成功`,
      });
    } catch (error) {
      if (error instanceof PolicyConsentRequiredError) throw error;

      // 记录失败登录
      const failedUser = await this.userRepository.findByUsername(username).catch(() => null);
      await this.businessLogService.logOperation({
        operationType: OperationType.LOGIN_FAILED,
        operationCategory: OperationCategory.AUTH,
        actorUserId: failedUser?.id,
        description: `用户 '${username}' 登录失败: ${error.message}`,
        success: false,
        errorMessage: error.message,
        ipAddress,
        userAgent,
        requestId,
      });

      // Multiple login failure notification (fire-and-forget)
      if (failedUser) this.checkMultipleLoginFailures(failedUser.id).catch(() => {});

      throw error;
    }
  }

  /**
   * Fire-and-forget: counts recent LOGIN_FAILED events for the user.
   * Dispatches LOGIN_FAILED_MULTIPLE notification if >= 5 failures in the last 30 minutes.
   */
  private async checkMultipleLoginFailures(userId: string): Promise<void> {
    try {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000);
      const failCount = await this.businessLogRepository.count({
        actorUserId: userId,
        operationType: OperationType.LOGIN_FAILED,
        createTime: { gte: windowStart },
      });

      if (failCount >= 5)
        NotificationService.getInstance().dispatch(userId, NotificationEvent.LOGIN_FAILED_MULTIPLE, {
          title: "多次登录失败提醒",
          content: `您的账户在过去 30 分钟内发生了 ${failCount} 次登录失败，请确认账号安全。`,
          data: { failCount, windowMinutes: 30 },
        });
    } catch {
      // Non-fatal
    }
  }

  async verifyTwoFactorLogin(
    challengeToken: string,
    code: string | undefined,
    recoveryCode: string | undefined,
    emailCode: string | undefined,
    request?: Request,
  ) {
    const ipAddress = request ? this.getClientIP(request) : "unknown";
    const userAgent = request?.headers["user-agent"];
    const _normalizedUserAgent = this.getUserAgent(userAgent);
    const _fingerprint = request ? extractClientFingerprint(request) : undefined;
    const _trustedDeviceToken = request ? extractTrustedDeviceToken(request) : undefined;
    const requestId = request?.headers["x-request-id"] as string | undefined;

    try {
      const userId = await this.twoFactorService.verifyLoginChallenge(challengeToken, {
        code,
        recoveryCode,
        emailCode,
      });

      const user = await this.userRepository.findById(userId);
      if (!user) throw new UnauthorizedError("用户不存在", CustomCode.LOGIN_AUTH_FAILED);

      return this.completeAuthenticatedLogin(user, request, {
        twoFactorEnabled: true,
        grantTrustedDevice: true,
        source: "two_factor_login",
        successDescription: `用户 '${user.username}' 二次验证登录成功`,
      });
    } catch (error) {
      if (error instanceof PolicyConsentRequiredError) throw error;

      await this.businessLogService.logOperation({
        operationType: OperationType.LOGIN_FAILED,
        operationCategory: OperationCategory.AUTH,
        description: `二次验证登录失败: ${error.message}`,
        success: false,
        errorMessage: error.message,
        ipAddress,
        userAgent,
        requestId,
      });
      throw error;
    }
  }

  async refresh(requestOrToken?: Request | string, refreshTokenFromBody?: string) {
    const request = typeof requestOrToken === "string" ? undefined : requestOrToken;
    const refreshTokenFromArg = typeof requestOrToken === "string" ? requestOrToken : undefined;
    const refreshToken =
      (request ? extractRefreshTokenCookie(request) : undefined) || refreshTokenFromArg || refreshTokenFromBody;

    if (!refreshToken) throw new UnauthorizedError("缺少刷新令牌");

    let payload;
    try {
      payload = await JWTRefreshIns.verifyToken(refreshToken);
    } catch (_error) {
      throw new UnauthorizedError("无效的刷新令牌");
    }
    if (!payload || !payload.userId) throw new UnauthorizedError("无效的刷新令牌");

    // 验证用户的updatedAt是否与token中的一致
    const user = await this.userRepository.findById(payload.userId);
    if (!user) throw new UnauthorizedError("用户不存在");

    // 检查token中是否包含updatedAt字段（兼容旧token）
    if (!payload.updatedAt)
      throw new UnauthorizedError("Token版本过旧，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);

    const currentUpdatedAt = user.updateTime.toISOString();
    if (payload.updatedAt !== currentUpdatedAt)
      throw new UnauthorizedError("用户信息已更新，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);

    // 检查账号状态（refresh token 时必须检查数据库中的最新状态）
    validateAccountStatus(user.status, payload.userId, "refresh");

    const forcedOffline = await this.redisService.get(getForceOfflineUserKey(payload.userId));
    if (forcedOffline)
      throw new UnauthorizedError("用户已被强制下线，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);

    const authSessionId = request ? extractAuthSessionId(request) : undefined;
    if (authSessionId) {
      const forcedSession = await this.redisService.get(buildForceOfflineAuthSessionKey(authSessionId));
      if (forcedSession)
        throw new UnauthorizedError("当前会话已被强制结束，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);
    }

    const newAccessToken = JWTAccessIns.generateToken({
      userId: payload.userId,
      updatedAt: currentUpdatedAt,
      status: user.status,
    });
    return {
      access_token: newAccessToken,
    };
  }

  async verify(accessToken: string, request?: Request) {
    let payload;
    try {
      payload = await JWTAccessIns.verifyToken(accessToken);
    } catch (_error) {
      throw new UnauthorizedError("无效的访问令牌");
    }
    if (!payload || !payload.userId) throw new UnauthorizedError("无效的访问令牌");

    // 验证用户的updatedAt是否与token中的一致
    const user = await this.userRepository.findById(payload.userId);
    if (!user) throw new UnauthorizedError("用户不存在");

    // 检查token中是否包含updatedAt字段（兼容旧token）
    if (!payload.updatedAt)
      throw new UnauthorizedError("Token版本过旧，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);

    const currentUpdatedAt = user.updateTime.toISOString();
    const forcedOffline = await this.redisService.get(getForceOfflineUserKey(payload.userId));
    if (forcedOffline)
      throw new UnauthorizedError("用户已被强制下线，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);

    const authSessionId = request ? extractAuthSessionId(request) : undefined;
    if (authSessionId) {
      const forcedSession = await this.redisService.get(buildForceOfflineAuthSessionKey(authSessionId));
      if (forcedSession)
        throw new UnauthorizedError("当前会话已被强制结束，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);
    }

    if (payload.updatedAt !== currentUpdatedAt)
      throw new UnauthorizedError("用户信息已更新，请重新登录", CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE);

    return {
      userId: payload.userId,
    };
  }

  async register(data: RegisterDto, request?: Request): Promise<{ message: string }> {
    const ipAddress = request ? this.getClientIP(request) : "unknown";
    const userAgent = request?.headers["user-agent"];
    const requestId = request?.headers["x-request-id"] as string | undefined;

    if (!data.agreedToLegalPolicies)
      throw new BadRequestError("请先同意服务协议和隐私政策", CustomCode.VALIDATION_FAILED);

    const currentPolicies = await this.getCurrentPoliciesForConsent();

    // 1. Check registration enabled
    const regConfig = await this.configService.getRegistrationConfig();
    if (!regConfig.enabled) throw new BadRequestError("注册功能未开启", CustomCode.REGISTRATION_DISABLED);

    // 2. Verify email code
    const codeValid = await this.emailService.verifyCode(data.email, data.verificationCode);
    if (!codeValid) throw new BadRequestError("验证码无效或已过期", CustomCode.VERIFICATION_CODE_INVALID);

    // 3. Check email account limit
    const emailAccountCount = await this.userRepository.countActiveByEmail(data.email);
    if (emailAccountCount >= regConfig.maxAccountsPerEmail)
      throw new BadRequestError("该邮箱已达注册上限", CustomCode.EMAIL_LIMIT_REACHED);

    // 4. Check username uniqueness
    const existing = await this.userRepository.findByUsername(data.username);
    if (existing) throw new BadRequestError("用户名已存在");

    // 5. Get default group
    const defaultGroup = await this.groupRepository.findActiveByUsername(regConfig.defaultGroupUsername);
    if (!defaultGroup) throw new InternalServerError("默认用户组不存在");

    // 6. Create user (password already hashed by client)
    const user = await this.userRepository.create({
      username: data.username,
      password: hashPassword(data.password),
      email: data.email,
      name: data.nickname || null,
      groupId: defaultGroup.id,
      permissionAdds: [],
      permissionRemoves: [],
    });

    await this.recordPolicyAcceptances(user.id, currentPolicies, request, "register");

    // 7. Log
    await this.businessLogService.logOperation({
      operationType: OperationType.USER_CREATE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: user.id,
      targetUserId: user.id,
      targetResourceType: "USER",
      description: `用户 '${user.username}' 通过注册创建账号`,
      success: true,
      ipAddress,
      userAgent,
      requestId,
    });

    return { message: "注册成功" };
  }

  async acceptPolicyConsent(data: AcceptPolicyConsentDto, request?: Request): Promise<AuthData> {
    if (!data.agreedToLegalPolicies)
      throw new BadRequestError("请先同意服务协议和隐私政策", CustomCode.VALIDATION_FAILED);

    const challenge = await this.consumePolicyConsentChallenge(data.challengeToken);
    const user = await this.userRepository.findById(challenge.userId);
    if (!user) throw new UnauthorizedError("用户不存在", CustomCode.LOGIN_AUTH_FAILED);

    validateAccountStatus(user.status, user.id, "login");

    const currentPolicies = await this.getCurrentPoliciesForConsent(false);
    if (currentPolicies.length > 0)
      await this.recordPolicyAcceptances(user.id, currentPolicies, request, `${challenge.source}_consent`);

    return this.finalizeAuthenticatedLogin(user, request, {
      twoFactorEnabled: challenge.twoFactorEnabled,
      grantTrustedDevice: challenge.grantTrustedDevice,
      source: challenge.source,
      successDescription: `用户 '${user.username}' 同意最新协议后登录成功`,
    });
  }

  async sendPasswordResetCode(username: string, email: string): Promise<void> {
    const user = await this.userRepository.findActiveByUsernameAndEmail(username, email);
    if (!user) throw new BadRequestError("用户名与邮箱不匹配");

    validateAccountStatus(user.status, user.id, "password_reset_send_code");

    await this.emailService.sendPasswordResetCode(email);
  }

  async resetPassword(data: ResetPasswordDto, request?: Request): Promise<{ message: string }> {
    const user = await this.userRepository.findActiveByUsernameAndEmail(data.username, data.email);
    if (!user) throw new BadRequestError("用户名与邮箱不匹配");

    validateAccountStatus(user.status, user.id, "password_reset");

    const codeValid = await this.emailService.verifyCode(data.email, data.verificationCode);
    if (!codeValid) throw new BadRequestError("验证码无效或已过期", CustomCode.VERIFICATION_CODE_INVALID);

    await this.userService.changeUserPassword(user.id, hashPassword(data.newPassword), user.id, request);

    return { message: "密码重置成功" };
  }

  async sendVerificationCode(email: string): Promise<void> {
    await this.emailService.sendVerificationCode(email);
  }

  async sendTwoFactorEmailCode(challengeToken: string): Promise<{ message: string; maskedEmail?: string }> {
    return this.twoFactorService.sendLoginEmailCode(challengeToken);
  }

  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    await JWTAccessIns.revokeToken(accessToken);
    if (refreshToken) await JWTRefreshIns.revokeToken(refreshToken);
  }

  async logoutWithRequest(request?: Request, accessToken?: string, refreshTokenFromBody?: string): Promise<void> {
    const resolvedAccessToken = accessToken || this.extractBearerAccessToken(request);
    const refreshToken = (request ? extractRefreshTokenCookie(request) : undefined) || refreshTokenFromBody;

    if (resolvedAccessToken) await JWTAccessIns.revokeToken(resolvedAccessToken);
    if (refreshToken) await JWTRefreshIns.revokeToken(refreshToken);
    if (request) {
      clearRefreshTokenCookie(request);
      clearAuthSessionIdCookie(request);
      clearCaptchaTrustCookie(request);
    }
  }
}
