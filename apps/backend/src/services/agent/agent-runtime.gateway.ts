import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { AgentRepository } from "@/store/agent/agent.repository";
import { createHash } from "node:crypto";

export const AGENT_RUNTIME_WS_PATH = "/agent-runtime/ws";

export class AgentRuntimeGateway {
  private static instance: AgentRuntimeGateway;
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly repository = AgentRepository.getInstance();

  static getInstance() {
    return (this.instance ??= new AgentRuntimeGateway());
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== AGENT_RUNTIME_WS_PATH) return false;
    const expected = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const machineHash = expected ? createHash("sha256").update(expected).digest("hex") : "";
    if (!machineHash) {
      socket.destroy();
      return true;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => this.attach(ws, machineHash));
    return true;
  }

  private attach(ws: WebSocket, machineHash: string) {
    let agentId = "";
    ws.on("message", async (raw) => {
      try {
        const frame = JSON.parse(String(raw)) as any;
        if (frame.type === "response" && typeof frame.requestId === "string") {
          const pending = this.pendingRequests.get(frame.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(frame.requestId);
            if (frame.ok) pending.resolve(frame);
            else pending.reject(new Error(typeof frame.error === "string" ? frame.error : "Remote Agent request failed"));
          }
          return;
        }
        if (frame.type === "hello") {
          const machine = await this.repository.findMachineByRegistrationHash(machineHash);
          if (!machine) { ws.close(1008, "Invalid registration token"); return; }
          agentId = frame.agentId;
          this.sockets.set(agentId, ws);
          await this.repository.markMachineConnected(machine.id, agentId, frame.capabilities || {});
          await this.repository.markRuntimeAgentReady(agentId);
          return;
        }
        if (frame.type === "heartbeat") {
          await this.repository.markMachineHeartbeat(frame.agentId, frame.capabilities || undefined);
          return;
        }
      } catch {
        ws.close(1008, "Invalid agent frame");
      }
    });
    ws.on("close", () => {
      if (agentId) { this.sockets.delete(agentId); void this.repository.markMachineOffline(agentId); }
    });
  }

  send(agentId: string, frame: any): boolean {
    const ws = this.sockets.get(agentId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(frame) + "\n");
    return true;
  }

  request(agentId: string, frame: { requestId: string; [key: string]: unknown }, timeoutMs = 30_000): Promise<any> {
    const ws = this.sockets.get(agentId);
    if (!ws || ws.readyState !== ws.OPEN) return Promise.reject(new Error("Remote Agent is not connected"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(frame.requestId);
        reject(new Error("Remote Agent request timed out"));
      }, timeoutMs);
      this.pendingRequests.set(frame.requestId, { resolve, reject, timer });
      ws.send(JSON.stringify(frame) + "\n", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pendingRequests.delete(frame.requestId);
        reject(error);
      });
    });
  }

  close() {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Agent runtime gateway is shutting down"));
    }
    this.pendingRequests.clear();
    for (const socket of this.sockets.values()) socket.close(1001, "Server shutting down");
    this.server.close();
  }
}
