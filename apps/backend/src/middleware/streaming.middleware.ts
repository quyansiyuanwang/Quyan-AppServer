import type { Request, Response, NextFunction } from "express";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { extractRelayToken } from "@/util/relay";
import { resolveSupportRelayClientIp } from "@/util/support-relay-authorization";
import { setAIRequestLogContext } from "@/util/ai-request-log-context";

export async function streamingMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/relay/proxy/")) return next();
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return next();
    }
  }
  if (req.body?.stream !== true) return next();

  try {
    const token = extractRelayToken(req);
    if (!token) return next();

    const relayTokenService = new RelayTokenService();
    const relayProxyService = new RelayProxyService();

    setAIRequestLogContext(res, { isStreaming: true, failureStage: "authentication" });
    const relayToken = await relayTokenService.validateToken(
      token,
      req,
      resolveSupportRelayClientIp(req.headers, token),
    );
    await relayProxyService.forwardRequest(relayToken, req, res);
  } catch (error) {
    next(error);
  }
}
