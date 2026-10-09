import type { Request, Response, NextFunction } from "express";
import { ApiRoutePath } from "@/build/route-paths";
import { AI_REQUEST_LOG_PREFIX } from "@/constant/ai-request-log";
import { AI_LEASE_HEADER, AIResourceService, aiResourceContext } from "@/services/infrastructure/ai-resource.service";

const templates = [ApiRoutePath.V1ChatConversationsByConversationIdMessages, ApiRoutePath.V1SupportMessages];
const patterns = templates.map(
  (path) =>
    new RegExp(
      "^" +
        path
          .split(/(\{[^}]+\})/)
          .map((part) => (part.startsWith("{") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
          .join("") +
        "/?$",
    ),
);

/** Must precede all data listeners and body parsers: queued requests remain unread. */
export function aiResourceGuard(req: Request, res: Response, next: NextFunction): void {
  const ticket = req.headers[AI_LEASE_HEADER];
  delete req.headers[AI_LEASE_HEADER]; // Never forward internal capabilities to the upstream.
  if (
    req.method !== "POST" ||
    !(
      req.path === AI_REQUEST_LOG_PREFIX ||
      req.path.startsWith(AI_REQUEST_LOG_PREFIX + "/") ||
      patterns.some((pattern) => pattern.test(req.path))
    )
  )
    return next();
  const service = AIResourceService.getInstance();
  const controller = new AbortController();
  let lease: import("@/services/infrastructure/ai-resource.service").AIResourceLease | undefined;
  let release: (() => void) | undefined;
  let completed = false;
  const cleanup = () => {
    if (completed) return;
    completed = true;
    req.off("aborted", abort);
    res.off("close", close);
    res.off("finish", cleanup);
    release?.();
  };
  const abort = () => {
    controller.abort();
    lease?.controller.abort();
    cleanup();
  };
  const close = () => {
    if (!res.writableEnded) abort();
    else cleanup();
  };
  req.once("aborted", abort);
  res.once("close", close);
  res.once("finish", cleanup);
  const child = service.consumeHop(ticket, req.path, String(req.headers.authorization || ""));
  const acquired = child ? Promise.resolve(child.lease) : service.acquire(controller.signal);
  acquired
    .then((value) => {
      lease = value;
      release = child?.release ?? (() => value.release());
      if (completed || controller.signal.aborted) {
        release();
        return;
      }
      aiResourceContext.run(value, next);
    })
    .catch((error) => {
      cleanup();
      if (!controller.signal.aborted && !res.destroyed) next(error);
    });
}
