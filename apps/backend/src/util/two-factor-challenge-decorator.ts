import type { Response, NextFunction } from "express";
import { Extension } from "@tsoa/runtime";
import { TwoFactorService } from "@/services/auth/two-factor.service";
import { extractClientIp } from "@/util/ip-extractor";
import type { TypedRequest } from "@/types/express";
import { TwoFactorRequiredError } from "@/util/errors";
import { extractClientFingerprint } from "@/util/client-fingerprint";
import { extractTrustedDeviceToken } from "@/util/trusted-device-token";
import BusinessLogService from "@/services/system/businesslog.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";

export type TwoFactorChallengeMethod = "code" | "email" | "passkey";
export type TwoFactorChallengePurpose = "stepup" | "disable2fa" | "login";

export interface TwoFactorChallengeOptions {
  method?: TwoFactorChallengeMethod;
  purpose?: TwoFactorChallengePurpose;
  redirect?: string;
  message?: string;
  /**
   * 是否每次都要求 2FA 验证（使用临时可信窗口）
   * true: 高危操作，验证后建立 30 秒临时窗口，只允许重试一次
   * false/undefined: 中等风险操作，验证后建立长期可信窗口（默认 3 天）
   */
  alwaysRequire?: boolean;
}

const resolveUserAgent = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
};

const resolveRequestId = (req: TypedRequest): string | undefined => {
  const requestId = req.headers["x-request-id"];
  if (Array.isArray(requestId)) return requestId[0];
  if (typeof requestId === "string") return requestId;
  return undefined;
};

const hasAuthenticatedUser = (req: TypedRequest): req is TypedRequest & { user: { userId: string } } =>
  Boolean(req.user && typeof req.user.userId === "string" && req.user.userId.trim().length > 0);

const normalizeOptions = (
  options?: TwoFactorChallengeOptions,
): Required<Pick<TwoFactorChallengeOptions, "method" | "purpose" | "message" | "alwaysRequire">> &
  Pick<TwoFactorChallengeOptions, "redirect"> => ({
  method: options?.method || "code",
  purpose: options?.purpose || "stepup",
  message: options?.message || "当前操作需要二次验证",
  alwaysRequire: options?.alwaysRequire || false,
  ...(options?.redirect ? { redirect: options.redirect } : {}),
});

/**
 * 二次验证挑战装饰器（用于 OpenAPI 扩展元数据）
 */
export function TwoFactorChallengeProtected(options?: TwoFactorChallengeOptions) {
  return Extension("x-two-factor-challenge", {
    required: true,
    ...normalizeOptions(options),
  });
}

/**
 * 二次验证挑战中间件（用于运行时校验）
 */
export function twoFactorChallengeMiddleware(
  options?: TwoFactorChallengeOptions,
): (req: TypedRequest, res: Response, next: NextFunction) => Promise<void> {
  const twoFactorService = TwoFactorService.getInstance();
  const businessLogService = BusinessLogService.getInstance();
  const resolved = normalizeOptions(options);

  return async (req: TypedRequest, _res: Response, next: NextFunction) => {
    try {
      if (!hasAuthenticatedUser(req)) return next();
      const userId = req.user.userId;

      const enabled = await twoFactorService.isTwoFactorEnabled(userId);
      if (!enabled) return next();

      // 检查一次性令牌（所有接口都检查，只验证不消费）
      const oneTimeToken = req.headers["x-onetime-token"] as string | undefined;
      const oneTimeTokenValid = await twoFactorService.verifyOneTimeTrustedToken(userId, oneTimeToken);

      if (oneTimeTokenValid) {
        void businessLogService.logOperation({
          operationType: OperationType.TWO_FACTOR_TRUSTED_DEVICE_VERIFY,
          operationCategory: OperationCategory.AUTH,
          actorUserId: userId,
          targetUserId: userId,
          description: `2FA 挑战中间件一次性令牌验证通过（purpose=${resolved.purpose}, alwaysRequire=${resolved.alwaysRequire}）`,
          success: true,
          metadata: {
            oneTimeTokenUsed: true,
            alwaysRequire: resolved.alwaysRequire,
            channel: "challenge_middleware",
            purpose: resolved.purpose,
            method: resolved.method,
          },
          ipAddress: extractClientIp(req),
          userAgent: resolveUserAgent(req.headers["user-agent"]),
          requestId: resolveRequestId(req),
        });

        return next(); // 一次性令牌有效，放行
      }

      // 检查长期可信设备窗口（对于 alwaysRequire 接口，即使在窗口内也不放行）
      const trusted = await twoFactorService.isTrustedWithinWindow(userId, {
        ipAddress: extractClientIp(req),
        userAgent: resolveUserAgent(req.headers["user-agent"]),
        fingerprint: extractClientFingerprint(req),
        trustedDeviceToken: extractTrustedDeviceToken(req),
      });

      void businessLogService.logOperation({
        operationType: OperationType.TWO_FACTOR_TRUSTED_DEVICE_VERIFY,
        operationCategory: OperationCategory.AUTH,
        actorUserId: userId,
        targetUserId: userId,
        description: resolved.alwaysRequire
          ? `2FA 挑战中间件强制验证（purpose=${resolved.purpose}, alwaysRequire=true, 长期窗口=${trusted}）`
          : trusted
            ? `2FA 挑战中间件可信设备校验命中（purpose=${resolved.purpose}）`
            : `2FA 挑战中间件可信设备校验未命中（purpose=${resolved.purpose}）`,
        success: true,
        metadata: {
          trustedWithinWindow: trusted,
          alwaysRequire: resolved.alwaysRequire,
          channel: "challenge_middleware",
          purpose: resolved.purpose,
          method: resolved.method,
        },
        ipAddress: extractClientIp(req),
        userAgent: resolveUserAgent(req.headers["user-agent"]),
        requestId: resolveRequestId(req),
      });

      // 对于非 alwaysRequire 接口，如果在长期窗口内，放行
      if (!resolved.alwaysRequire && trusted) return next();

      // 需要 2FA 验证
      const challenge = await twoFactorService.createLoginChallenge(userId);

      throw new TwoFactorRequiredError(resolved.message, {
        challengeToken: challenge.challengeToken,
        expiresIn: challenge.expiresIn,
        method: resolved.method,
        purpose: resolved.purpose,
        ...(resolved.redirect ? { redirect: resolved.redirect } : {}),
      });
    } catch (error) {
      next(error as Error);
    }
  };
}
