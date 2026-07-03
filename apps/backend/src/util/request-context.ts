import { AsyncLocalStorage } from "async_hooks";
import type { TypedRequest } from "@/types/express";

const requestContext = new AsyncLocalStorage<TypedRequest>();

export function setRequestContext(request: TypedRequest): void {
  requestContext.enterWith(request);
}

export function getRequestContext(): TypedRequest | undefined {
  return requestContext.getStore();
}

/**
 * 获取当前请求的用户ID
 */
export function getCurrentUserId(): string | undefined {
  const request = requestContext.getStore();
  return request?.user?.userId;
}

/**
 * 获取当前请求的用户信息
 */
export function getCurrentUser() {
  const request = requestContext.getStore();
  return request?.user;
}

/**
 * 获取当前请求的IP地址
 */
export function getCurrentIP(): string | undefined {
  const request = requestContext.getStore();
  return request?.ip || request?.socket?.remoteAddress;
}

/**
 * 获取当前请求的路径
 */
export function getCurrentPath(): string | undefined {
  const request = requestContext.getStore();
  return request?.path;
}
