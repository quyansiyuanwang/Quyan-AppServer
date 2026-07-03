import type { Request, Response, NextFunction } from "express";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { extractRelayToken } from "@/util/relay-auth";

export async function streamingMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/relay/proxy/")) return next();
  if (req.body?.stream !== true) return next();

  try {
    const token = extractRelayToken(req);
    if (!token) return next();

    const relayTokenService = new RelayTokenService();
    const relayProxyService = new RelayProxyService();

    const relayToken = await relayTokenService.validateToken(token, req);
    await relayProxyService.forwardRequest(relayToken, req, res);
  } catch (error) {
    next(error);
  }
}
