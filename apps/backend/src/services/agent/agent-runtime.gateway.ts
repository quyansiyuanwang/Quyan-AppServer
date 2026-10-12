import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createHash } from "node:crypto";
import { AgentRepository, type AgentRuntimeIdentity } from "@/store/agent/agent.repository";
import { AGENT_RUNTIME_LIMITS } from "./agent-runtime.policy";
import type { Prisma } from "@prisma/client";

export const AGENT_RUNTIME_WS_PATH = "/agent-runtime/ws";
type RuntimeConnection = {
  ws: WebSocket;
  identity?: AgentRuntimeIdentity;
  closed: boolean;
  tail: Promise<void>;
  queued: number;
  queuedBytes: number;
  helloTimer: ReturnType<typeof setTimeout>;
};
type RuntimeFrame = Record<string, unknown>;
type PendingRequest = {
  connection: RuntimeConnection;
  resolve: (value: RuntimeFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class AgentRuntimeGateway {
  private static instance: AgentRuntimeGateway;
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: AGENT_RUNTIME_LIMITS.maxFrameBytes });
  private readonly connections = new Set<RuntimeConnection>();
  private readonly sockets = new Map<string, RuntimeConnection>();
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private constructor(private readonly repository = AgentRepository.getInstance()) {}

  static getInstance() {
    return (this.instance ??= new AgentRuntimeGateway());
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== AGENT_RUNTIME_WS_PATH) return false;
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
    if (!token) {
      socket.destroy();
      return true;
    }
    const machineHash = createHash("sha256").update(token).digest("hex");
    this.server.handleUpgrade(request, socket, head, (ws) => this.attach(ws, machineHash));
    return true;
  }

  private attach(ws: WebSocket, machineHash: string) {
    const connection: RuntimeConnection = {
      ws,
      closed: false,
      tail: Promise.resolve(),
      queued: 0,
      queuedBytes: 0,
      helloTimer: setTimeout(
        () => this.disconnect(connection, "Runtime authentication timed out"),
        AGENT_RUNTIME_LIMITS.helloTimeoutMs,
      ),
    };
    connection.helloTimer.unref();
    this.connections.add(connection);
    ws.on("message", (raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw.byteLength : Buffer.byteLength(String(raw));
      if (bytes > AGENT_RUNTIME_LIMITS.maxFrameBytes) {
        this.disconnect(connection, "Runtime frame too large");
        return;
      }
      void this.enqueue(
        connection,
        async () => {
          const parsed: unknown = JSON.parse(String(raw));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid runtime frame");
          const frame = parsed as RuntimeFrame;
          if (!connection.identity) {
            if (frame.type !== "hello" || frame.protocolVersion !== 1 || !this.validAgentId(frame.agentId)) {
              throw new Error("Runtime authentication required");
            }
            const identity = await this.repository.connectRuntimeMachine(
              machineHash,
              frame.agentId,
              this.capabilities(frame),
            );
            if (!identity) throw new Error("Runtime authentication failed");
            connection.identity = identity;
            if (connection.closed || !(await this.repository.isRuntimeConnectionActive(identity))) {
              throw new Error("Runtime authentication expired");
            }
            const previous = this.sockets.get(identity.agentId);
            if (previous && previous.identity?.id !== identity.id) throw new Error("Runtime identity conflict");
            for (const existing of this.connections) {
              if (existing !== connection && existing.identity?.id === identity.id)
                this.disconnect(existing, "Runtime connection replaced");
            }
            this.sockets.set(identity.agentId, connection);
            clearTimeout(connection.helloTimer);
            await this.repository.markRuntimeAgentReady(identity);
            return;
          }
          const identity = await this.requireActive(connection);
          if (frame.type === "heartbeat") {
            if (frame.agentId !== identity.agentId) throw new Error("Runtime identity mismatch");
            const updated = await this.repository.markMachineHeartbeat(
              identity,
              frame.capabilities === undefined ? undefined : this.capabilities(frame),
            );
            if (!updated) throw new Error("Runtime connection expired");
            connection.identity = updated;
            return;
          }
          if (frame.type === "response" && typeof frame.requestId === "string" && typeof frame.ok === "boolean") {
            const pending = this.pendingRequests.get(frame.requestId);
            if (!pending) return;
            if (pending.connection !== connection) throw new Error("Runtime response identity mismatch");
            this.pendingRequests.delete(frame.requestId);
            clearTimeout(pending.timer);
            if (frame.ok) pending.resolve(frame);
            else pending.reject(new Error("Remote Agent request failed"));
            return;
          }
          throw new Error("Invalid runtime frame");
        },
        bytes,
      ).catch(() => this.disconnect(connection, "Runtime connection rejected"));
    });
    ws.on("close", () => this.disconnect(connection, "Runtime connection closed"));
    ws.on("error", () => this.disconnect(connection, "Runtime transport failed"));
  }

  private validAgentId(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.length <= AGENT_RUNTIME_LIMITS.maxAgentIdLength &&
      /^[A-Za-z0-9_-]+$/.test(value)
    );
  }

  private capabilities(frame: RuntimeFrame): Prisma.InputJsonObject {
    if (frame.capabilities === undefined) return {};
    if (!frame.capabilities || typeof frame.capabilities !== "object" || Array.isArray(frame.capabilities)) {
      throw new Error("Invalid runtime capabilities");
    }
    return frame.capabilities as Prisma.InputJsonObject;
  }

  private enqueue(connection: RuntimeConnection, operation: () => Promise<void>, bytes = 0): Promise<void> {
    if (
      connection.closed ||
      connection.queued >= AGENT_RUNTIME_LIMITS.maxQueuedFrames ||
      connection.queuedBytes + bytes > AGENT_RUNTIME_LIMITS.maxQueuedFrameBytes
    )
      return Promise.reject(new Error("Runtime connection unavailable"));
    connection.queued += 1;
    connection.queuedBytes += bytes;
    const task = connection.tail.then(async () => {
      if (connection.closed) throw new Error("Runtime connection unavailable");
      await operation();
    });
    connection.tail = task
      .catch(() => {})
      .finally(() => {
        connection.queued -= 1;
        connection.queuedBytes -= bytes;
      });
    return task;
  }

  private async requireActive(connection: RuntimeConnection): Promise<AgentRuntimeIdentity> {
    const identity = connection.identity;
    if (
      !identity ||
      this.sockets.get(identity.agentId) !== connection ||
      !(await this.repository.isRuntimeConnectionActive(identity)) ||
      connection.closed
    ) {
      throw new Error("Runtime connection unavailable");
    }
    return identity;
  }

  private disconnect(connection: RuntimeConnection, reason: string, code = 1008) {
    if (connection.closed) return;
    connection.closed = true;
    clearTimeout(connection.helloTimer);
    this.connections.delete(connection);
    const identity = connection.identity;
    if (identity && this.sockets.get(identity.agentId) === connection) this.sockets.delete(identity.agentId);
    for (const [id, pending] of this.pendingRequests) {
      if (pending.connection !== connection) continue;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(new Error(reason));
    }
    // Wait for an in-flight heartbeat/hello so cleanup uses its final lease, never a newer connection's lease.
    void connection.tail
      .then(async () => {
        if (connection.identity) await this.repository.markMachineOffline(connection.identity);
      })
      .catch(() => {});
    connection.ws.close(code, reason);
  }

  revokeMachine(machineId: string) {
    for (const connection of this.connections) {
      if (connection.identity?.id === machineId) this.disconnect(connection, "Machine registration revoked");
    }
  }

  async send(agentId: string, frame: RuntimeFrame): Promise<boolean> {
    const connection = this.sockets.get(agentId);
    if (!connection) return false;
    try {
      await this.enqueue(connection, async () => {
        await this.requireActive(connection);
        await this.write(connection, frame);
      });
      return true;
    } catch {
      this.disconnect(connection, "Runtime send rejected");
      return false;
    }
  }

  private write(connection: RuntimeConnection, frame: RuntimeFrame): Promise<void> {
    if (connection.closed || connection.ws.readyState !== connection.ws.OPEN)
      return Promise.reject(new Error("Remote Agent is not connected"));
    return new Promise((resolve, reject) => {
      connection.ws.send(JSON.stringify(frame) + "\n", (error) => (error ? reject(error) : resolve()));
    });
  }

  request(
    agentId: string,
    frame: { requestId: string; [key: string]: unknown },
    timeoutMs: number = AGENT_RUNTIME_LIMITS.requestTimeoutMs,
    expectedMachine?: { machineId: string; userId: string },
  ): Promise<RuntimeFrame> {
    const connection = this.sockets.get(agentId);
    if (!connection) return Promise.reject(new Error("Remote Agent is not connected"));
    return new Promise((resolve, reject) => {
      void this.enqueue(connection, async () => {
        const identity = await this.requireActive(connection);
        if (
          expectedMachine &&
          (identity.id !== expectedMachine.machineId || identity.userId !== expectedMachine.userId)
        )
          throw new Error("Runtime target identity mismatch");
        if (
          !frame.requestId ||
          this.pendingRequests.has(frame.requestId) ||
          this.pendingRequests.size >= AGENT_RUNTIME_LIMITS.maxPendingRequests
        ) {
          throw new Error("Runtime request unavailable");
        }
        const timer = setTimeout(() => {
          this.pendingRequests.delete(frame.requestId);
          reject(new Error("Remote Agent request timed out"));
        }, timeoutMs);
        const pending = { connection, resolve, reject, timer };
        this.pendingRequests.set(frame.requestId, pending);
        try {
          await this.write(connection, frame);
        } catch (error) {
          if (this.pendingRequests.get(frame.requestId) === pending) this.pendingRequests.delete(frame.requestId);
          clearTimeout(timer);
          throw error;
        }
      }).catch((error: Error) => {
        reject(error);
        this.disconnect(connection, "Runtime request rejected");
      });
    });
  }

  close() {
    for (const connection of this.connections)
      this.disconnect(connection, "Agent runtime gateway is shutting down", 1001);
    this.server.close();
  }
}
