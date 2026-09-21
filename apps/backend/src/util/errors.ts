import { HttpStatusCode } from "axios";
import { CustomCode } from "@/constant/custom-code";
import type { MessageKey, MessageParamsForKey, MessageRequirementForKey, TranslationParams } from "@/locales";
import type { ValidationProblem } from "@/util/validation-problems";

/**
 * 严格的错误消息选项：`messageKey` 与 `messageParams` 在编译期绑定。
 *
 * 用「裸 TKey 交叉条件成员」的写法，使 TS 能先从 `messageKey` 推回字面量 key，
 * 再按该 key 校验参数：
 * - 带占位符的 key 必须提供匹配参数
 * - 无占位符的 key 不接受参数（`messageParams` 被约束为 `undefined`）
 * - 参数值只允许领域标量（`MessageParamValue`），排除 Error、请求体、记录、上游响应
 */
export type StrictMessageOptions<TKey extends MessageKey> = {
  messageKey: TKey;
} & (MessageRequirementForKey<TKey> extends "required"
  ? { messageParams: MessageParamsForKey<TKey> }
  : { messageParams?: MessageParamsForKey<TKey> });

/**
 * 错误构造选项。
 *
 * 要么携带受约束的 `messageKey`（可含 `cause`），要么完全不带消息描述符。
 * 因此无法构造出「有 params 但无 key」的错误对象。
 */
export type ApiErrorOptions<TKey extends MessageKey = MessageKey> =
  | (StrictMessageOptions<TKey> & { cause?: unknown })
  | { messageKey?: undefined; messageParams?: undefined; cause?: unknown };

/** 基类使用的宽松选项：描述符已通过派生类构造签名完成校验，基类只负责承载 */
export type LooseApiErrorOptions =
  | { messageKey: MessageKey; messageParams?: TranslationParams | undefined; cause?: unknown }
  | { messageKey?: undefined; messageParams?: undefined; cause?: unknown };

/**
 * 把派生类的严格选项转换为基类承载用的宽松选项，并应用该错误类的默认 key。
 *
 * 显式 key 优先于默认 key，与既有行为一致（原实现为 `options?.messageKey ?? 默认`）。
 */
function buildLooseOptions<TKey extends MessageKey>(
  defaultKey: MessageKey | undefined,
  options?: ApiErrorOptions<TKey>,
): LooseApiErrorOptions {
  const explicitKey = options !== undefined && "messageKey" in options ? options.messageKey : undefined;
  const cause = options?.cause;

  if (explicitKey !== undefined)
    return {
      messageKey: explicitKey,
      messageParams: (options as { messageParams?: TranslationParams }).messageParams,
      cause,
    };

  return defaultKey === undefined ? { cause } : { messageKey: defaultKey, cause };
}

/** 派生类构造签名统一使用的最后三个参数（message/code 之后） */
type ClassOptionsArg<TKey extends MessageKey> = ApiErrorOptions<TKey> | undefined;

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
  /**
   * 原始异常，仅用于受控诊断。
   *
   * 刻意声明为 `declare`：实例上通过 `Object.defineProperty` 以**不可枚举**方式写入，
   * 因此 `JSON.stringify(error)`、`{ ...error }`、`Object.keys(error)` 都不会带出它。
   */
  declare public readonly cause?: unknown;

  constructor(
    message: string,
    statusCode: number = HttpStatusCode.InternalServerError,
    code: number = CustomCode.INTERNAL_SERVER_ERROR,
    isOperational: boolean = true,
    data?: Record<string, unknown>,
    options?: LooseApiErrorOptions,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.data = data;
    this.messageKey = options?.messageKey;
    this.messageParams = options?.messageParams;
    if (options?.cause !== undefined)
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: false,
        configurable: true,
      });

    Error.captureStackTrace(this);
  }

  /**
   * 受控诊断入口。
   *
   * 只应交给日志/错误上报使用；不得写入响应体、`data` 或任何面向用户的字段。
   */
  public getDiagnosticCause(): unknown {
    return this.cause;
  }

  /** 是否携带可本地化的消息描述符（key/params 已在构造期完成编译期校验） */
  public hasMessageDescriptor(): boolean {
    return this.messageKey !== undefined;
  }
}

/**
 * 400 Bad Request
 */
export class BadRequestError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Bad Request", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.BadRequest,
      code || CustomCode.VALIDATION_FAILED,
      true,
      undefined,
      buildLooseOptions(message === "Bad Request" ? "errors.badRequest" : undefined, options),
    );
  }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Unauthorized", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.Unauthorized,
      code || CustomCode.AUTH_FAILED,
      true,
      undefined,
      buildLooseOptions(message === "Unauthorized" ? "errors.unauthorized" : undefined, options),
    );
  }
}

/**
 * 403 Forbidden
 */
export class ForbiddenError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Forbidden", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.Forbidden,
      code || CustomCode.PERMISSION_DENIED,
      true,
      undefined,
      buildLooseOptions(message === "Forbidden" ? "errors.forbidden" : undefined, options),
    );
  }
}

/** Generic response for content safety blocks; never includes matched text or rule details. */
export class ContentSafetyBlockedError extends ForbiddenError {
  constructor() {
    super("Request blocked by content safety policy", undefined, {
      messageKey: "errors.contentSafetyBlocked",
    });
    this.name = "ContentSafetyBlockedError";
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Resource not found", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.NotFound,
      code || CustomCode.NOT_FOUND,
      true,
      undefined,
      buildLooseOptions(message === "Resource not found" ? "errors.notFound" : undefined, options),
    );
  }
}

/**
 * 409 Conflict
 */
export class ConflictError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Conflict", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.Conflict,
      code || CustomCode.INTERNAL_SERVER_ERROR,
      true,
      undefined,
      buildLooseOptions(message === "Conflict" ? "errors.conflict" : undefined, options),
    );
  }
}

/**
 * 413 Payload Too Large
 */
export class PayloadTooLargeError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Payload too large", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.PayloadTooLarge,
      code || CustomCode.VALIDATION_FAILED,
      true,
      undefined,
      buildLooseOptions(message === "Payload too large" ? "errors.payloadTooLarge" : undefined, options),
    );
  }
}

/**
 * 422 Unprocessable Entity - 验证失败
 *
 * 两种载荷来源：
 * - `problems`：统一内部校验模型（字段路径 + 规则 key + 安全参数），由响应边界渲染成 `fields`；
 * - `fields`：已渲染好的字段消息（业务方直接提供时使用）。
 * 两者同时存在时以 `problems` 为准。
 */
export class ValidationError<TKey extends MessageKey = MessageKey> extends ApiError {
  public readonly fields?: Record<string, string[]>;
  public readonly problems?: ValidationProblem[];

  constructor(
    message: string = "Validation failed",
    fields?: Record<string, string[]>,
    code?: number,
    options?: ClassOptionsArg<TKey>,
  ) {
    super(
      message,
      HttpStatusCode.UnprocessableEntity,
      code || CustomCode.VALIDATION_FAILED,
      true,
      undefined,
      buildLooseOptions(message === "Validation failed" ? "errors.validationFailed" : undefined, options),
    );
    this.fields = fields;
  }

  /** 附加统一校验模型；返回自身便于链式构造 */
  public withProblems(problems: readonly ValidationProblem[]): this {
    if (problems.length > 0) (this as { problems?: ValidationProblem[] }).problems = [...problems];

    return this;
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Internal server error", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.InternalServerError,
      code || CustomCode.INTERNAL_SERVER_ERROR,
      false, // 服务器错误通常不是操作性的
      undefined,
      buildLooseOptions(message === "Internal server error" ? "errors.internalServerError" : undefined, options),
    );
  }
}

/**
 * 429 Too Many Requests
 */
export class TooManyRequestsError<TKey extends MessageKey = MessageKey> extends ApiError {
  public readonly retryAfter?: number;

  constructor(message: string = "请求过于频繁", retryAfter?: number, code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      429,
      code || CustomCode.TOO_MANY_REQUESTS,
      true,
      undefined,
      buildLooseOptions(message === "请求过于频繁" ? "errors.tooManyRequests" : undefined, options),
    );
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
 *
 * 默认使用通用 `errors.lockBackendUnavailable`；调用点可用描述符说明是哪个队列/锁后端不可用。
 */
export class LockBackendUnavailableError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(
    message: string = "Distributed lock backend unavailable",
    code?: number,
    options?: ClassOptionsArg<TKey>,
  ) {
    super(
      message,
      HttpStatusCode.ServiceUnavailable,
      code || CustomCode.DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE,
      false,
      undefined,
      buildLooseOptions("errors.lockBackendUnavailable", options),
    );
  }
}

/**
 * 504 Gateway Timeout
 *
 * 默认使用通用 `errors.gatewayTimeout`；上游调用点可用描述符区分
 * 「请求超时 / 上游不可用 / 暂时不可用」等具体原因，避免被通用提示覆盖。
 */
export class GatewayTimeoutError<TKey extends MessageKey = MessageKey> extends ApiError {
  constructor(message: string = "Gateway timeout", code?: number, options?: ClassOptionsArg<TKey>) {
    super(
      message,
      HttpStatusCode.GatewayTimeout,
      code || CustomCode.INTERNAL_SERVER_ERROR,
      false,
      undefined,
      buildLooseOptions("errors.gatewayTimeout", options),
    );
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

/**
 * 类型安全的错误构造入口。
 *
 * 不新增业务码表：HTTP 状态映射到既有错误类，业务码仍由 `CustomCode` 与调用方决定。
 * 刻意不接受 `data`：需要公开载荷的失败（认证挑战等）必须使用语义明确的专用错误类，
 * 避免工厂把任意 `data` 塞进语义不符的错误类型。
 */
export type ApiErrorInit<TKey extends MessageKey = MessageKey> = ApiErrorOptions<TKey> & {
  /** 内部诊断原文：不参与翻译，默认不出现在响应体 */
  message: string;
  code?: number;
};

export function createApiError<TKey extends MessageKey = MessageKey>(
  statusCode: number,
  init: ApiErrorInit<TKey>,
): ApiError {
  const { message, code } = init;
  const options: ApiErrorOptions<TKey> = init;

  switch (statusCode) {
    case HttpStatusCode.BadRequest:
      return new BadRequestError<TKey>(message, code, options);
    case HttpStatusCode.Unauthorized:
      return new UnauthorizedError<TKey>(message, code, options);
    case HttpStatusCode.Forbidden:
      return new ForbiddenError<TKey>(message, code, options);
    case HttpStatusCode.NotFound:
      return new NotFoundError<TKey>(message, code, options);
    case HttpStatusCode.Conflict:
      return new ConflictError<TKey>(message, code, options);
    case HttpStatusCode.PayloadTooLarge:
      return new PayloadTooLargeError<TKey>(message, code, options);
    case HttpStatusCode.UnprocessableEntity:
      return new ValidationError<TKey>(message, undefined, code, options);
    case HttpStatusCode.TooManyRequests:
      return new TooManyRequestsError<TKey>(message, undefined, code, options);
    case HttpStatusCode.InternalServerError:
      return new InternalServerError<TKey>(message, code, options);
    default:
      return new ApiError(
        message,
        statusCode,
        code ?? CustomCode.INTERNAL_SERVER_ERROR,
        true,
        undefined,
        buildLooseOptions(undefined, options),
      );
  }
}
