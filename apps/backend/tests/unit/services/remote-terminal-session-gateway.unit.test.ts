import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
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
  it.each(["directories", "preferences", "preferences-set"] as const)(
    "denies %s dispatch after accessible device lookup",
    async (kind) => {
      const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
      const agentSocket = {
        readyState: WebSocket.OPEN,
        on: vi.fn(),
        close: vi.fn(),
        send: vi.fn(),
      } as unknown as WebSocket;
      gateway.attachAgent("device-1", agentSocket);
      const authorize = vi.fn(async () => {
        throw new Error("fixture authorization denied");
      });
      await expect(
        kind === "directories"
          ? gateway.browseDirectories("user-1", "device-1", "/fixture", authorize)
          : kind === "preferences-set"
            ? gateway.updateAgentPreferences("user-1", "device-1", { shortcuts: [], quickCommands: [] }, authorize)
            : gateway.getAgentPreferences("user-1", "device-1", authorize),
      ).rejects.toThrow("fixture authorization denied");
      expect(deviceRegistry.getAccessibleDevice).toHaveBeenCalledWith("user-1", "device-1");
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(agentSocket.send).not.toHaveBeenCalled();
      expect(gateway["pendingDirectoryBrowses"].size).toBe(0);
      expect(gateway["pendingPreferencesRequests"].size).toBe(0);
    },
  );
  it.each(["directories", "preferences", "preferences-set"] as const)(
    "allows %s dispatch only after the guard resolves",
    async (kind) => {
      const gateway = new RemoteTerminalSessionGateway(deviceRegistry);
      const events: string[] = [];
      const agentSocket = {
        readyState: WebSocket.OPEN,
        on: vi.fn(),
        close: vi.fn(),
        send: vi.fn((raw: string) => {
          events.push("send");
          const message = JSON.parse(raw);
          gateway["handleAgentMessage"](
            "device-1",
            JSON.stringify(
              kind === "directories"
                ? {
                    type: "directory-browse-result",
                    requestId: message.requestId,
                    ok: true,
                    currentPath: "/fixture",
                    items: [],
                  }
                : {
                    type: "preferences-result",
                    requestId: message.requestId,
                    ok: true,
                    preferences: { shortcuts: [], quickCommands: [] },
                  },
            ),
          );
        }),
      } as unknown as WebSocket;
      gateway.attachAgent("device-1", agentSocket);
      const authorize = async () => {
        events.push("authorize");
      };
      await (kind === "directories"
        ? gateway.browseDirectories("user-1", "device-1", "/fixture", authorize)
        : kind === "preferences-set"
          ? gateway.updateAgentPreferences("user-1", "device-1", { shortcuts: [], quickCommands: [] }, authorize)
          : gateway.getAgentPreferences("user-1", "device-1", authorize));
      expect(events).toEqual(["authorize", "send"]);
      expect(agentSocket.send).toHaveBeenCalledTimes(1);
    },
  );
  it("never pings a native device when its authorization guard denies", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry),
      socket = { readyState: WebSocket.OPEN, on: vi.fn(), off: vi.fn(), ping: vi.fn() } as unknown as WebSocket;
    gateway["agentSockets"].set("device-1", socket);
    await expect(
      gateway.probeAuthorizedDevice("device-1", async () => {
        throw new Error("fixture denied");
      }),
    ).rejects.toThrow("fixture denied");
    expect(socket.ping).not.toHaveBeenCalled();
    expect(deviceRegistry.updateDeviceStatus).not.toHaveBeenCalled();
    expect(deviceRegistry.getDevice).not.toHaveBeenCalled();
  });
  it("returns an offline native probe without reading or mutating device credentials", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry),
      guard = vi.fn(async () => {});
    expect(await gateway.probeAuthorizedDevice("device-1", guard)).toBeNull();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(deviceRegistry.getDevice).not.toHaveBeenCalled();
    expect(deviceRegistry.updateDeviceStatus).not.toHaveBeenCalled();
  });
  it("runs authorization before an online native probe and leaves persistence to the caller", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry),
      events: string[] = [];
    let pong: ((payload: Buffer) => void) | undefined;
    const socket = {
      readyState: WebSocket.OPEN,
      on: vi.fn((name: string, handler: (payload: Buffer) => void) => {
        if (name === "pong") pong = handler;
      }),
      off: vi.fn(),
      ping: vi.fn((payload: Buffer) => {
        events.push("ping");
        pong?.(Buffer.from("wrong-pong"));
        pong?.(payload);
      }),
    } as unknown as WebSocket;
    gateway["agentSockets"].set("device-1", socket);
    const result = await gateway.probeAuthorizedDevice("device-1", async () => {
      events.push("authorize");
    });
    expect(result).toBeInstanceOf(Date);
    expect(events).toEqual(["authorize", "ping"]);
    expect(deviceRegistry.getDevice).not.toHaveBeenCalled();
    expect(deviceRegistry.updateDeviceStatus).not.toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalledWith("pong", expect.any(Function));
  });

  it("does not let tagged IAM probe pongs bypass guarded status persistence", async () => {
    const gateway = new RemoteTerminalSessionGateway(deviceRegistry),
      socket = Object.assign(new EventEmitter(), {
        readyState: WebSocket.OPEN,
        ping: vi.fn((payload: Buffer) => {
          socket.emit("pong", payload);
        }),
        close: vi.fn(),
        send: vi.fn(),
      });
    gateway.attachAgent("device-1", socket as unknown as WebSocket);
    expect(await gateway.probeAuthorizedDevice("device-1", async () => {})).toBeInstanceOf(Date);
    expect(deviceRegistry.updateDeviceStatus).not.toHaveBeenCalled();
    socket.emit("pong", Buffer.from("regular-heartbeat"));
    expect(deviceRegistry.updateDeviceStatus).toHaveBeenCalledWith("device-1", {
      online: true,
      lastSeenAt: expect.any(Date),
    });
  });
});
