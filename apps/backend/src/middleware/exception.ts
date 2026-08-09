import type { Request, Response, NextFunction } from "express";
import chalk from "chalk";
import { HttpStatusCode } from "axios";
import { Prisma } from "@prisma/client";
import { CustomCode } from "@/constant/custom-code";
import { ApiError, ValidationError, TooManyRequestsError, ResourceLockedError } from "@/util/errors";
import { ValidateError } from "@tsoa/runtime";
import { getLogger, LogCategory } from "@/util/logger";
import { env } from "@/config/env";
import { DEFAULT_BACKEND_LOCALE, translateKnownMessage, translateMessage, type BackendLocale } from "@/locales";
import { ErrorReportService } from "@/services/system/error-report.service";

const logger = getLogger("ExceptionMiddleware", LogCategory.SYSTEM);

function getLocale(req: Request, res: Response): BackendLocale {
  return res.locals.locale ?? req.locale ?? DEFAULT_BACKEND_LOCALE;
}

function localizeApiErrorMessage(err: ApiError, locale: BackendLocale): string {
  if (err.messageKey) return translateMessage(err.messageKey, locale, err.messageParams, err.message);

  return translateKnownMessage(err.message, locale);
}

/**
 * 创建一个安全的 JSON 序列化替换器，处理循环引用
 */
function createCircularReplacer() {
  const seen = new WeakSet();
  return (_key: string, value: any) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";

      seen.add(value);
    }
    return value;
  };
}

function getPrismaErrorTarget(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map(String).join(", ");
  if (typeof target === "string") return target;
  return undefined;
}

/**
 * 增强的异常处理中间件
 * 支持多种错误类型: ApiError、ValidateError(tsoa)、标准 Error
 */
export function exceptionMiddleware(err: Error, req: Request, res: Response, next: NextFunction) {
  // 如果响应已经发送，则不再处理
  if (res.headersSent) return next(err);

  // JWT 相关错误是正常的业务流程，不记录日志
  const isJwtError = err.name === "TokenExpiredError" || err.name === "JsonWebTokenError";

  // 只记录非 JWT 错误的日志
  if (!isJwtError) {
    const errorLog = {
      message: err.message,
      name: err.name,
      path: req.path,
      method: req.method,
      stack: env.runtime.isDevelopment ? err.stack : undefined,
    };

    try {
      logger.error(chalk.red("Exception:") + "\n" + JSON.stringify(errorLog, createCircularReplacer(), 2));
    } catch (_stringifyError) {
      // 如果 JSON.stringify 仍然失败，使用最简化的日志格式
      logger.error(
        chalk.red("Exception:") +
          "\n" +
          JSON.stringify(
            {
              message: String(err.message || "Unknown error"),
              name: String(err.name || "Error"),
              path: req.path,
              method: req.method,
            },
            null,
            2,
          ),
      );
    }
  }

  const locale = getLocale(req, res);

  // 处理 tsoa 验证错误
  if (err instanceof ValidateError) {
    const fields: Record<string, string[]> = {};
    Object.keys(err.fields).forEach((field) => {
      const fieldError = err.fields[field];
      fields[field] = [fieldError.message || "Validation failed"];
    });

    return res.status(HttpStatusCode.UnprocessableEntity).json({
      code: CustomCode.VALIDATION_FAILED,
      message: translateMessage("errors.validationFailed", locale),
      error: translateMessage("errors.requestValidationFailed", locale),
      fields,
    });
  }

  // 处理自定义 ApiError
  if (err instanceof ApiError) {
    const response: any = {
      code: err.code,
      message: localizeApiErrorMessage(err, locale),
    };

    if (err.data && typeof err.data === "object") response.data = { ...err.data };

    // 如果是 TooManyRequestsError，附加 Retry-After 头和 retryAfter 数据
    if (err instanceof TooManyRequestsError && err.retryAfter) {
      res.setHeader("Retry-After", err.retryAfter.toString());
      response.data = {
        ...(response.data || {}),
        retryAfter: err.retryAfter,
      };
    }

    if (err instanceof ResourceLockedError && err.retryAfter) {
      res.setHeader("Retry-After", err.retryAfter.toString());
      response.data = {
        ...(response.data || {}),
        retryAfter: err.retryAfter,
      };
    }

    // 如果是 ValidationError，附加字段错误信息
    if (err instanceof ValidationError && err.fields) response.fields = err.fields;

    // 开发环境下附加堆栈信息
    if (env.runtime.isDevelopment && !err.isOperational) response.stack = err.stack;

    return res.status(err.statusCode).json(response);
  }

  // 处理 JWT 错误
  if (err.name === "JsonWebTokenError")
    return res.status(HttpStatusCode.Unauthorized).json({
      code: CustomCode.TOKEN_INVALID,
      message: translateMessage("errors.invalidToken", locale),
      error: err.message,
    });

  if (err.name === "TokenExpiredError")
    return res.status(HttpStatusCode.Unauthorized).json({
      code: CustomCode.TOKEN_EXPIRED,
      message: translateMessage("errors.tokenExpired", locale),
      error: err.message,
    });

  // 处理 Prisma 错误
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const response: Record<string, unknown> = {
        code: CustomCode.RESOURCE_ALREADY_EXISTS,
        message: translateMessage("errors.resourceAlreadyExists", locale),
      };

      if (env.runtime.isDevelopment) {
        response.error = err.message;
        response.target = getPrismaErrorTarget(err);
      }

      return res.status(HttpStatusCode.Conflict).json(response);
    }

    return res.status(HttpStatusCode.BadRequest).json({
      code: CustomCode.VALIDATION_FAILED,
      message: translateMessage("errors.databaseOperationFailed", locale),
      error: env.runtime.isDevelopment ? err.message : undefined,
    });
  }

  // 处理未知错误
  ErrorReportService.getInstance().reportServerExceptionSafely(req, err);
  const response: any = {
    code: CustomCode.INTERNAL_SERVER_ERROR,
    message: env.runtime.isProduction
      ? translateMessage("errors.internalServerError", locale)
      : err.message || translateMessage("errors.internalServerError", locale),
  };

  // 开发环境下提供详细错误信息
  if (env.runtime.isDevelopment) {
    response.error = err.message;
    response.stack = err.stack;
  }

  res.status(HttpStatusCode.InternalServerError).json(response);
}
