import type { Request, Response, NextFunction } from "express";
import { env } from "@/config/env";
import { ForbiddenError, BadRequestError } from "@/util/errors";

/** Unlike general CORS, an empty allowlist must never authorize a reset. */
export function isBrowserResetOriginAllowed(origin: string | undefined, configuredOrigins: string): boolean {
  if (!origin || origin === "null") return false;
  return configuredOrigins
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(origin);
}

export function browserStateResetGuard(req: Request, _res: Response, next: NextFunction): void {
  if (
    !isBrowserResetOriginAllowed(req.get("origin"), env.runtime.corsAllowedOrigins) ||
    req.get("X-Browser-State-Reset") !== "1"
  ) {
    next(new ForbiddenError());
    return;
  }
  if (
    !req.is("application/json") ||
    !req.body ||
    req.body.confirm !== true ||
    Object.keys(req.body).some((key) => key !== "confirm")
  ) {
    next(new BadRequestError());
    return;
  }
  next();
}
