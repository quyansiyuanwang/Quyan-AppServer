import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" && value ? value : undefined;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = getHeaderValue(req.headers["x-request-id"]);
  const siteRequestId = randomUUID();

  if (incomingRequestId) {
    req.headers["x-client-request-id"] = incomingRequestId;
    res.locals.clientRequestId = incomingRequestId;
  }

  req.headers["x-request-id"] = siteRequestId;
  res.locals.requestId = siteRequestId;
  res.setHeader("x-request-id", siteRequestId);
  next();
}
