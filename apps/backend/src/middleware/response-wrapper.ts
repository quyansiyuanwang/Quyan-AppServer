import type { Request, Response, NextFunction } from "express";
import { CustomCode } from "../constant/custom-code.js";
import { DEFAULT_BACKEND_LOCALE, translateDescriptor, translateKnownMessage, translateMessage } from "@/locales";

/**
 * 响应包装中间件
 * 自动将所有成功响应包装为 {code, message, data} 格式
 *
 * 跳过条件：
 * 1. 响应已经包含 code 字段（已被包装）
 * 2. res.locals.skipResponseWrapper 为 true
 * 3. 响应状态码不在 200-299 范围内
 */
export function responseWrapperMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 保存原始的 json 方法
  const originalJson = res.json.bind(res);

  // 重写 json 方法以拦截响应
  res.json = function (body: any): Response {
    // 检查是否需要跳过包装
    if (res.locals.skipResponseWrapper === true || res.statusCode < 200 || res.statusCode >= 300)
      return originalJson(body);

    // 如果响应体已经包含 code 字段，说明已被包装，尝试本地化 message 后直接返回
    if (body && typeof body === "object" && "code" in body && typeof body.code === "number") {
      if (typeof body.message === "string")
        body.message = translateKnownMessage(body.message, res.locals.locale ?? req.locale ?? DEFAULT_BACKEND_LOCALE);
      return originalJson(body);
    }

    let normalizedBody = body;
    let explicitMessage: string | undefined;
    let hadMessageOnlyBody = false;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof body.message === "string") {
      explicitMessage = body.message;
      const { message: _message, ...rest } = body as Record<string, unknown>;
      hadMessageOnlyBody = Object.keys(rest).length === 0;
      normalizedBody = Object.keys(rest).length > 0 ? rest : {};
    }

    // 包装响应体
    const locale = res.locals.locale ?? req.locale ?? DEFAULT_BACKEND_LOCALE;
    const translatedMessage = res.locals.responseMessageDescriptor
      ? translateDescriptor(res.locals.responseMessageDescriptor, locale)
      : res.locals.responseMessage
        ? translateKnownMessage(res.locals.responseMessage, locale)
        : explicitMessage
          ? translateKnownMessage(explicitMessage, locale)
          : translateMessage("common.success", locale);

    const wrappedResponse: any = {
      code: CustomCode.OK,
      message: translatedMessage,
    };

    // 只有在有实际数据时才添加 data 字段
    // 空对象不添加 data 字段
    const isEmptyObject =
      normalizedBody &&
      typeof normalizedBody === "object" &&
      Object.keys(normalizedBody).length === 0 &&
      !Array.isArray(normalizedBody);

    if (normalizedBody !== undefined && normalizedBody !== null && (!isEmptyObject || hadMessageOnlyBody))
      wrappedResponse.data = normalizedBody;

    return originalJson(wrappedResponse);
  };

  next();
}
