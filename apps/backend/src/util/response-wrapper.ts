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
 * 设置自定义响应消息
 * 将在响应包装时使用该消息替代默认的 "Success"
 *
 * @param request Express 请求对象
 * @param message 自定义消息
 * @example
 * ```typescript
 * public async login(@Body() body: LoginDto, @Request() request: TypedRequest) {
 *   setResponseMessage(request, "登录成功");
 *   return tokenData;
 * }
 * ```
 */
export function setResponseMessage(request: TypedRequest, message: string): void {
  if (request.res) {
    request.res.locals.responseMessage = message;
    request.res.locals.responseMessageDescriptor = undefined;
  }
}

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
