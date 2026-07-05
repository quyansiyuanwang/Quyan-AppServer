import type { NextFunction, Request, Response } from "express";
import { TooManyRequestsError } from "@/util/errors";
import type { RateLimitCheckResult } from "@/services/infrastructure/rate-limiter.service";

type RateLimitErrorFactory = (result: RateLimitCheckResult, request: Request) => TooManyRequestsError;

interface RateLimitMiddlewareOptions {
  check: (request: Request) => Promise<RateLimitCheckResult>;
  consume?: (request: Request) => Promise<void>;
  consumeWhen?: "before-handler" | "after-success";
  shouldConsumeSuccess?: (response: Response) => boolean;
  createError: RateLimitErrorFactory;
}

const defaultShouldConsumeSuccess = (response: Response): boolean =>
  response.statusCode >= 200 && response.statusCode < 400;

export const rateLimitMiddleware = (options: RateLimitMiddlewareOptions) => {
  const consumeWhen = options.consumeWhen || "before-handler";
  const shouldConsumeSuccess = options.shouldConsumeSuccess || defaultShouldConsumeSuccess;

  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await options.check(request);
      if (!result.allowed) {
        next(options.createError(result, request));
        return;
      }

      if (options.consume && consumeWhen === "before-handler") {
        await options.consume(request);
        next();
        return;
      }

      if (options.consume && consumeWhen === "after-success") {
        response.once("finish", () => {
          if (!shouldConsumeSuccess(response)) return;
          void options.consume?.(request);
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
