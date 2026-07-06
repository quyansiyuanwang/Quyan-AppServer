import { getLogger, LogCategory, LOG_TRUNCATE_CONFIG } from "./logger";
import type { Request, Response } from "express";
import { copyFunctionMetadata } from "./decorator-metadata";

/**
 * Logger 装饰器选项
 */
export interface LoggerDecoratorOptions {
  /** 日志类别 */
  category?: LogCategory;
  /** 是否记录请求参数 */
  logRequest?: boolean;
  /** 是否记录响应数据 */
  logResponse?: boolean;
  /** 自定义日志消息 */
  message?: string;
  /** 日志级别 */
  level?: "info" | "debug" | "warn" | "error";
}

/**
 * 截断长内容
 * @param content 原始内容
 * @param maxLength 最大长度（默认 500）
 * @returns 截断后的内容
 */
export function truncateContent(content: any, maxLength: number = 500): string {
  if (content === null || content === undefined) return "";

  let str: string;
  if (typeof content === "string") str = content;
  else if (typeof content === "object")
    try {
      str = JSON.stringify(content);
    } catch {
      str = String(content);
    }
  else str = String(content);

  if (str.length <= maxLength) return str;

  return `${str.substring(0, maxLength)}${LOG_TRUNCATE_CONFIG.truncateSuffix} [原长度: ${str.length}]`;
}

/**
 * Logger 路由层装饰器
 * 用于自动记录 Controller 方法的请求和响应
 *
 * @example
 * ```typescript
 * @Route("users")
 * export class UserController {
 *   @Get("{userId}")
 *   @LogRoute({ message: "获取用户信息", logResponse: true })
 *   public async getUser(@Path() userId: string) {
 *     // ...
 *   }
 * }
 * ```
 */
export function LogRoute(options: LoggerDecoratorOptions = {}) {
  const { category = LogCategory.REQUEST, logRequest = true, logResponse = false, message, level = "info" } = options;

  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    const wrappedMethod = async function (this: unknown, ...args: any[]) {
      const logger = getLogger(`${className}.${propertyKey}`, category);
      const startTime = Date.now();

      // 尝试从参数中提取 Request 和 Response 对象
      let req: Request | undefined;
      let _res: Response | undefined;

      for (const arg of args)
        if (arg && typeof arg === "object") {
          if ("method" in arg && "url" in arg && "headers" in arg) req = arg;
          if ("status" in arg && "json" in arg && "send" in arg) _res = arg;
        }

      // 记录请求信息
      if (logRequest && req) {
        const requestInfo: any = {
          method: req.method,
          url: req.originalUrl || req.url,
          params: req.params,
        };

        if (Object.keys(req.query || {}).length > 0) requestInfo.query = truncateContent(req.query, 200);

        if (Object.keys(req.body || {}).length > 0) requestInfo.body = truncateContent(req.body, 500);

        logger[level](message || `请求 ${propertyKey}`, requestInfo);
      } else if (!req) logger[level](message || `调用 ${propertyKey}`);

      try {
        // 执行原始方法
        const result = await originalMethod.apply(this, args);

        // 记录响应信息
        const duration = Date.now() - startTime;
        if (logResponse)
          logger[level](`${message || propertyKey} 完成`, {
            duration: `${duration}ms`,
            response: truncateContent(result, 300),
          });
        else logger[level](`${message || propertyKey} 完成`, { duration: `${duration}ms` });

        return result;
      } catch (error) {
        // 记录错误
        const duration = Date.now() - startTime;
        logger.error(`${message || propertyKey} 失败`, {
          duration: `${duration}ms`,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    copyFunctionMetadata(originalMethod, wrappedMethod);
    descriptor.value = wrappedMethod;

    return descriptor;
  };
}
