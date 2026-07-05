import type { Request } from "express";
import { rateLimitMiddleware } from "@/middleware/rate-limit.middleware";
import { RateLimiterService } from "@/services/infrastructure/rate-limiter.service";
import { extractClientIp } from "@/util/ip-extractor";
import { NotFoundError, TooManyRequestsError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";

const rateLimiterService = RateLimiterService.getInstance();

const createTooManyRequestsError = (reason?: string, retryAfter?: number): TooManyRequestsError => {
  const message = rateLimiterService.getRateLimitErrorDescriptor(reason);
  return new TooManyRequestsError(message.message, retryAfter, undefined, {
    messageKey: message.key,
  });
};

const getRequiredUserId = (request: Request): string => {
  const userId = (request as TypedRequest).user?.userId;
  if (!userId) throw new NotFoundError("用户信息不存在", undefined, { messageKey: "user.userInfoNotFound" });
  return userId;
};

export const verifyTwoFactorRateLimitMiddleware = rateLimitMiddleware({
  check: async (request) => {
    const clientIp = extractClientIp(request);
    const challengeToken = String(request.body?.challengeToken || "");
    return rateLimiterService.checkNamedRedisWindowRateLimit("twoFactorVerification", {
      ipAddress: clientIp,
      challengeToken,
    });
  },
  consume: async (request) => {
    const clientIp = extractClientIp(request);
    const challengeToken = String(request.body?.challengeToken || "");
    await rateLimiterService.consumeNamedRedisWindowRateLimit("twoFactorVerification", {
      ipAddress: clientIp,
      challengeToken,
    });
  },
  consumeWhen: "before-handler",
  createError: (result) => createTooManyRequestsError(result.reason, result.retryAfter),
});

export const twoFactorEmailSendRateLimitMiddleware = rateLimitMiddleware({
  check: async (request) => {
    const clientIp = extractClientIp(request);
    const challengeToken = String(request.body?.challengeToken || "");
    return rateLimiterService.checkNamedRedisWindowRateLimit("twoFactorEmailSend", {
      ipAddress: clientIp,
      challengeToken,
    });
  },
  consume: async (request) => {
    const clientIp = extractClientIp(request);
    const challengeToken = String(request.body?.challengeToken || "");
    await rateLimiterService.consumeNamedRedisWindowRateLimit("twoFactorEmailSend", {
      ipAddress: clientIp,
      challengeToken,
    });
  },
  consumeWhen: "before-handler",
  createError: (result) => createTooManyRequestsError(result.reason, result.retryAfter),
});

export const emailVerificationRateLimitMiddleware = rateLimitMiddleware({
  check: async (request) => {
    const clientIp = extractClientIp(request);
    const email = String(request.body?.email || "");
    return rateLimiterService.checkNamedEmailActionRateLimit("emailVerification", { ipAddress: clientIp, email });
  },
  consume: async (request) => {
    const clientIp = extractClientIp(request);
    const email = String(request.body?.email || "");
    await rateLimiterService.logNamedEmailActionRequest("emailVerification", { ipAddress: clientIp, email });
  },
  consumeWhen: "after-success",
  createError: (result) => createTooManyRequestsError(result.reason, result.retryAfter),
});

export const passwordResetCodeRateLimitMiddleware = rateLimitMiddleware({
  check: async (request) => {
    const clientIp = extractClientIp(request);
    const email = String(request.body?.email || "");
    return rateLimiterService.checkNamedEmailActionRateLimit("passwordResetCode", { ipAddress: clientIp, email });
  },
  consume: async (request) => {
    const clientIp = extractClientIp(request);
    const email = String(request.body?.email || "");
    await rateLimiterService.logNamedEmailActionRequest("passwordResetCode", { ipAddress: clientIp, email });
  },
  consumeWhen: "after-success",
  createError: (result) => createTooManyRequestsError(result.reason, result.retryAfter),
});

export const trustedDeviceRateLimitMiddleware = rateLimitMiddleware({
  check: async (request) => {
    const clientIp = extractClientIp(request);
    const userId = getRequiredUserId(request);
    return rateLimiterService.checkNamedRedisWindowRateLimit("twoFactorTrustedDevice", { ipAddress: clientIp, userId });
  },
  consume: async (request) => {
    const clientIp = extractClientIp(request);
    const userId = getRequiredUserId(request);
    await rateLimiterService.consumeNamedRedisWindowRateLimit("twoFactorTrustedDevice", {
      ipAddress: clientIp,
      userId,
    });
  },
  consumeWhen: "before-handler",
  createError: (result) => createTooManyRequestsError(result.reason, result.retryAfter),
});
