import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RemoteTerminalDeviceRegistry } from "@/modules/remote-terminal/gateway/device-registry";
import { RemoteTerminalSessionGateway } from "@/modules/remote-terminal/gateway/session-gateway";
import { RedisService } from "@/services/infrastructure/redis.service";

describe("RemoteTerminalSessionGateway redis persistence", () => {
  const redis = {
    isRedisAvailable: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
    getKeysByPattern: vi.fn(),
    delete: vi.fn(),
  };

  const deviceRegistry = {
    getAccessibleDevice: vi.fn(),
    getDevice: vi.fn(),
    markOnline: vi.fn(),
    updateDeviceStatus: vi.fn(),
  } as unknown as RemoteTerminalDeviceRegistry;

  beforeEach(() => {
    vi.restoreAllMocks();
    redis.isRedisAvailable.mockReturnValue(true);
    redis.set.mockResolvedValue(undefined);
    redis.get.mockResolvedValue(null);
    redis.getKeysByPattern.mockResolvedValue([]);
    redis.delete.mockResolvedValue(1);
    deviceRegistry.getAccessibleDevice = vi.fn().mockResolvedValue({
      entitlementId: "ent-1",
      online: true,
      snapshot: {
        diagnostics: {
          availableShells: ["powershell", "cmd"],
        },
      },
    });
    deviceRegistry.markOnline = vi.fn();
    deviceRegistry.updateDeviceStatus = vi.fn();
    deviceRegistry.getDevice = vi.fn().mockResolvedValue({
      deviceId: "device-1",
      online: false,
      lastSeenAt: "2026-06-09T10:00:00.000Z",
    });
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redis as unknown as RedisService);
  });

  it("stores created sessions in redis with 3 day ttl", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);

    const created = await gateway.createSession(
      "user-1",
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      "ws://localhost/remote-terminal/ws",
    );

    expect(created.deviceId).toBe("device-1");
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      `remote_terminal:session:${created.sessionId}`,
      expect.stringContaining(`"sessionId":"${created.sessionId}"`),
      259200,
    );
  });

  it("lists persisted recent sessions from redis", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    redis.getKeysByPattern.mockResolvedValue(["remote_terminal:session:s-1"]);
    redis.get.mockResolvedValue(
      JSON.stringify({
        sessionId: "s-1",
        ownerUserId: "user-1",
        entitlementId: "ent-1",
        deviceId: "device-1",
        mode: "shell",
        shellType: "cmd",
        status: "closed",
        createdAt: "2026-06-09T10:00:00.000Z",
      }),
    );

    await expect(gateway.listSessions("user-1")).resolves.toEqual([
      {
        sessionId: "s-1",
        deviceId: "device-1",
        mode: "shell",
        shellType: "cmd",
        status: "closed",
        createdAt: "2026-06-09T10:00:00.000Z",
      },
    ]);
    expect(deviceRegistry.getAccessibleDevice).not.toHaveBeenCalled();
    expect(redis.getKeysByPattern).toHaveBeenCalledWith("remote_terminal:session:*", 500);
  });

  it("removes stale persisted sessions for same-device reconnect", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    redis.getKeysByPattern.mockResolvedValue(["remote_terminal:session:s-1", "remote_terminal:session:s-2"]);
    redis.get.mockImplementation(async (key: string) => {
      if (key === "remote_terminal:session:s-1")
        return JSON.stringify({
          sessionId: "s-1",
          ownerUserId: "user-1",
          entitlementId: "ent-1",
          deviceId: "device-1",
          mode: "shell",
          shellType: "cmd",
          status: "pending",
          createdAt: "2026-06-09T10:00:00.000Z",
        });

      return JSON.stringify({
        sessionId: "s-2",
        ownerUserId: "user-1",
        entitlementId: "ent-1",
        deviceId: "device-2",
        mode: "shell",
        shellType: "powershell",
        status: "pending",
        createdAt: "2026-06-09T11:00:00.000Z",
      });
    });

    await gateway.closeReconnectableSessions("user-1", "device-1");

    expect(redis.delete).toHaveBeenCalledWith("remote_terminal:session:s-1");
    expect(redis.delete).not.toHaveBeenCalledWith("remote_terminal:session:s-2");
  });

  it("preserves active in-memory sessions on same-device reconnect", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentSend = vi.fn();
    const agentSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: agentSend,
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;
    const browserSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);
    const created = await gateway.createSession(
      "user-1",
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      "ws://localhost/remote-terminal/ws",
    );

    gateway.attachBrowser(created.sessionId, created.browserToken, browserSocket);
    redis.delete.mockClear();
    agentSend.mockClear();

    // Connected sessions should NOT be closed by closeReconnectableSessions
    await gateway.closeReconnectableSessions("user-1", "device-1");

    expect(agentSend).not.toHaveBeenCalled();
    expect(redis.delete).not.toHaveBeenCalled();
    const sessions = await gateway.listSessions("user-1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(created.sessionId);
    expect(sessions[0].status).toBe("connected");
  });

  it("stops pending in-memory sessions for same-device reconnect", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentSend = vi.fn();
    const agentSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: agentSend,
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);
    const created = await gateway.createSession(
      "user-1",
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      "ws://localhost/remote-terminal/ws",
    );

    redis.delete.mockClear();
    agentSend.mockClear();

    // Pending sessions (no browser attached) SHOULD be closed
    await gateway.closeReconnectableSessions("user-1", "device-1");

    expect(agentSend).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session-stop",
        sessionId: created.sessionId,
      }),
    );
    expect(redis.delete).toHaveBeenCalledWith(`remote_terminal:session:${created.sessionId}`);
    await expect(gateway.listSessions("user-1")).resolves.toEqual([]);
  });

  it("fails open when redis is unavailable", async () => {
    redis.isRedisAvailable.mockReturnValue(false);
    redis.set.mockClear();
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);

    await expect(gateway.listSessions("user-1")).resolves.toEqual([]);
    await expect(
      gateway.createSession(
        "user-1",
        {
          deviceId: "device-1",
          mode: "shell",
          shellType: "powershell",
        },
        "ws://localhost/remote-terminal/ws",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      }),
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("removes persisted and in-memory session when browser requests stop", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;
    const browserHandlers = new Map<string, (payload?: Buffer) => void>();
    const browserSocket = {
      on: vi.fn((event: string, handler: (payload?: Buffer) => void) => {
        browserHandlers.set(event, handler);
      }),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);
    const created = await gateway.createSession(
      "user-1",
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      "ws://localhost/remote-terminal/ws",
    );

    redis.set.mockClear();
    gateway.attachBrowser(created.sessionId, created.browserToken, browserSocket);
    browserHandlers.get("message")?.(
      Buffer.from(JSON.stringify({ type: "session-stop", sessionId: created.sessionId })),
    );
    await Promise.resolve();

    await expect(gateway.listSessions("user-1")).resolves.toEqual([]);
    expect(redis.delete).toHaveBeenCalledWith(`remote_terminal:session:${created.sessionId}`);
    expect(browserSocket.close).toHaveBeenCalledTimes(1);
    expect(agentSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session-stop",
        sessionId: created.sessionId,
      }),
    );
  });

  it("removes persisted and in-memory session when browser disconnects", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;
    const browserHandlers = new Map<string, () => void>();
    const browserSocket = {
      on: vi.fn((event: string, handler: () => void) => {
        browserHandlers.set(event, handler);
      }),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.CLOSED,
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);
    const created = await gateway.createSession(
      "user-1",
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      "ws://localhost/remote-terminal/ws",
    );

    redis.set.mockClear();
    gateway.attachBrowser(created.sessionId, created.browserToken, browserSocket);
    browserHandlers.get("close")?.();
    await Promise.resolve();

    await expect(gateway.listSessions("user-1")).resolves.toEqual([]);
    expect(redis.delete).toHaveBeenCalledWith(`remote_terminal:session:${created.sessionId}`);
    expect(browserSocket.close).not.toHaveBeenCalled();
    expect(agentSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session-stop",
        sessionId: created.sessionId,
      }),
    );
  });

  it("removes persisted and in-memory sessions when agent disconnects", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const agentHandlers = new Map<string, () => void>();
    const agentSocket = {
      on: vi.fn((event: string, handler: () => void) => {
        agentHandlers.set(event, handler);
      }),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;
    const browserSocket = {
      on: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WebSocket;

    gateway.attachAgent("device-1", agentSocket);
    const created = await gateway.createSession(
      "user-1",
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      "ws://localhost/remote-terminal/ws",
    );

    redis.set.mockClear();
    gateway.attachBrowser(created.sessionId, created.browserToken, browserSocket);
    agentHandlers.get("close")?.();
    await Promise.resolve();

    await expect(gateway.listSessions("user-1")).resolves.toEqual([]);
    expect(redis.delete).toHaveBeenCalledWith(`remote_terminal:session:${created.sessionId}`);
    expect(browserSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session-error",
        sessionId: created.sessionId,
        message: "Agent disconnected.",
      }),
    );
    expect(browserSocket.close).toHaveBeenCalledTimes(1);
  });

  it("keeps lastSeenAt unchanged when offline probe finds no live agent socket", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
    const listedAt = "2026-06-09T10:00:00.000Z";
    deviceRegistry.getAccessibleDevice = vi.fn();
    deviceRegistry.listDevices = vi.fn().mockResolvedValue([
      {
        deviceId: "device-1",
        online: false,
        lastSeenAt: listedAt,
      },
    ]);
    deviceRegistry.getDevice = vi.fn().mockResolvedValue({
      deviceId: "device-1",
      online: false,
      lastSeenAt: listedAt,
    });

    await expect(gateway.probeDevices("user-1")).resolves.toEqual({
      items: [
        {
          deviceId: "device-1",
          online: false,
          lastSeenAt: listedAt,
        },
      ],
    });
    expect(deviceRegistry.updateDeviceStatus).toHaveBeenCalledWith("device-1", {
      online: false,
    });
  });
});
