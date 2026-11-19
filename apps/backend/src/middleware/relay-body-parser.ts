import express, { type RequestHandler } from "express";
import { AI_REQUEST_LOG_PREFIX } from "@/constant/ai-request-log";
import { getAIResourceConfig } from "@/services/infrastructure/ai-resource-config.service";

export const isRelayProxyPath = (path: string): boolean =>
  path === AI_REQUEST_LOG_PREFIX || path.startsWith(AI_REQUEST_LOG_PREFIX + "/");

/** Read the admitted request's snapshot; raising the limit must also reach the raw parser. */
export const relayJsonBodyParser: RequestHandler = (req, res, next) => {
  if (!isRelayProxyPath(req.path)) return next();
  express.raw({
    type: ["application/json", "application/*+json"],
    limit: getAIResourceConfig().relay.resourceGuard.jsonBodyLimitMb * 1024 * 1024,
  })(req, res, next);
};
