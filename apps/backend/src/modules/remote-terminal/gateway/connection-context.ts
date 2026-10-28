import express, { type Application } from "express";
import type { IncomingMessage } from "node:http";
import type { TypedRequest } from "@/types/express";
import { requestTransportConditionContext } from "@/iam/request/condition-context";
import { normalizeIp } from "@/util/ip-extractor";
import { isIP } from "node:net";
import type { TerminalConnectionConditionContext } from "@/services/remote-terminal/remote-terminal-session-authority.service";
/** Resolve proxy headers only through the application's actual Express trust policy. */
export function terminalUpgradeConditionContext(
  request: IncomingMessage,
  app?: Application,
): TerminalConnectionConditionContext {
  if (app && request.socket) {
    const view = Object.create(express.request) as TypedRequest;
    Object.defineProperties(view, {
      app: { value: app },
      socket: { value: request.socket },
      headers: { value: request.headers },
    });
    return Object.freeze(requestTransportConditionContext(view));
  }
  // Without an app trust boundary, only the direct peer/TLS are trustworthy.
  const ip = request.socket?.remoteAddress && normalizeIp(request.socket.remoteAddress);
  return Object.freeze({
    ...(ip && isIP(ip) ? { "acs:SourceIp": ip } : {}),
    "acs:SecureTransport": (request.socket as { encrypted?: boolean } | undefined)?.encrypted === true,
  });
}
