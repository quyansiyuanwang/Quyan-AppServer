import type { Response } from "express";
import { CustomCode } from "@/constant/custom-code";
import {
  DEFAULT_BACKEND_LOCALE,
  renderDescriptorSafely,
  translateMessage,
  type BackendLocale,
  type MessageDescriptor,
  type MessageDescriptorIssue,
  type MessageKey,
} from "@/locales";
import { getLogger, LogCategory } from "@/util/logger";
import {
  renderValidationFields,
  summarizeValidationProblems,
  type ValidationProblem,
} from "@/util/validation-problems";

const logger = getLogger("ResponseRenderer", LogCategory.SYSTEM);

/**
 * 响应消息的来源，按优先级排列。
 *
 * - `rendered`：已在出口渲染完成，**原样使用，绝不再次翻译**（避免「二次翻译」把
 *   已本地化的文案再查一遍目录，例如把译文当成原文键命中另一条映射）。
 * - `descriptor`：类型安全描述符（首选构造方式）。
 * - `rawMessage`：遗留原文，P13 前用于兼容既有 `throw new XxxError("中文")` 调用点。
 * - `defaultKey`：都没有时的兜底 key（例如成功响应用 `common.success`）。
 */
export interface MessageSource {
  rendered?: string;
  descriptor?: MessageDescriptor;
  rawMessage?: string;
  defaultKey?: MessageKey;
}

export interface ApplicationErrorInit {
  statusCode: number;
  code: number;
  /** 消息描述符；与 `message` 同时给出时描述符优先 */
  descriptor?: MessageDescriptor;
  /** 遗留原文 / 内部诊断原文；仅在无描述符时参与原文反查 */
  message?: string;
  /** 既无描述符也无可用原文时的兜底 key */
  defaultMessageKey?: MessageKey;
  /** 允许公开的载荷；不得包含 cause、凭据、SQL 或上游原文 */
  data?: Record<string, unknown>;
  /** 字段级校验问题，保持既有 `fields` 形状 */
  fields?: Record<string, string[]>;
  /**
   * 统一内部校验模型（P06）。存在时由响应边界渲染成 `fields`（覆盖 `fields`），
   * 并在**没有明确业务原因**时生成顶层字段摘要。
   */
  problems?: readonly ValidationProblem[];
  /** 限流/锁冲突的重试秒数：同时产出 `Retry-After` 头 */
  retryAfter?: number;
  /** TSOA 校验附加字段，保持既有外部格式 */
  error?: string;
  /** 仅开发环境使用的诊断字段（例如 Prisma `target`）；生产环境不得传入 */
  diagnosticFields?: Record<string, unknown>;
  /** 仅开发环境附加的堆栈 */
  stack?: string;
}

export interface RenderedApplicationResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** 标记消息已在出口渲染完成；包装器据此跳过二次翻译 */
const MESSAGE_RENDERED = "messageRendered";
const RENDERED_MESSAGE = "renderedMessage";

function reportDescriptorIssues(descriptor: MessageDescriptor, issues: MessageDescriptorIssue[]): void {
  // 只记录 key 与问题类型：不记录参数值，避免把用户数据写进日志
  logger.warn(
    `Message descriptor fell back to a safe message: key=${descriptor.key} issues=${issues
      .map((issue) => issue.kind)
      .join(",")}`,
  );
}

/**
 * 唯一的消息渲染入口：异常出口与显式业务响应共用，保证同一失败在任何路径上文案一致。
 */
export function resolveResponseMessage(source: MessageSource, locale: BackendLocale): string {
  if (source.rendered !== undefined) return source.rendered;

  if (source.descriptor) {
    const rendered = renderDescriptorSafely(source.descriptor, locale);
    if (rendered.issues.length > 0) reportDescriptorIssues(source.descriptor, rendered.issues);
    return rendered.message;
  }

  // 遗留原文**不再反查翻译**（P13 已删除原文目录与前缀猜测）：调用点若未提供描述符，
  // 原文按原样返回，不做语言猜测。生产路径已全部携带描述符，此分支只服务兜底。
  if (source.rawMessage !== undefined && source.rawMessage !== "") return source.rawMessage;

  return translateMessage(source.defaultKey ?? "common.success", locale);
}

/** 从当前请求上下文取语言：只依赖 req/res 上的请求级状态，不使用任何全局可变语言状态 */
export function resolveResponseLocale(res: Response, req?: { locale?: BackendLocale }): BackendLocale {
  const locale = res.locals?.locale ?? req?.locale;
  return locale === "en" || locale === "zh-CN" ? locale : DEFAULT_BACKEND_LOCALE;
}

/**
 * 渲染业务错误信封。异常出口（throw）与显式失败响应（直接写响应）都调用它，
 * 因此同一业务失败在两条路径上得到完全相同的 `status` / `code` / `message` / 附加字段。
 */
export function renderApplicationError(init: ApplicationErrorInit, locale: BackendLocale): RenderedApplicationResponse {
  const problems = init.problems ?? [];

  // 「已有明确业务原因优先于自动摘要」：只有描述符停留在通用的 errors.validationFailed 时，
  // 才用字段摘要替换顶层消息，避免把具体的业务失败原因降级成泛化校验提示。
  const hasExplicitBusinessReason = init.descriptor !== undefined && init.descriptor.key !== "errors.validationFailed";

  const message =
    !hasExplicitBusinessReason && problems.length > 0
      ? summarizeValidationProblems(problems, locale)
      : resolveResponseMessage(
          { descriptor: init.descriptor, rawMessage: init.message, defaultKey: init.defaultMessageKey },
          locale,
        );

  const body: Record<string, unknown> = { code: init.code, message };

  if (init.data && typeof init.data === "object") body.data = { ...init.data };
  // 统一校验模型优先于已渲染字段；两者都缺失时不输出空 fields
  if (problems.length > 0) body.fields = renderValidationFields(problems, locale);
  else if (init.fields) body.fields = init.fields;
  if (init.error !== undefined) body.error = init.error;
  if (init.diagnosticFields) Object.assign(body, init.diagnosticFields);
  if (init.stack !== undefined) body.stack = init.stack;

  const headers: Record<string, string> = {};
  if (init.retryAfter !== undefined && init.retryAfter > 0) headers["Retry-After"] = String(init.retryAfter);

  return { status: init.statusCode, body, headers };
}

/** 应用响应的信封判定：普通对象且带数字 `code`（用于区分第三方/原始响应体） */
export function isApplicationEnvelope(body: unknown): body is Record<string, unknown> & { code: number } {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as { code?: unknown }).code === "number"
  );
}

/**
 * 显式业务失败出口：渲染后写入响应并标记「已渲染」，包装器不会再翻译一次。
 *
 * 适用于没有抛异常、但需要直接返回业务失败的场景（框架级 catch-all、超时、旧接口停用等）。
 */
export function sendApplicationError(
  res: Response,
  init: ApplicationErrorInit,
  req?: { locale?: BackendLocale },
): void {
  const rendered = renderApplicationError(init, resolveResponseLocale(res, req));

  res.locals[MESSAGE_RENDERED] = true;
  res.locals[RENDERED_MESSAGE] = rendered.body.message as string;

  for (const [name, value] of Object.entries(rendered.headers)) res.setHeader(name, value);
  res.status(rendered.status).json(rendered.body);
}

/**
 * 成功响应的消息来源解析。
 *
 * 优先级：已渲染消息 → 描述符 → 遗留原文 → `common.success`。
 * 领域对象里名为 `message` 的业务字段不参与此解析（由调用方判断是否属于响应消息）。
 */
export function resolveSuccessMessageSource(locals: Record<string, unknown>, explicitMessage?: string): MessageSource {
  if (locals[MESSAGE_RENDERED] === true && typeof locals[RENDERED_MESSAGE] === "string")
    return { rendered: locals[RENDERED_MESSAGE] };

  if (locals.responseMessageDescriptor) return { descriptor: locals.responseMessageDescriptor as MessageDescriptor };
  if (typeof locals.responseMessage === "string") return { rawMessage: locals.responseMessage };
  if (explicitMessage !== undefined) return { rawMessage: explicitMessage };

  return {};
}

/** 组装成功信封 `{ code, message, data? }`；`data` 为空对象时不添加，保持既有格式 */
export function buildSuccessEnvelope(
  data: unknown,
  message: string,
  options: { hadMessageOnlyBody?: boolean } = {},
): Record<string, unknown> {
  const envelope: Record<string, unknown> = { code: CustomCode.OK, message };

  const isEmptyObject =
    typeof data === "object" && data !== null && !Array.isArray(data) && Object.keys(data).length === 0;

  if (data !== undefined && data !== null && (!isEmptyObject || options.hadMessageOnlyBody === true))
    envelope.data = data;

  return envelope;
}
