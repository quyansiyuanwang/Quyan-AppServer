import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { AgentRepository } from "@/store/agent/agent.repository";

export const AGENT_RUNTIME_WS_PATH = "/agent-runtime/ws";

export class AgentRuntimeGateway {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly sockets = new Map<string, WebSocket>();
  private readonly repository = AgentRepository.getInstance();

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== AGENT_RUNTIME_WS_PATH) return false;
    const expected = String(process.env.AGENT_RUNTIME_TOKEN || "").trim();
    const auth = String(request.headers.authorization || "");
    if (!expected || auth !== `Bearer ${expected}`) {
      socket.destroy();
      return true;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => this.attach(ws));
    return true;
  }

  private attach(ws: WebSocket) {
    let agentId = "";
    ws.on("message", async (raw) => {
      try {
        const frame = JSON.parse(String(raw)) as any;
        if (frame.type === "hello") {
          agentId = frame.agentId;
          this.sockets.set(agentId, ws);
          await this.repository.markRuntimeAgentReady(agentId);
          return;
        }
        if (frame.type === "heartbeat") return;
      } catch {
        ws.close(1008, "Invalid agent frame");
      }
    });
    ws.on("close", () => {
      if (agentId) this.sockets.delete(agentId);
    });
  }

  send(agentId: string, frame: any): boolean {
    const ws = this.sockets.get(agentId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(frame) + "\n");
    return true;
  }

  close() {
    for (const socket of this.sockets.values()) socket.close(1001, "Server shutting down");
    this.server.close();
  }
}
