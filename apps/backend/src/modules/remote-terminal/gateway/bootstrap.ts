import { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { getLogger, LogCategory } from "@/util/logger";
import { WebSocketServer, type WebSocket } from "ws";
import { RemoteTerminalGatewayService } from "./gateway.service";

const logger = getLogger("RemoteTerminalGateway", LogCategory.APPLICATION);
const REMOTE_TERMINAL_WEBSOCKET_PATHS = new Set(["/remote-terminal/ws", "/v1/remote-terminal/ws"]);

export function isRemoteTerminalWebSocketPath(pathname: string): boolean {
  return REMOTE_TERMINAL_WEBSOCKET_PATHS.has(pathname);
}

export class RemoteTerminalGatewayBootstrap {
  private readonly webSocketServer: WebSocketServer;

  public constructor(private readonly gatewayService: RemoteTerminalGatewayService) {
    const serverOptions = {
      noServer: true,
      // ws@8.21.0 supports these at runtime but the TypeScript types lack them.
      // Generous timeouts to avoid dropping background/inactive tabs — the browser
      // handles WebSocket pong responses at the protocol level (not JS), but aggressive
      // throttling or transient hangs can still delay them.
      pingInterval: 60_000,
      pingTimeout: 25_000,
    };
    this.webSocketServer = new WebSocketServer(serverOptions as import("ws").ServerOptions);
  }

  public handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    try {
      const host = request.headers.host || "127.0.0.1";
      const protocol =
        String(request.headers["x-forwarded-proto"] || "http")
          .split(",")[0]
          .trim() || "http";
      const requestUrl = new URL(request.url ?? "/", `${protocol}://${host}`);
          if (!isRemoteTerminalWebSocketPath(requestUrl.pathname)) return false;

      this.webSocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        void (async () => {
          try {
            const role = requestUrl.searchParams.get("role");
            if (role === "agent") {
              const deviceId = requestUrl.searchParams.get("deviceId") ?? "";
              const heartbeatToken = requestUrl.searchParams.get("heartbeatToken") ?? "";
              await this.gatewayService.getDeviceRegistry().validateAgentSocket(deviceId, heartbeatToken);
              this.gatewayService.getSessionGateway().attachAgent(deviceId, websocket);
              return;
            }

            if (role === "browser") {
              const sessionId = requestUrl.searchParams.get("sessionId") ?? "";
              const browserToken = requestUrl.searchParams.get("browserToken") ?? "";
              try {
                this.gatewayService.getSessionGateway().attachBrowser(sessionId, browserToken, websocket);
              } catch (error) {
                const reason = this.toCloseReason(error);
                logger.warn("Failed to attach remote terminal browser websocket", {
                  sessionId,
                  error: reason,
                });
                websocket.close(1008, reason);
              }
              return;
            }

            websocket.close();
          } catch {
            websocket.close();
          }
        })();
      });

      return true;
    } catch (error) {
      logger.warn("Failed to upgrade remote terminal websocket", {
        error: error instanceof Error ? error.message : String(error),
      });
      socket.destroy();
      return true;
    }
  }

  private toCloseReason(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.trim().slice(0, 123) || "WebSocket upgrade rejected.";
  }
}
