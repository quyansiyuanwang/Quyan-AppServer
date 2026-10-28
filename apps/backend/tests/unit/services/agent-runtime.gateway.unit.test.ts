import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRepository, AgentRuntimeIdentity } from "@/store/agent/agent.repository";
import { mockDeep } from "vitest-mock-extended";

const transport = vi.hoisted(() => ({ upgrade: vi.fn(), close: vi.fn() }));
vi.mock("ws", () => ({
  WebSocketServer: class {
    handleUpgrade = transport.upgrade;
    close = transport.close;
  },
}));
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
import { AgentRuntimeGateway } from "@/services/agent/agent-runtime.gateway";
import { AGENT_RUNTIME_LIMITS } from "@/services/agent/agent-runtime.policy";

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  send = vi.fn((_value: string, callback: (error?: Error) => void) => callback());
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit("close");
  });
  frame(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
}
const Gateway = AgentRuntimeGateway as unknown as new (repository: AgentRepository) => AgentRuntimeGateway;
const hello = (agentId = "agent-1") => ({ type: "hello", protocolVersion: 1, agentId });
const identity = (id = "machine-1", agentId = "agent-1"): AgentRuntimeIdentity => ({
  id,
  agentId,
  userId: "actor",
  accountOwnerId: "owner",
  updateTime: new Date(1),
});
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
let gateway: AgentRuntimeGateway;
let repository: ReturnType<typeof mockDeep<AgentRepository>>;
const connect = (token = "fixture-registration-token") => {
  const socket = new Socket();
  transport.upgrade.mockImplementationOnce((_request, _socket, _head, accept) => accept(socket));
  gateway.handleUpgrade(
    { url: "/agent-runtime/ws", headers: { authorization: "Bearer " + token } } as IncomingMessage,
    { destroy: vi.fn() } as unknown as Duplex,
    Buffer.alloc(0),
  );
  return socket;
};
beforeEach(() => {
  vi.clearAllMocks();
  repository = mockDeep<AgentRepository>();
  repository.connectRuntimeMachine.mockResolvedValue(identity());
  repository.isRuntimeConnectionActive.mockResolvedValue(true);
  repository.markMachineHeartbeat.mockImplementation(async (current) => ({
    ...current,
    updateTime: new Date(current.updateTime.getTime() + 1),
  }));
  gateway = new Gateway(repository);
});
afterEach(async () => {
  gateway.close();
  await flush();
  vi.useRealTimers();
});

describe("Agent runtime connection authorization", () => {
  it("requires a Bearer credential and hashes it only for machine lookup", async () => {
    const destroy = vi.fn();
    expect(
      gateway.handleUpgrade(
        { url: "/other", headers: {} } as IncomingMessage,
        { destroy } as unknown as Duplex,
        Buffer.alloc(0),
      ),
    ).toBe(false);
    gateway.handleUpgrade(
      { url: "/agent-runtime/ws", headers: { authorization: "raw-token" } } as IncomingMessage,
      { destroy } as unknown as Duplex,
      Buffer.alloc(0),
    );
    expect(destroy).toHaveBeenCalledOnce();
    const socket = connect();
    socket.frame(hello());
    await flush();
    expect(repository.connectRuntimeMachine).toHaveBeenCalledWith(
      createHash("sha256").update("fixture-registration-token").digest("hex"),
      "agent-1",
      {},
    );
  });
  it.each([
    { type: "response", requestId: "other-request", ok: true },
    { type: "heartbeat", agentId: "agent-1" },
    { ...hello(), protocolVersion: 2 },
    { ...hello(), agentId: "../other" },
    { ...hello(), agentId: "a".repeat(121) },
    { ...hello(), capabilities: [] },
  ])("rejects unauthenticated or invalid frames: %j", async (frame) => {
    const socket = connect();
    socket.frame(frame);
    await flush();
    expect(socket.close).toHaveBeenCalledWith(1008, expect.any(String));
    expect(repository.connectRuntimeMachine).not.toHaveBeenCalled();
  });
  it("rejects invalid credentials and database failures without publishing the connection", async () => {
    repository.connectRuntimeMachine
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("private database error"));
    for (let i = 0; i < 2; i++) {
      const socket = connect();
      socket.frame(hello());
      await flush();
      expect(socket.close).toHaveBeenCalledWith(1008, "Runtime connection rejected");
      expect(await gateway.send("agent-1", {})).toBe(false);
    }
  });
  it("does not authenticate twice or accept a heartbeat for a different machine", async () => {
    const socket = connect();
    socket.frame(hello());
    await flush();
    socket.frame({ type: "heartbeat", agentId: "victim" });
    await flush();
    expect(repository.markMachineHeartbeat).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
    const repeated = connect();
    repeated.frame(hello());
    repeated.frame(hello());
    await flush();
    expect(repeated.close).toHaveBeenCalled();
    expect(repository.connectRuntimeMachine).toHaveBeenCalledTimes(2);
  });
  it("binds responses to their originating authenticated socket", async () => {
    const first = connect();
    first.frame(hello());
    await flush();
    repository.connectRuntimeMachine.mockResolvedValueOnce(identity("machine-2", "agent-2"));
    const second = connect("other-fixture-token");
    second.frame(hello("agent-2"));
    await flush();
    const pending = gateway.request("agent-1", { requestId: "request-1", type: "workspace.create" });
    await flush();
    second.frame({ type: "response", requestId: "request-1", ok: true, data: { handle: "forged" } });
    await flush();
    expect(second.close).toHaveBeenCalled();
    first.frame({ type: "response", requestId: "request-1", ok: true, data: { handle: "valid" } });
    await expect(pending).resolves.toMatchObject({ data: { handle: "valid" } });
  });
  it("refuses task dispatch when the connected machine differs from the authorized target", async () => {
    const socket = connect();
    socket.frame(hello());
    await flush();
    await expect(
      gateway.request("agent-1", { requestId: "request-1" }, undefined, {
        machineId: "other-machine",
        userId: "actor",
      }),
    ).rejects.toThrow("Runtime target identity mismatch");
    expect(socket.send).not.toHaveBeenCalled();
  });
  it("rechecks revocation before sending work and accepting responses", async () => {
    const socket = connect();
    socket.frame(hello());
    await flush();
    const pending = gateway.request("agent-1", { requestId: "request-1" });
    const rejection = expect(pending).rejects.toThrow("Runtime connection rejected");
    await flush();
    repository.isRuntimeConnectionActive.mockResolvedValue(false);
    socket.frame({ type: "response", requestId: "request-1", ok: true });
    await rejection;
    expect(socket.close).toHaveBeenCalled();
    const next = connect();
    repository.isRuntimeConnectionActive.mockResolvedValue(true);
    next.frame(hello());
    await flush();
    repository.isRuntimeConnectionActive.mockResolvedValue(false);
    await expect(gateway.request("agent-1", { requestId: "request-2" })).rejects.toThrow(
      "Runtime connection unavailable",
    );
    expect(next.send).not.toHaveBeenCalled();
  });
  it("actively disconnects a revoked machine and rejects its pending work", async () => {
    const socket = connect();
    socket.frame(hello());
    await flush();
    const pending = gateway.request("agent-1", { requestId: "request-1" });
    const rejection = expect(pending).rejects.toThrow("Machine registration revoked");
    await flush();
    gateway.revokeMachine("machine-1");
    await rejection;
    expect(socket.close).toHaveBeenCalled();
    expect(await gateway.send("agent-1", {})).toBe(false);
  });
  it("keeps replacement connections alive when an older socket closes", async () => {
    const old = connect();
    old.frame(hello());
    await flush();
    repository.connectRuntimeMachine.mockResolvedValueOnce({ ...identity(), updateTime: new Date(2) });
    const next = connect();
    next.frame(hello());
    await flush();
    old.emit("close");
    await flush();
    expect(old.close).toHaveBeenCalled();
    expect(next.close).not.toHaveBeenCalled();
    expect(await gateway.send("agent-1", { type: "ping" })).toBe(true);
    expect(repository.markMachineOffline).toHaveBeenCalledWith(identity());
  });
  it("serializes heartbeats with sends and uses the latest database lease", async () => {
    const socket = connect();
    socket.frame(hello());
    await flush();
    socket.frame({ type: "heartbeat", agentId: "agent-1", capabilities: { docker: true } });
    await expect(gateway.send("agent-1", { type: "ping" })).resolves.toBe(true);
    expect(repository.isRuntimeConnectionActive).toHaveBeenLastCalledWith({ ...identity(), updateTime: new Date(2) });
  });
  it("rejects pending work on disconnect and times out unanswered requests", async () => {
    vi.useFakeTimers();
    const socket = connect();
    socket.frame(hello());
    await flush();
    const pending = gateway.request("agent-1", { requestId: "request-1" }, 100);
    const timedOut = expect(pending).rejects.toThrow("timed out");
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    const second = gateway.request("agent-1", { requestId: "request-2" });
    const closed = expect(second).rejects.toThrow("Runtime connection closed");
    await flush();
    socket.emit("close");
    await closed;
  });
  it("expires unauthenticated sockets and rejects excessive frame queues", async () => {
    vi.useFakeTimers();
    const idle = connect();
    await vi.advanceTimersByTimeAsync(AGENT_RUNTIME_LIMITS.helloTimeoutMs);
    expect(idle.close).toHaveBeenCalledWith(1008, "Runtime authentication timed out");
    const flood = connect();
    for (let i = 0; i <= AGENT_RUNTIME_LIMITS.maxQueuedFrames; i++) flood.frame(hello());
    await flush();
    expect(flood.close).toHaveBeenCalled();
  });
  it("rejects oversized frames and excessive queued bytes before database authentication", async () => {
    const oversized = connect();
    oversized.emit("message", Buffer.alloc(AGENT_RUNTIME_LIMITS.maxFrameBytes + 1));
    expect(oversized.close).toHaveBeenCalledWith(1008, "Runtime frame too large");
    expect(repository.connectRuntimeMachine).not.toHaveBeenCalled();
    const queued = connect();
    const payload = Buffer.from(JSON.stringify(hello()) + " ".repeat(AGENT_RUNTIME_LIMITS.maxFrameBytes / 2));
    for (let i = 0; i < 4; i++) queued.emit("message", payload);
    await flush();
    expect(queued.close).toHaveBeenCalled();
    expect(await gateway.send("agent-1", {})).toBe(false);
  });
  it("closes malformed JSON without looking up machine credentials", async () => {
    const socket = connect();
    socket.emit("message", Buffer.from("{bad-json"));
    await flush();
    expect(socket.close).toHaveBeenCalled();
    expect(repository.connectRuntimeMachine).not.toHaveBeenCalled();
  });
  it("cleans up a connection revoked while hello is still being authenticated", async () => {
    let finish!: (value: AgentRuntimeIdentity) => void;
    repository.connectRuntimeMachine.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const socket = connect();
    socket.frame(hello());
    await flush();
    socket.emit("close");
    finish(identity());
    await flush();
    expect(repository.markMachineOffline).toHaveBeenCalledWith(identity());
    expect(await gateway.send("agent-1", {})).toBe(false);
  });
  it("does not expose remote error text and closes connections on send failure", async () => {
    const socket = connect();
    socket.frame(hello());
    await flush();
    const pending = gateway.request("agent-1", { requestId: "request-1" });
    const rejected = expect(pending).rejects.toThrow(/^Remote Agent request failed$/);
    await flush();
    socket.frame({ type: "response", requestId: "request-1", ok: false, error: "private remote diagnostics" });
    await rejected;
    socket.send.mockImplementationOnce((_value, callback) => callback(new Error("send failed")));
    expect(await gateway.send("agent-1", {})).toBe(false);
    expect(socket.close).toHaveBeenCalled();
  });
});
