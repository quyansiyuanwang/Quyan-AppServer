import type { NextFunction, Request, Response } from "express";
import { ZodError, ZodSchema } from "zod";
import { ValidationError } from "@/util/errors";
import { translateMessage, DEFAULT_BACKEND_LOCALE, type BackendLocale } from "@/locales";

type RequestPart = "body" | "query" | "params";

function mapZodError(part: RequestPart, error: ZodError, locale: BackendLocale): ValidationError {
  const fields: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? `${part}.${issue.path.join(".")}` : part;
    if (!fields[path]) fields[path] = [];
    fields[path].push(issue.message);
  }

  return new ValidationError(translateMessage("errors.validationFailed", locale), fields);
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
      if (error instanceof ZodError) return next(mapZodError(part, error, res.locals?.locale ?? DEFAULT_BACKEND_LOCALE));
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
