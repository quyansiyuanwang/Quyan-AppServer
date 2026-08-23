import { HttpStatusCode } from "axios";
import { CustomCode } from "@/constant/custom-code";
import type { MessageKey, TranslationParams } from "@/locales";

export interface ApiErrorOptions {
  messageKey?: MessageKey;
  messageParams?: TranslationParams;
}

/**
 * 基础 API 错误类
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: number;
  public readonly isOperational: boolean;
  public readonly data?: Record<string, unknown>;
  public readonly messageKey?: MessageKey;
  public readonly messageParams?: TranslationParams;

  constructor(
    message: string,
    statusCode: number = HttpStatusCode.InternalServerError,
    code: number = CustomCode.INTERNAL_SERVER_ERROR,
    isOperational: boolean = true,
    data?: Record<string, unknown>,
    options?: ApiErrorOptions,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.data = data;
    this.messageKey = options?.messageKey;
    this.messageParams = options?.messageParams;

    Error.captureStackTrace(this);
  }
}

/**
 * 400 Bad Request
 */
export class BadRequestError extends ApiError {
  constructor(message: string = "Bad Request", code?: number, options?: ApiErrorOptions) {
    super(message, HttpStatusCode.BadRequest, code || CustomCode.VALIDATION_FAILED, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Bad Request" ? "errors.badRequest" : undefined),
      messageParams: options?.messageParams,
    });
  }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string = "Unauthorized", code?: number, options?: ApiErrorOptions) {
    super(message, HttpStatusCode.Unauthorized, code || CustomCode.AUTH_FAILED, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Unauthorized" ? "errors.unauthorized" : undefined),
      messageParams: options?.messageParams,
    });
  }
}

/**
 * 403 Forbidden
 */
export class ForbiddenError extends ApiError {
  constructor(message: string = "Forbidden", code?: number, options?: ApiErrorOptions) {
    super(message, HttpStatusCode.Forbidden, code || CustomCode.PERMISSION_DENIED, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Forbidden" ? "errors.forbidden" : undefined),
      messageParams: options?.messageParams,
    });
  }
}

/** Generic response for content safety blocks; never includes matched text or rule details. */
export class ContentSafetyBlockedError extends ForbiddenError {
  constructor() {
    super("Request blocked by content safety policy");
    this.name = "ContentSafetyBlockedError";
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends ApiError {
  constructor(message: string = "Resource not found", code?: number, options?: ApiErrorOptions) {
    super(message, HttpStatusCode.NotFound, code || CustomCode.NOT_FOUND, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Resource not found" ? "errors.notFound" : undefined),
      messageParams: options?.messageParams,
    });
  }
}

/**
 * 409 Conflict
 */
export class ConflictError extends ApiError {
  constructor(message: string = "Conflict", code?: number, options?: ApiErrorOptions) {
    super(message, HttpStatusCode.Conflict, code || CustomCode.INTERNAL_SERVER_ERROR, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Conflict" ? "errors.conflict" : undefined),
      messageParams: options?.messageParams,
    });
  }
}

/**
 * 413 Payload Too Large
 */
export class PayloadTooLargeError extends ApiError {
  constructor(message: string = "Payload too large", code?: number, options?: ApiErrorOptions) {
    super(message, HttpStatusCode.PayloadTooLarge, code || CustomCode.VALIDATION_FAILED, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Payload too large" ? "errors.payloadTooLarge" : undefined),
      messageParams: options?.messageParams,
    });
  }
}

/**
 * 422 Unprocessable Entity - 验证失败
 */
export class ValidationError extends ApiError {
  public readonly fields?: Record<string, string[]>;

  constructor(
    message: string = "Validation failed",
    fields?: Record<string, string[]>,
    code?: number,
    options?: ApiErrorOptions,
  ) {
    super(message, HttpStatusCode.UnprocessableEntity, code || CustomCode.VALIDATION_FAILED, true, undefined, {
      messageKey: options?.messageKey ?? (message === "Validation failed" ? "errors.validationFailed" : undefined),
      messageParams: options?.messageParams,
    });
    this.fields = fields;
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends ApiError {
  constructor(message: string = "Internal server error", code?: number, options?: ApiErrorOptions) {
    super(
      message,
      HttpStatusCode.InternalServerError,
      code || CustomCode.INTERNAL_SERVER_ERROR,
      false, // 服务器错误通常不是操作性的
      undefined,
      {
        messageKey:
          options?.messageKey ?? (message === "Internal server error" ? "errors.internalServerError" : undefined),
        messageParams: options?.messageParams,
      },
    );
  }
}

/**
 * 429 Too Many Requests
 */
export class TooManyRequestsError extends ApiError {
  public readonly retryAfter?: number;

  constructor(message: string = "请求过于频繁", retryAfter?: number, code?: number, options?: ApiErrorOptions) {
    super(message, 429, code || CustomCode.TOO_MANY_REQUESTS, true, undefined, {
      messageKey: options?.messageKey ?? (message === "请求过于频繁" ? "errors.tooManyRequests" : undefined),
      messageParams: options?.messageParams,
    });
    this.retryAfter = retryAfter;
  }
}

/**
 * 409 Resource Locked
 */
export class ResourceLockedError extends ApiError {
  public readonly retryAfter?: number;

  constructor(message: string = "Resource is locked", retryAfter?: number, code?: number) {
    super(message, HttpStatusCode.Conflict, code || CustomCode.DISTRIBUTED_LOCK_CONFLICT, true, undefined, {
      messageKey: "errors.lockConflict",
    });
    this.retryAfter = retryAfter;
  }
}

/**
 * 503 Distributed lock backend unavailable
 */
export class LockBackendUnavailableError extends ApiError {
  constructor(message: string = "Distributed lock backend unavailable", code?: number) {
    super(
      message,
      HttpStatusCode.ServiceUnavailable,
      code || CustomCode.DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE,
      false,
      undefined,
      { messageKey: "errors.lockBackendUnavailable" },
    );
  }
}

/**
 * 504 Gateway Timeout
 */
export class GatewayTimeoutError extends ApiError {
  constructor(message: string = "Gateway timeout", code?: number) {
    super(message, HttpStatusCode.GatewayTimeout, code || CustomCode.INTERNAL_SERVER_ERROR, false, undefined, {
      messageKey: "errors.gatewayTimeout",
    });
  }
}

/**
 * 401 Two-Factor Required
 */
export class TwoFactorRequiredError extends ApiError {
  constructor(
    message: string = "当前操作需要二次验证",
    data?: {
      challengeToken: string;
      expiresIn: number;
      method?: "code" | "email" | "passkey";
      purpose?: "stepup" | "disable2fa" | "login";
      redirect?: string;
    },
  ) {
    super(message, HttpStatusCode.Unauthorized, CustomCode.TWO_FACTOR_REQUIRED, true, data, {
      messageKey: "errors.twoFactorRequired",
    });
  }
}

/**
 * 401 Policy Consent Required
 */
export class PolicyConsentRequiredError extends ApiError {
  constructor(
    message: string = "需要同意最新服务协议和隐私政策",
    data?: {
      requiresPolicyConsent: true;
      challengeToken: string;
      expiresIn: number;
    },
  ) {
    super(message, HttpStatusCode.Unauthorized, CustomCode.POLICY_CONSENT_REQUIRED, true, data, {
      messageKey: "errors.policyConsentRequired",
    });
  }
}
