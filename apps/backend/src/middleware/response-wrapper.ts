import type { Request, Response, NextFunction } from "express";
import {
  buildSuccessEnvelope,
  isApplicationEnvelope,
  resolveResponseLocale,
  resolveResponseMessage,
  resolveSuccessMessageSource,
} from "@/util/response-renderer";

/**
 * 响应包装中间件
 * 自动将所有应用响应包装为 {code, message, data} 格式
 *
 * 跳过条件：
 * 1. `res.locals.skipResponseWrapper` 为 true（文档、文件、第三方协议、流式响应等适配器边界）
 *
 * 本地化规则（P05 统一出口，与 `application-response` 共享同一个渲染入口）：
 * - 2xx：包装为成功信封；消息按「已渲染 → 描述符 → 遗留原文 → common.success」解析
 * - 2xx 且响应体已带数字 `code`：视为已成型信封，只统一 `message`
 * - 非 2xx：**保持信封形状与附加字段不变**，只把 `message` 交给同一渲染入口。
 *   旧实现完全跳过非 2xx，导致「显式业务失败」与「抛异常」文案不一致（F03）。
 * - 已在出口渲染过的消息（`sendApplicationError` 标记）不再二次翻译。
 */
export function responseWrapperMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 保存原始的 json 方法
  const originalJson = res.json.bind(res);

  // 重写 json 方法以拦截响应
  res.json = function (body: any): Response {
    // 适配器边界：第三方协议、文档、文件、流式响应不得被包装或本地化
    if (res.locals.skipResponseWrapper === true) return originalJson(body);

    const locale = resolveResponseLocale(res, req);
    const alreadyRendered = res.locals.messageRendered === true;

    // 非 2xx：保留既有信封与附加字段（fields / error / data），只统一 message
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (!alreadyRendered && isApplicationEnvelope(body) && typeof body.message === "string")
        body.message = resolveResponseMessage({ rawMessage: body.message }, locale);
      return originalJson(body);
    }

    // 2xx 且响应体已带数字 code：视为已成型信封，只统一 message
    if (isApplicationEnvelope(body)) {
      if (!alreadyRendered && typeof body.message === "string")
        body.message = resolveResponseMessage({ rawMessage: body.message }, locale);
      return originalJson(body);
    }

    let normalizedBody = body;
    let explicitMessage: string | undefined;
    let hadMessageOnlyBody = false;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof body.message === "string") {
      const { message: _message, ...rest } = body as Record<string, unknown>;
      hadMessageOnlyBody = Object.keys(rest).length === 0;
      // A domain object can legitimately have a `message` field (for example,
      // an error report). Only a message-only response is an HTTP response message.
      if (hadMessageOnlyBody) {
        explicitMessage = body.message;
        normalizedBody = {};
      }
    }

    const source = resolveSuccessMessageSource(res.locals, explicitMessage);

    return originalJson(
      buildSuccessEnvelope(normalizedBody, resolveResponseMessage(source, locale), { hadMessageOnlyBody }),
    );
  };

  next();
}
