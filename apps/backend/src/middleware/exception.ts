import type { Request, Response, NextFunction } from "express";
import chalk from "chalk";
import { HttpStatusCode } from "axios";
import { Prisma } from "@prisma/client";
import { CustomCode } from "@/constant/custom-code";
import { ApiError, ValidationError, TooManyRequestsError, ResourceLockedError } from "@/util/errors";
import { ValidateError } from "@tsoa/runtime";
import { getLogger, LogCategory } from "@/util/logger";
import { env } from "@/config/env";
import { translateMessage } from "@/locales";
import { problemFromTsoaEnumField, problemFromTsoaField, type ValidationProblem } from "@/util/validation-problems";
import { resolveResponseLocale, sendApplicationError, type ApplicationErrorInit } from "@/util/response-renderer";
import { ErrorReportService } from "@/services/system/error-report.service";

const logger = getLogger("ExceptionMiddleware", LogCategory.SYSTEM);

/**
 * 把 ApiError 转成统一渲染入口的初始化参数。
 *
 * 消息来源优先级由 `resolveResponseMessage` 统一决定（描述符 → 诊断原文），
 * 这里不再自行翻译，避免「异常出口」与「显式响应出口」各有一套翻译逻辑（F03）。
 */
function toErrorInit(err: ApiError): ApplicationErrorInit {
  const init: ApplicationErrorInit = {
    statusCode: err.statusCode,
    code: err.code,
    descriptor: err.messageKey ? { key: err.messageKey, params: err.messageParams } : undefined,
    message: err.message,
  };

  if (err.data && typeof err.data === "object") init.data = { ...err.data };

  if (err instanceof TooManyRequestsError && err.retryAfter) {
    init.retryAfter = err.retryAfter;
    init.data = { ...(init.data ?? {}), retryAfter: err.retryAfter };
  }

  if (err instanceof ResourceLockedError && err.retryAfter) {
    init.retryAfter = err.retryAfter;
    init.data = { ...(init.data ?? {}), retryAfter: err.retryAfter };
  }

  if (err instanceof ValidationError && err.fields) init.fields = err.fields;

  // P06：统一校验模型交给边界渲染成 fields 并生成顶层摘要。
  // 刻意**不**覆盖 `descriptor`：若该错误带有明确业务原因（messageKey 非通用校验失败），
  // 渲染器会保留它、只用摘要补 fields；覆盖会按计划禁止的方式把具体原因降级成泛化提示。
  if (err instanceof ValidationError && err.problems && err.problems.length > 0) init.problems = err.problems;

  // 开发环境下附加堆栈信息
  if (env.runtime.isDevelopment && !err.isOperational) init.stack = err.stack;

  return init;
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

  const locale = resolveResponseLocale(res, req);

  // 处理 tsoa 验证错误
  if (err instanceof ValidateError) {
    // TSOA 只暴露 message 文本，没有结构化 validator 元数据。
    // 这里只识别其版本固定的模板文法，无法识别（含自定义 errorMsg）时回退到安全的字段级提示。
    const problems: ValidationProblem[] = Object.keys(err.fields).map((field) => {
      const fieldError = err.fields[field];
      return problemFromTsoaEnumField(field, fieldError.message) ?? problemFromTsoaField(field, fieldError.message);
    });

    sendApplicationError(
      res,
      {
        statusCode: HttpStatusCode.UnprocessableEntity,
        code: CustomCode.VALIDATION_FAILED,
        descriptor: { key: "errors.validationFailed" },
        error: translateMessage("errors.requestValidationFailed", locale),
        problems,
      },
      req,
    );
    return;
  }

  // 处理自定义 ApiError
  if (err instanceof ApiError) {
    sendApplicationError(res, toErrorInit(err), req);
    return;
  }

  // 处理 JWT 错误
  if (err.name === "JsonWebTokenError") {
    sendApplicationError(
      res,
      {
        statusCode: HttpStatusCode.Unauthorized,
        code: CustomCode.TOKEN_INVALID,
        descriptor: { key: "errors.invalidToken" },
        error: err.message,
      },
      req,
    );
    return;
  }

  if (err.name === "TokenExpiredError") {
    sendApplicationError(
      res,
      {
        statusCode: HttpStatusCode.Unauthorized,
        code: CustomCode.TOKEN_EXPIRED,
        descriptor: { key: "errors.tokenExpired" },
        error: err.message,
      },
      req,
    );
    return;
  }

  // 处理 Prisma 错误
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      sendApplicationError(
        res,
        {
          statusCode: HttpStatusCode.Conflict,
          code: CustomCode.RESOURCE_ALREADY_EXISTS,
          descriptor: { key: "errors.resourceAlreadyExists" },
          error: env.runtime.isDevelopment ? err.message : undefined,
          diagnosticFields: env.runtime.isDevelopment ? { target: getPrismaErrorTarget(err) } : undefined,
        },
        req,
      );
      return;
    }

    sendApplicationError(
      res,
      {
        statusCode: HttpStatusCode.BadRequest,
        code: CustomCode.VALIDATION_FAILED,
        descriptor: { key: "errors.databaseOperationFailed" },
        error: env.runtime.isDevelopment ? err.message : undefined,
      },
      req,
    );
    return;
  }

  // 处理未知错误：保留原始异常用于受控诊断，但生产环境不外发其细节
  ErrorReportService.getInstance().reportServerExceptionSafely(req, err);
  sendApplicationError(
    res,
    {
      statusCode: HttpStatusCode.InternalServerError,
      code: CustomCode.INTERNAL_SERVER_ERROR,
      message: env.runtime.isProduction ? undefined : err.message,
      defaultMessageKey: "errors.internalServerError",
      error: env.runtime.isDevelopment ? err.message : undefined,
      stack: env.runtime.isDevelopment ? err.stack : undefined,
    },
    req,
  );
}
