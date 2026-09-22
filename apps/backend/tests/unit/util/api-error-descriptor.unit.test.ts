/**
 * P03 — 类型安全消息描述符、cause 隔离与错误工厂
 *
 * 覆盖三类验收：
 * 1. **编译期约束**：带占位符的 key 必须传参、无占位符的 key 不接受参数、参数名必须匹配、
 *    未知 key 被拒绝、对象（Error/请求体/记录）不能作为插值参数、params 不能脱离 key 存在。
 *    这些断言用 `@ts-expect-error` 表达，由 `tsc --noEmit`（tsconfig 含 `tests/**`）实际校验；
 *    语句被包在永不调用的函数里，避免在 Vitest 运行时执行。
 * 2. **运行时兜底**：未知 key / 缺失参数 / `null` 参数不得把 key 或 `{{placeholder}}` 展示给用户。
 * 3. **cause 隔离与旧接口兼容**：cause 只走受控诊断、不出现在序列化结果中；既有原文构造路径行为不变。
 */
import { describe, expect, it } from "vitest";
import { HttpStatusCode } from "axios";
import { CustomCode } from "@/constant/custom-code";
import {
  backendI18n,
  createMessageDescriptor,
  createMessageOptions,
  inspectMessageDescriptor,
  renderDescriptorSafely,
  translateDescriptor,
  type MessageKey,
} from "@/locales";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
  createApiError,
} from "@/util/errors";

const UNKNOWN_KEY = "does.not.exist" as unknown as MessageKey;

/** 仅用于编译期校验：永不执行，避免 `@ts-expect-error` 的语句在运行时抛错 */
function compileTimeOnly(): void {
  // ---- 正向：合法的 key/params 组合 ----
  createMessageDescriptor("user.deleted");
  createMessageDescriptor("ipBlacklist.notFoundByIp", { ip: "127.0.0.1" });
  createMessageDescriptor("permission.invalidPermissions", { permissions: "a:b" });
  createMessageOptions("relay.customKeyLimitReached", { limit: 3 });
  new BadRequestError("raw", undefined, { messageKey: "ipBlacklist.notFoundByIp", messageParams: { ip: "1" } });
  new BadRequestError("raw", undefined, { messageKey: "user.deleted" });
  new BadRequestError("raw", undefined, { cause: new Error("original") });
  new BadRequestError("raw");
  createApiError(HttpStatusCode.BadRequest, { message: "raw", messageKey: "user.deleted" });
  createApiError(HttpStatusCode.BadRequest, {
    message: "raw",
    messageKey: "ipBlacklist.notFoundByIp",
    messageParams: { ip: "1" },
  });

  // ---- 反向：占位符 key 必须提供匹配参数 ----
  // @ts-expect-error 带占位符的 key 必须传参
  createMessageDescriptor("ipBlacklist.notFoundByIp");
  // @ts-expect-error 带占位符的 key 必须传参
  new BadRequestError("raw", undefined, { messageKey: "ipBlacklist.notFoundByIp" });
  // @ts-expect-error 带占位符的 key 必须传参
  createApiError(HttpStatusCode.BadRequest, { message: "raw", messageKey: "relay.customKeyLimitReached" });

  // ---- 反向：无占位符 key 不接受参数 ----
  // @ts-expect-error 无占位符的 key 不接受参数
  createMessageDescriptor("user.deleted", { ip: "1" });
  // @ts-expect-error 无占位符的 key 不接受参数
  new BadRequestError("raw", undefined, { messageKey: "user.deleted", messageParams: { ip: "1" } });

  // ---- 反向：参数名必须与占位符一致 ----
  // @ts-expect-error 参数名与占位符不匹配
  createMessageDescriptor("ipBlacklist.notFoundByIp", { wrong: "1" });
  // @ts-expect-error 缺少另一个占位符 windowMinutes
  createMessageOptions("relay.customKeyCreateRateLimitReached", { limit: 1 });

  // ---- 反向：未知 key ----
  // key 在编译期被限制为 `MessageKey` 联合，任意字符串无法通过（不写字面量以免绕过 i18n ESLint 门禁）
  const notRegistered: string = ["nope", "nope"].join(".");
  // @ts-expect-error 未登记的 key 不是 MessageKey
  const unknownKey: MessageKey = notRegistered;
  void unknownKey;
  // @ts-expect-error 未登记的 key 不能作为 messageKey
  new NotFoundError("raw", undefined, { messageKey: notRegistered });

  // ---- 反向：插值参数只允许领域标量 ----
  // @ts-expect-error Error 不能作为插值参数
  createMessageDescriptor("ipBlacklist.notFoundByIp", { ip: new Error("boom") });
  // @ts-expect-error 对象不能作为插值参数
  createMessageDescriptor("ipBlacklist.notFoundByIp", { ip: { nested: "x" } });

  // ---- 反向：params 不能脱离 key 存在 ----
  // @ts-expect-error 有 params 但无 key
  new BadRequestError("raw", undefined, { messageParams: { ip: "1" } });
}
void compileTimeOnly;

describe("P03 · 类型安全描述符的运行时行为", () => {
  it("renders a typed descriptor in both locales", () => {
    const descriptor = createMessageDescriptor("ipBlacklist.notFoundByIp", { ip: "10.0.0.1" });

    expect(translateDescriptor(descriptor, "en")).toBe("IP 10.0.0.1 is not blacklisted");
    expect(translateDescriptor(descriptor, "zh-CN")).toBe("IP 10.0.0.1 不在黑名单中");
    expect(inspectMessageDescriptor(descriptor)).toEqual([]);
  });

  it("produces error options through the same key/params constraint", () => {
    expect(createMessageOptions("relay.customKeyLimitReached", { limit: 2 })).toEqual({
      messageKey: "relay.customKeyLimitReached",
      messageParams: { limit: 2 },
    });
  });

  it("reports an unknown key and falls back to a safe localized message", () => {
    const descriptor = { key: UNKNOWN_KEY, params: undefined };

    expect(inspectMessageDescriptor(descriptor)).toEqual([
      { kind: "unknownKey", key: UNKNOWN_KEY, detail: "Message key is not present in the default catalog" },
    ]);

    for (const locale of ["en", "zh-CN"] as const) {
      const rendered = renderDescriptorSafely(descriptor, locale);
      expect(rendered.usedSafeFallback).toBe(true);
      expect(rendered.message).not.toContain(UNKNOWN_KEY);
      expect(rendered.message).not.toContain("{{");
      expect(rendered.message).toBe(backendI18n.t("errors.internalServerError", locale));
    }
  });

  it("reports missing and null params, and never leaks residual placeholders", () => {
    const descriptor = createMessageDescriptor("ipBlacklist.notFoundByIp", { ip: "127.0.0.1" });
    // 模拟绕过类型检查的运行时输入（例如反序列化或动态 key 构造）
    const missing = { key: descriptor.key, params: {} as never };
    const nullish = { key: descriptor.key, params: { ip: null } as never };

    expect(inspectMessageDescriptor(missing)).toEqual([
      { kind: "missingParam", key: descriptor.key, detail: 'Missing value for placeholder "ip"' },
    ]);
    expect(inspectMessageDescriptor(nullish)[0]?.kind).toBe("missingParam");

    for (const broken of [missing, nullish]) {
      const rendered = renderDescriptorSafely(broken, "zh-CN");
      expect(rendered.usedSafeFallback).toBe(true);
      expect(rendered.message).not.toContain("{{");
      expect(rendered.message).not.toContain(descriptor.key);
      expect(rendered.message).toBe("服务器内部错误");
    }
  });

  it("keeps the normal rendering path free of fallback", () => {
    const rendered = renderDescriptorSafely(createMessageDescriptor("user.deleted"), "en");

    expect(rendered).toEqual({ message: "Deleted successfully", issues: [], usedSafeFallback: false });
  });
});

describe("P03 · cause 隔离", () => {
  it("keeps the original error available for controlled diagnostics", () => {
    const original = new Error("driver: connection reset by peer");
    const error = new BadRequestError("raw", undefined, { messageKey: "user.deleted", cause: original });

    expect(error.getDiagnosticCause()).toBe(original);
    expect(error.hasMessageDescriptor()).toBe(true);
  });

  it("never exposes cause through serialization, enumeration or spreading", () => {
    const original = new Error("secret upstream payload");
    const error = new BadRequestError("raw", undefined, { messageKey: "user.deleted", cause: original });

    expect(JSON.stringify(error)).not.toContain("secret upstream payload");
    expect(Object.keys(error)).not.toContain("cause");
    expect(Object.getOwnPropertyNames(error)).toContain("cause");
    expect({ ...error }).not.toHaveProperty("cause");
    expect(error.data).toBeUndefined();
  });

  it("leaves cause undefined when not provided", () => {
    const error = new NotFoundError("用户不存在");

    expect(error.getDiagnosticCause()).toBeUndefined();
    expect(error.hasMessageDescriptor()).toBe(false);
  });
});

describe("P03 · 错误工厂 createApiError", () => {
  it("maps status codes onto the existing error classes", () => {
    const cases: Array<[number, new (...args: never[]) => ApiError]> = [
      [HttpStatusCode.BadRequest, BadRequestError],
      [HttpStatusCode.Unauthorized, UnauthorizedError],
      [HttpStatusCode.Forbidden, ForbiddenError],
      [HttpStatusCode.NotFound, NotFoundError],
      [HttpStatusCode.Conflict, ConflictError],
      [HttpStatusCode.UnprocessableEntity, ValidationError],
      [HttpStatusCode.TooManyRequests, TooManyRequestsError],
      [HttpStatusCode.InternalServerError, InternalServerError],
    ];

    for (const [status, ctor] of cases) {
      const error = createApiError(status, { message: "raw", messageKey: "user.deleted" });
      expect(error).toBeInstanceOf(ctor);
      expect(error.statusCode).toBe(status);
      expect(error.messageKey).toBe("user.deleted");
    }
  });

  it("carries params, business code and diagnostic cause", () => {
    const original = new Error("upstream 502");
    const error = createApiError(HttpStatusCode.BadRequest, {
      message: "raw",
      code: CustomCode.RESOURCE_ALREADY_EXISTS,
      messageKey: "ipBlacklist.notFoundByIp",
      messageParams: { ip: "10.0.0.1" },
      cause: original,
    });

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.code).toBe(CustomCode.RESOURCE_ALREADY_EXISTS);
    expect(error.messageParams).toEqual({ ip: "10.0.0.1" });
    expect(error.getDiagnosticCause()).toBe(original);
    expect(JSON.stringify(error)).not.toContain("upstream 502");
  });

  it("falls back to the base ApiError for unmapped status codes", () => {
    const error = createApiError(418, { message: "I am a teapot", messageKey: "user.deleted" });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.constructor.name).toBe("ApiError");
    expect(error.statusCode).toBe(418);
    expect(error.code).toBe(CustomCode.INTERNAL_SERVER_ERROR);
  });

  it("supports keyless construction through the strict path", () => {
    const error = createApiError(HttpStatusCode.NotFound, { message: "raw diagnostic" });

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.messageKey).toBeUndefined();
    expect(error.hasMessageDescriptor()).toBe(false);
  });
});

describe("P03 · 旧接口兼容", () => {
  it("keeps the default message key behaviour per class", () => {
    expect(new BadRequestError().messageKey).toBe("errors.badRequest");
    expect(new BadRequestError("Bad Request").messageKey).toBe("errors.badRequest");
    expect(new BadRequestError("用户组不存在").messageKey).toBeUndefined();
    expect(new UnauthorizedError("Unauthorized").messageKey).toBe("errors.unauthorized");
    expect(new ForbiddenError("Forbidden").messageKey).toBe("errors.forbidden");
    expect(new NotFoundError("Resource not found").messageKey).toBe("errors.notFound");
    expect(new ConflictError("Conflict").messageKey).toBe("errors.conflict");
    expect(new ValidationError("Validation failed").messageKey).toBe("errors.validationFailed");
    expect(new InternalServerError("Internal server error").messageKey).toBe("errors.internalServerError");
    expect(new TooManyRequestsError().messageKey).toBe("errors.tooManyRequests");
  });

  it("lets an explicit key win over the class default", () => {
    const error = new BadRequestError("Bad Request", undefined, { messageKey: "user.deleted" });

    expect(error.messageKey).toBe("user.deleted");
    expect(error.messageParams).toBeUndefined();
  });

  it("accepts a runtime-widened key with loose params", () => {
    const dynamicKey: MessageKey = "relay.customKeyLimitReached";
    const error = new BadRequestError("raw", undefined, { messageKey: dynamicKey, messageParams: { limit: 5 } });

    expect(error.messageKey).toBe(dynamicKey);
    expect(error.messageParams).toEqual({ limit: 5 });
    expect(translateDescriptor({ key: dynamicKey, params: { limit: 5 } }, "zh-CN")).toContain("5");
  });

  it("preserves raw-message, fields, retryAfter and status semantics", () => {
    const raw = new BadRequestError("Channel does not have OpenAI upstream configured");
    expect(raw.statusCode).toBe(HttpStatusCode.BadRequest);
    expect(raw.code).toBe(CustomCode.VALIDATION_FAILED);

    const invalid = new ValidationError("Validation failed", { "body.email": ["邮箱格式不正确"] });
    expect(invalid.fields).toEqual({ "body.email": ["邮箱格式不正确"] });

    const limited = new TooManyRequestsError("请求过于频繁，请稍后再试", 30);
    expect(limited.statusCode).toBe(429);
    expect(limited.retryAfter).toBe(30);
    expect(limited.code).toBe(CustomCode.TOO_MANY_REQUESTS);
  });
});
