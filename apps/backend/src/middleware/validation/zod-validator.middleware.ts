import type { NextFunction, Request, Response } from "express";
import { ZodError, ZodSchema } from "zod";
import { ValidationError } from "@/util/errors";
import { problemFromZodIssue, type ValidationProblem } from "@/util/validation-problems";

type RequestPart = "body" | "query" | "params";

/**
 * 把 Zod 校验失败归一为统一内部校验模型（P06）。
 *
 * 刻意**不**使用 `issue.message`：Zod 的默认消息是英文原文，且自定义 `message` 可能内嵌用户提交值。
 * 需要展示具体业务原因时，refine 必须通过 `ctx.addIssue({ params: { messageKey, messageParams } })`
 * 显式携带描述符（见 `problemFromZodIssue`）。
 */
export function problemsFromZodError(part: RequestPart, error: ZodError): ValidationProblem[] {
  return error.issues.map((issue) => problemFromZodIssue(issue, part));
}

function createValidator<T>(part: RequestPart, schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req[part]);

      if (part === "query") {
        const query = req.query as Record<string, unknown>;
        for (const key of Object.keys(query)) delete query[key];
        Object.assign(query, parsed as Record<string, unknown>);
      } else (req as any)[part] = parsed;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // 字段消息与顶层摘要都在响应边界渲染，这里只传递结构化问题
        const problems = problemsFromZodError(part, error);
        next(
          new ValidationError(undefined, undefined, undefined, { messageKey: "errors.validationFailed" }).withProblems(
            problems,
          ),
        );
        return;
      }
      next(error);
    }
  };
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return createValidator("body", schema);
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return createValidator("query", schema);
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return createValidator("params", schema);
}
