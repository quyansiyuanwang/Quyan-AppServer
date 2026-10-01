import type { Request, Response, NextFunction } from "express";
import { AI_REQUEST_LOG_PREFIX } from "@/constant/ai-request-log";
import { loggingMiddleware } from "@/middleware/logging";
import { resolveRelayRequestFormat } from "@/services/relay/utils/relay-request-format.util";
import { ensureAIRequestLogId, setAIRequestLogContext } from "@/util/ai-request-log-context";
/** Only inference endpoints install capture before parsers; the normal logging middleware is idempotent. */
export function earlyAIRequestAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (
    req.method !== "POST" ||
    (req.path !== AI_REQUEST_LOG_PREFIX && !req.path.startsWith(AI_REQUEST_LOG_PREFIX + "/"))
  )
    return next();
  let requestFormat: string | undefined;
  try {
    requestFormat = resolveRelayRequestFormat(req);
  } catch {
    // Keep the audit lifecycle for unsupported paths too: the parser/controller may reject
    // before a RelayProxyController method is reached, but the failure still needs a record.
  }
  ensureAIRequestLogId(res);
  setAIRequestLogContext(res, { requestFormat, authenticationState: "unknown", failureStage: "request" });
  loggingMiddleware(req, res, next);
}
