import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { env } from "@/config/env";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RemoteTerminalSessionGateway } from "@/modules/remote-terminal/gateway/session-gateway";
import type { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
const mode = env.security.iamAuthorizationMode;
const redis = { isRedisAvailable: vi.fn(), set: vi.fn(), setWithResult: vi.fn(), delete: vi.fn() };
const registry = {
  getAccessibleDevice: vi.fn(),
  markOnline: vi.fn(),
  updateDeviceStatus: vi.fn(),
} as unknown as RemoteTerminalDeviceRegistry;
const socket = () => {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn().mockImplementation(() => {
    ws.readyState = WebSocket.CLOSED;
  });
  return ws;
};
let gateway: RemoteTerminalSessionGateway, agent: ReturnType<typeof socket>, browser: ReturnType<typeof socket>;
beforeEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  vi.spyOn(RedisService, "getInstance").mockReturnValue(redis as unknown as RedisService);
  redis.isRedisAvailable.mockReturnValue(true);
  redis.setWithResult.mockResolvedValue(true);
  redis.set.mockResolvedValue(undefined);
  redis.delete.mockResolvedValue(1);
  registry.getAccessibleDevice = vi.fn().mockResolvedValue({
    online: true,
    entitlementId: "entitlement",
    snapshot: { diagnostics: { availableShells: ["bash"] } },
  });
  registry.markOnline = vi.fn().mockResolvedValue(undefined);
  gateway = new RemoteTerminalSessionGateway(registry);
  agent = socket();
  browser = socket();
  gateway.attachAgent("device", agent as unknown as WebSocket);
});
afterEach(() => {
  browser.emit("close");
  agent.emit("close");
  env.security.iamAuthorizationMode = mode;
  vi.useRealTimers();
});
async function create(guard = vi.fn().mockResolvedValue(undefined)) {
  const created = await gateway.createSession(
    "actor",
    { deviceId: "device", mode: "shell", shellType: "bash" },
    "ws://fixture",
  );
  gateway.registerSessionAuthorization("actor", created.sessionId, guard);
  return created;
}
const sent = (ws: ReturnType<typeof socket>) => ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
describe("terminal session guarded lifecycle", () => {
  it("authorizes and confirms connected state before emitting browser readiness and agent start", async () => {
    const guard = vi.fn().mockResolvedValue(undefined),
      created = await create(guard);
    await gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {
      "acs:SecureTransport": true,
    });
    expect(guard).toHaveBeenCalledTimes(2);
    expect(guard.mock.calls[1][0]).toEqual({ "acs:SecureTransport": true });
    expect(redis.setWithResult).toHaveBeenCalled();
    expect(sent(agent).map((row) => row.type)).toEqual(["session-start"]);
    expect(sent(browser)[0].type).toBe("browser-connected");
  });
  it("does not start a denied connection and cannot bypass the async guard", async () => {
    const guard = vi.fn().mockRejectedValue(new Error("fixture denial")),
      created = await create(guard);
    expect(() =>
      gateway.attachBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket),
    ).toThrow();
    await expect(
      gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {}),
    ).rejects.toThrow();
    expect(sent(agent).some((row) => row.type === "session-start")).toBe(false);
  });
  it("rejects duplicate attachment while the first authorization is still pending", async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const guard = vi.fn().mockReturnValueOnce(blocked).mockResolvedValue(undefined),
      created = await create(guard);
    const first = gateway.attachAuthorizedBrowser(
      created.sessionId,
      created.browserToken,
      browser as unknown as WebSocket,
      {},
    );
    await expect(
      gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, socket() as unknown as WebSocket, {}),
    ).rejects.toThrow("already has");
    release();
    await first;
    expect(sent(agent).filter((row) => row.type === "session-start")).toHaveLength(1);
  });
  it("withholds start if confirmed persistence or the second check fails", async () => {
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked")),
      created = await create(guard);
    await expect(
      gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {}),
    ).rejects.toThrow();
    expect(sent(agent).some((row) => row.type === "session-start")).toBe(false);
    expect(browser.close).toHaveBeenCalledWith(1008, "IAM session authorization failed.");
  });
  it("serializes input and output and rejects data after revocation", async () => {
    const guard = vi.fn().mockResolvedValue(undefined),
      created = await create(guard);
    await gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {});
    agent.send.mockClear();
    browser.send.mockClear();
    browser.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "session-input", sessionId: created.sessionId, data: "first" })),
    );
    agent.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "session-output", sessionId: created.sessionId, stream: "stdout", data: "second" }),
      ),
    );
    await vi.waitFor(() => {
      expect(sent(agent)[0]?.data).toBe("first");
      expect(sent(browser)[0]?.data).toBe("second");
    });
    guard.mockRejectedValue(new Error("revoked"));
    browser.send.mockClear();
    agent.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "session-output",
          sessionId: created.sessionId,
          stream: "stdout",
          data: "must-not-forward",
        }),
      ),
    );
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledWith(1008, "IAM session authorization failed."));
    expect(sent(browser).some((row) => row.data === "must-not-forward")).toBe(false);
  });
  it("closes silent revoked sessions via periodic authorization and clears the timer", async () => {
    vi.useFakeTimers();
    const guard = vi.fn().mockResolvedValue(undefined),
      created = await create(guard);
    await gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {});
    guard.mockRejectedValue(new Error("revoked"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(browser.close).toHaveBeenCalledWith(1008, "IAM session authorization failed.");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds frame buffering while authorization is blocked", async () => {
    const guard = vi.fn().mockResolvedValue(undefined),
      created = await create(guard);
    await gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {});
    let release: () => void = () => undefined;
    guard.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    agent.send.mockClear();
    for (let index = 0; index < 65; index++)
      browser.emit(
        "message",
        Buffer.from(JSON.stringify({ type: "session-input", sessionId: created.sessionId, data: "queued" })),
      );
    expect(browser.close).toHaveBeenCalledWith(1008, "Session frame queue limit exceeded.");
    release();
    await Promise.resolve();
    expect(sent(agent).some((row) => row.type === "session-input")).toBe(false);
  });
  it("discards queued frames when their agent connection is replaced", async () => {
    const guard = vi.fn().mockResolvedValue(undefined),
      created = await create(guard);
    await gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {});
    let release: () => void = () => undefined;
    guard.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    agent.send.mockClear();
    browser.send.mockClear();
    browser.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "session-input", sessionId: created.sessionId, data: "stale-input" })),
    );
    agent.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "session-output",
          sessionId: created.sessionId,
          stream: "stdout",
          data: "stale-output",
        }),
      ),
    );
    const replacement = socket();
    gateway.attachAgent("device", replacement as unknown as WebSocket);
    // Replaced sockets cannot enqueue further output, even before their close event arrives.
    agent.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "session-output", sessionId: created.sessionId, stream: "stdout", data: "old-output" }),
      ),
    );
    release();
    await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(4));
    expect(sent(agent).some((row) => row.data === "stale-input")).toBe(false);
    expect(sent(browser).some((row) => ["stale-output", "old-output"].includes(row.data))).toBe(false);
    replacement.emit("close");
  });
  it("handles malformed agent JSON without an uncaught gateway exception", async () => {
    const created = await create();
    await gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {});
    expect(() => agent.emit("message", Buffer.from("{"))).not.toThrow();
    expect(agent.close).toHaveBeenCalledWith(1008, "Invalid agent frame.");
    expect(browser.close).toHaveBeenCalled();
  });
  it("rejects unguarded legacy sessions after a switch to enforce", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const created = await gateway.createSession(
      "actor",
      { deviceId: "device", mode: "shell", shellType: "bash" },
      "ws://fixture",
    );
    env.security.iamAuthorizationMode = "enforce";
    await expect(
      gateway.attachAuthorizedBrowser(created.sessionId, created.browserToken, browser as unknown as WebSocket, {}),
    ).rejects.toThrow();
    expect(sent(agent).some((row) => row.type === "session-start")).toBe(false);
  });
});
