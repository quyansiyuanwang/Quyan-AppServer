import type { TypedRequest } from "@/types/express";
import type { MessageDescriptor, MessageKey, TranslationParams } from "@/locales";

/**
 * 标记当前请求跳过响应包装
 * 用于特殊接口（如返回原始文档、文件等）
 *
 * @param request Express 请求对象
 * @example
 * ```typescript
 * public async getOpenApiSpec(@Request() request: TypedRequest): Promise<any> {
 *   skipResponseWrapper(request);
 *   return swaggerDocument;
 * }
 * ```
 */
export function skipResponseWrapper(request: TypedRequest): void {
  if (request.res) request.res.locals.skipResponseWrapper = true;
}

/**
 * 设置自定义响应消息。
 *
 * P13 起**只接受消息 key**：原文（中文/英文字面量）不再参与翻译，
 * `translateKnownMessage` 原文反查已随旧机制一并删除。这样「新增旧式调用」
 * 在类型层就不可表达——传入任意字符串不再是合法调用。
 *
 * @param request Express 请求对象
 * @param key 消息目录中的稳定 key
 * @param params 模板占位符参数（仅安全领域标量）
 * @example
 * ```typescript
 * public async login(@Body() body: LoginDto, @Request() request: TypedRequest) {
 *   setResponseMessageKey(request, "auth.loginSuccess");
 *   return tokenData;
 * }
 * ```
 */
export function setResponseMessageKey(
  request: TypedRequest,
  key: MessageKey,
  params?: TranslationParams,
  fallback?: string,
): void {
  if (request.res)
    request.res.locals.responseMessageDescriptor = {
      key,
      params,
      fallback,
    } satisfies MessageDescriptor;
}
