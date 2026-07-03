import { randomUUID } from "node:crypto";
import {
  RemoteTerminalDeviceProbeResponse,
  RemoteTerminalAgentPreferencesData,
  RemoteTerminalAgentToServerMessage,
  RemoteTerminalDirectoryBrowseResultMessage,
  RemoteTerminalPreferencesResultMessage,
  RemoteTerminalBrowserConnectedMessage,
  RemoteTerminalBrowserToServerMessage,
  RemoteTerminalServerToAgentMessage,
  RemoteTerminalServerToBrowserMessage,
  RemoteTerminalSessionCreateRequest,
  RemoteTerminalSessionCreateResponse,
  RemoteTerminalSessionSummary,
} from "@/modules/remote-terminal/protocol";
import { RedisService } from "@/services/infrastructure/redis.service";
import { WebSocket } from "ws";
import { RemoteTerminalDeviceRegistry } from "./device-registry";

interface RemoteTerminalSessionRecord {
  sessionId: string;
  ownerUserId: string;
  entitlementId: string;
  deviceId: string;
  mode: "shell";
  shellType: RemoteTerminalSessionCreateRequest["shellType"];
  workingDirectory?: string;
  status: "pending" | "connected" | "closed";
  createdAt: string;
  browserToken: string;
  browserSocket: WebSocket | null;
}

interface RemoteTerminalPersistedSessionRecord {
  sessionId: string;
  ownerUserId: string;
  entitlementId: string;
  deviceId: string;
  mode: "shell";
  shellType: RemoteTerminalSessionCreateRequest["shellType"];
  workingDirectory?: string;
  status: "pending" | "connected" | "closed";
  createdAt: string;
}

const REMOTE_TERMINAL_SESSION_REDIS_PREFIX = "remote_terminal:session";
const REMOTE_TERMINAL_SESSION_REDIS_TTL_SECONDS = 3 * 24 * 60 * 60;
const REMOTE_TERMINAL_SESSION_REDIS_SCAN_LIMIT = 500;
const REMOTE_TERMINAL_DIRECTORY_BROWSE_TIMEOUT_MS = 10_000;
const REMOTE_TERMINAL_PREFERENCES_TIMEOUT_MS = 10_000;
const REMOTE_TERMINAL_AGENT_PROBE_TIMEOUT_MS = 5_000;

interface PendingDirectoryBrowseRequest {
  deviceId: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (payload: RemoteTerminalDirectoryBrowseResultMessage) => void;
  reject: (error: Error) => void;
}

interface PendingPreferencesRequest {
  deviceId: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (payload: RemoteTerminalPreferencesResultMessage) => void;
  reject: (error: Error) => void;
}

function buildRemoteTerminalSessionRedisKey(sessionId: string): string {
  return `${REMOTE_TERMINAL_SESSION_REDIS_PREFIX}:${sessionId}`;
}

function toSessionSummary(session: RemoteTerminalPersistedSessionRecord): RemoteTerminalSessionSummary {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    mode: session.mode,
    shellType: session.shellType,
    status: session.status,
    createdAt: session.createdAt,
  };
}

function sendJson<T>(socket: WebSocket, payload: T): void {
  try {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  } catch {
    // Socket may have closed between the readyState check and the send call — ignore.
  }
}

export class RemoteTerminalSessionGateway {
  private readonly agentSockets = new Map<string, WebSocket>();
  private readonly sessions = new Map<string, RemoteTerminalSessionRecord>();
  private readonly pendingDirectoryBrowses = new Map<string, PendingDirectoryBrowseRequest>();
  private readonly pendingPreferencesRequests = new Map<string, PendingPreferencesRequest>();
  private readonly redisService = RedisService.getInstance();

  public constructor(private readonly deviceRegistry: RemoteTerminalDeviceRegistry) {}

  public async createSession(
    ownerUserId: string,
    request: RemoteTerminalSessionCreateRequest,
    browserWebSocketBaseUrl: string,
  ): Promise<RemoteTerminalSessionCreateResponse> {
    const device = await this.deviceRegistry.getAccessibleDevice(ownerUserId, request.deviceId);
    if (!device.online || !this.agentSockets.has(request.deviceId)) throw new Error("Device is offline.");

    const availableShells = device.snapshot.diagnostics.availableShells;
    if (!availableShells.includes(request.shellType))
      throw new Error(`Shell ${request.shellType} is not available on this device.`);

    const sessionId = randomUUID();
    const browserToken = randomUUID();
    const createdAt = new Date().toISOString();
    this.sessions.set(sessionId, {
      sessionId,
      ownerUserId,
      entitlementId: device.entitlementId,
      deviceId: request.deviceId,
      mode: request.mode,
      shellType: request.shellType,
      workingDirectory: request.workingDirectory,
      status: "pending",
      createdAt,
      browserToken,
      browserSocket: null,
    });

    await this.persistSession({
      sessionId,
      ownerUserId,
      entitlementId: device.entitlementId,
      deviceId: request.deviceId,
      mode: request.mode,
      shellType: request.shellType,
      workingDirectory: request.workingDirectory,
      status: "pending",
      createdAt,
    });

    return {
      sessionId,
      deviceId: request.deviceId,
      mode: request.mode,
      shellType: request.shellType,
      browserToken,
      websocketUrl: `${browserWebSocketBaseUrl}?role=browser&sessionId=${sessionId}&browserToken=${browserToken}`,
      createdAt,
    };
  }

  public async listSessions(ownerUserId: string): Promise<RemoteTerminalSessionSummary[]> {
    const persistedSessions = await this.loadPersistedSessions();

    for (const session of this.sessions.values()) {
      if (session.ownerUserId !== ownerUserId) continue;
      persistedSessions.set(session.sessionId, {
        sessionId: session.sessionId,
        ownerUserId: session.ownerUserId,
        entitlementId: session.entitlementId,
        deviceId: session.deviceId,
        mode: session.mode,
        shellType: session.shellType,
        workingDirectory: session.workingDirectory,
        status: session.status,
        createdAt: session.createdAt,
      });
    }

    return Array.from(persistedSessions.values())
      .filter((item) => item.ownerUserId === ownerUserId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toSessionSummary);
  }

  public async closeReconnectableSessions(ownerUserId: string, deviceId: string): Promise<void> {
    // Only close pending sessions (created but never connected — stale/orphaned).
    // Connected sessions are actively in use by a browser and must be preserved
    // to support multiple concurrent terminals on the same device.
    for (const session of this.sessions.values()) {
      if (session.ownerUserId !== ownerUserId || session.deviceId !== deviceId || session.status !== "pending")
        continue;

      this.stopSession(session.sessionId, "Session replaced by reconnect.");
    }

    const persistedSessions = await this.loadPersistedSessions();

    for (const session of persistedSessions.values()) {
      if (session.ownerUserId !== ownerUserId || session.deviceId !== deviceId || session.status !== "pending")
        continue;

      await this.deletePersistedSession(session.sessionId);
    }
  }

  public async browseDirectories(
    ownerUserId: string,
    deviceId: string,
    targetPath?: string,
  ): Promise<RemoteTerminalDirectoryBrowseResultMessage> {
    const device = await this.deviceRegistry.getAccessibleDevice(ownerUserId, deviceId);
    if (!device.online) throw new Error("Device is offline.");

    const agentSocket = this.agentSockets.get(deviceId);
    if (!agentSocket) throw new Error("Device is offline.");

    return await new Promise<RemoteTerminalDirectoryBrowseResultMessage>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingDirectoryBrowses.delete(requestId);
        reject(new Error("Remote directory browsing timed out."));
      }, REMOTE_TERMINAL_DIRECTORY_BROWSE_TIMEOUT_MS);

      this.pendingDirectoryBrowses.set(requestId, {
        deviceId,
        timer,
        resolve,
        reject,
      });

      sendJson<RemoteTerminalServerToAgentMessage>(agentSocket, {
        type: "directory-browse",
        requestId,
        path: targetPath,
      });
    });
  }

  public async getAgentPreferences(ownerUserId: string, deviceId: string): Promise<RemoteTerminalAgentPreferencesData> {
    const response = await this.requestAgentPreferences(ownerUserId, deviceId, {
      type: "preferences-get",
      requestId: randomUUID(),
    });

    return response.preferences;
  }

  public async updateAgentPreferences(
    ownerUserId: string,
    deviceId: string,
    preferences: RemoteTerminalAgentPreferencesData,
  ): Promise<RemoteTerminalAgentPreferencesData> {
    const response = await this.requestAgentPreferences(ownerUserId, deviceId, {
      type: "preferences-set",
      requestId: randomUUID(),
      preferences,
    });

    return response.preferences;
  }

  public attachAgent(deviceId: string, socket: WebSocket): void {
    const existing = this.agentSockets.get(deviceId);
    if (existing && existing !== socket) existing.close();

    this.agentSockets.set(deviceId, socket);
    void this.deviceRegistry.markOnline(deviceId, true);

    socket.on("pong", () => {
      void this.deviceRegistry.updateDeviceStatus(deviceId, {
        online: true,
        lastSeenAt: new Date(),
      });
    });

    socket.on("message", (buffer: Buffer) => {
      this.handleAgentMessage(deviceId, buffer.toString());
    });

    socket.on("close", () => {
      if (this.agentSockets.get(deviceId) === socket) {
        this.agentSockets.delete(deviceId);
        void this.deviceRegistry.markOnline(deviceId, false);
        this.rejectPendingDirectoryBrowsesForDevice(deviceId, "Agent disconnected.");
        this.rejectPendingPreferencesRequestsForDevice(deviceId, "Agent disconnected.");
        this.closeSessionsForDevice(deviceId, "Agent disconnected.");
      }
    });
  }

  public async probeDevices(ownerUserId: string): Promise<RemoteTerminalDeviceProbeResponse> {
    const devices = await this.deviceRegistry.listDevices(ownerUserId);

    const items = await Promise.all(
      devices.map(async (device) => {
        const probed = await this.probeSingleDevice(device.deviceId);
        return {
          deviceId: device.deviceId,
          online: probed.online,
          lastSeenAt: probed.lastSeenAt,
        };
      }),
    );

    return { items };
  }

  public attachBrowser(sessionId: string, browserToken: string, socket: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown session.");

    if (session.browserToken !== browserToken) throw new Error("Invalid browser websocket token.");

    if (session.browserSocket) throw new Error("Session already has an attached browser.");

    session.browserSocket = socket;
    session.status = "connected";
    void this.persistSessionRecord(session);

    socket.on("message", (buffer: Buffer) => {
      this.handleBrowserMessage(sessionId, buffer.toString());
    });

    socket.on("close", () => {
      this.stopSession(sessionId, "Browser disconnected.");
    });

    socket.on("error", () => {
      this.stopSession(sessionId, "Browser connection error.");
    });

    const connectedMessage: RemoteTerminalBrowserConnectedMessage = {
      type: "browser-connected",
      sessionId,
    };
    sendJson(socket, connectedMessage);

    const agentSocket = this.agentSockets.get(session.deviceId);
    if (!agentSocket) {
      this.emitBrowserError(sessionId, "Agent is offline.");
      return;
    }

    const startMessage: RemoteTerminalServerToAgentMessage = {
      type: "session-start",
      sessionId,
      mode: session.mode,
      shellType: session.shellType,
      workingDirectory: session.workingDirectory,
    };
    sendJson(agentSocket, startMessage);
  }

  private handleBrowserMessage(sessionId: string, raw: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const message = JSON.parse(raw) as RemoteTerminalBrowserToServerMessage;
    const agentSocket = this.agentSockets.get(session.deviceId);
    if (!agentSocket) {
      this.emitBrowserError(sessionId, "Agent is offline.");
      return;
    }

    if (message.type === "browser-ping") {
      sendJson<RemoteTerminalServerToBrowserMessage>(session.browserSocket!, { type: "browser-pong", ts: message.ts });
      return;
    }

    if (message.type === "session-stop") {
      this.stopSession(sessionId, "Browser requested stop.");
      return;
    }

    sendJson(agentSocket, message);
  }

  private handleAgentMessage(deviceId: string, raw: string): void {
    const message = JSON.parse(raw) as RemoteTerminalAgentToServerMessage;

    if (message.type === "directory-browse-result") {
      this.resolvePendingDirectoryBrowse(deviceId, message);
      return;
    }

    if (message.type === "preferences-result") {
      this.resolvePendingPreferencesRequest(deviceId, message);
      return;
    }

    const session = this.sessions.get(message.sessionId);
    if (!session || session.deviceId !== deviceId || !session.browserSocket) return;

    sendJson<RemoteTerminalServerToBrowserMessage>(session.browserSocket, message);

    if (message.type === "session-exit" || message.type === "session-error") this.cleanupSession(session.sessionId);
  }

  private emitBrowserError(sessionId: string, errorMessage: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.browserSocket) return;

    sendJson<RemoteTerminalServerToBrowserMessage>(session.browserSocket, {
      type: "session-error",
      sessionId,
      message: errorMessage,
    });
  }

  private stopSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const agentSocket = this.agentSockets.get(session.deviceId);
    if (agentSocket)
      sendJson<RemoteTerminalServerToAgentMessage>(agentSocket, {
        type: "session-stop",
        sessionId,
      });

    if (session.browserSocket && session.browserSocket.readyState === WebSocket.OPEN)
      sendJson<RemoteTerminalServerToBrowserMessage>(session.browserSocket, {
        type: "session-error",
        sessionId,
        message: reason,
      });

    this.cleanupSession(sessionId);
  }

  private closeSessionsForDevice(deviceId: string, reason: string): void {
    for (const session of this.sessions.values())
      if (session.deviceId === deviceId && session.status !== "closed") this.stopSession(session.sessionId, reason);
  }

  private resolvePendingDirectoryBrowse(deviceId: string, payload: RemoteTerminalDirectoryBrowseResultMessage): void {
    const pending = this.pendingDirectoryBrowses.get(payload.requestId);
    if (!pending || pending.deviceId !== deviceId) return;

    clearTimeout(pending.timer);
    this.pendingDirectoryBrowses.delete(payload.requestId);

    if (!payload.ok) {
      pending.reject(new Error(payload.message || "Unable to browse remote directory."));
      return;
    }

    pending.resolve(payload);
  }

  private rejectPendingDirectoryBrowsesForDevice(deviceId: string, reason: string): void {
    for (const [requestId, pending] of this.pendingDirectoryBrowses.entries()) {
      if (pending.deviceId !== deviceId) continue;

      clearTimeout(pending.timer);
      this.pendingDirectoryBrowses.delete(requestId);
      pending.reject(new Error(reason));
    }
  }

  private async requestAgentPreferences(
    ownerUserId: string,
    deviceId: string,
    message: Extract<RemoteTerminalServerToAgentMessage, { type: "preferences-get" } | { type: "preferences-set" }>,
  ): Promise<RemoteTerminalPreferencesResultMessage> {
    const device = await this.deviceRegistry.getAccessibleDevice(ownerUserId, deviceId);
    if (!device.online) throw new Error("Device is offline.");

    const agentSocket = this.agentSockets.get(deviceId);
    if (!agentSocket) throw new Error("Device is offline.");

    return await new Promise<RemoteTerminalPreferencesResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPreferencesRequests.delete(message.requestId);
        reject(new Error("Remote terminal preferences request timed out."));
      }, REMOTE_TERMINAL_PREFERENCES_TIMEOUT_MS);

      this.pendingPreferencesRequests.set(message.requestId, {
        deviceId,
        timer,
        resolve,
        reject,
      });

      sendJson<RemoteTerminalServerToAgentMessage>(agentSocket, message);
    });
  }

  private async probeSingleDevice(
    deviceId: string,
  ): Promise<{ deviceId: string; online: boolean; lastSeenAt: string }> {
    const agentSocket = this.agentSockets.get(deviceId);

    if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
      await this.deviceRegistry.updateDeviceStatus(deviceId, {
        online: false,
      });
      const device = await this.deviceRegistry.getDevice(deviceId);
      return {
        deviceId,
        online: false,
        lastSeenAt: device.lastSeenAt,
      };
    }

    const pongAt = await new Promise<Date | null>((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        agentSocket.off("pong", handlePong);
      };
      const handlePong = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(new Date());
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, REMOTE_TERMINAL_AGENT_PROBE_TIMEOUT_MS);

      agentSocket.on("pong", handlePong);

      try {
        agentSocket.ping();
      } catch {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }
    });

    if (!pongAt) {
      await this.deviceRegistry.updateDeviceStatus(deviceId, {
        online: false,
      });
      const device = await this.deviceRegistry.getDevice(deviceId);
      return {
        deviceId,
        online: false,
        lastSeenAt: device.lastSeenAt,
      };
    }

    await this.deviceRegistry.updateDeviceStatus(deviceId, {
      online: true,
      lastSeenAt: pongAt,
    });
    const device = await this.deviceRegistry.getDevice(deviceId);
    return {
      deviceId,
      online: true,
      lastSeenAt: device.lastSeenAt,
    };
  }

  private resolvePendingPreferencesRequest(deviceId: string, payload: RemoteTerminalPreferencesResultMessage): void {
    const pending = this.pendingPreferencesRequests.get(payload.requestId);
    if (!pending || pending.deviceId !== deviceId) return;

    clearTimeout(pending.timer);
    this.pendingPreferencesRequests.delete(payload.requestId);

    if (!payload.ok) {
      pending.reject(new Error(payload.message || "Unable to load remote terminal preferences."));
      return;
    }

    pending.resolve(payload);
  }

  private rejectPendingPreferencesRequestsForDevice(deviceId: string, reason: string): void {
    for (const [requestId, pending] of this.pendingPreferencesRequests.entries()) {
      if (pending.deviceId !== deviceId) continue;

      clearTimeout(pending.timer);
      this.pendingPreferencesRequests.delete(requestId);
      pending.reject(new Error(reason));
    }
  }

  private async loadPersistedSessions(): Promise<Map<string, RemoteTerminalPersistedSessionRecord>> {
    if (!this.redisService.isRedisAvailable()) return new Map();

    const keys = await this.redisService.getKeysByPattern(
      `${REMOTE_TERMINAL_SESSION_REDIS_PREFIX}:*`,
      REMOTE_TERMINAL_SESSION_REDIS_SCAN_LIMIT,
    );
    if (!keys.length) return new Map();

    const sessions = await Promise.all(keys.map(async (key) => this.readPersistedSession(key)));
    const map = new Map<string, RemoteTerminalPersistedSessionRecord>();

    for (const session of sessions) {
      if (!session) continue;
      map.set(session.sessionId, session);
    }

    return map;
  }

  private async readPersistedSession(redisKey: string): Promise<RemoteTerminalPersistedSessionRecord | null> {
    const raw = await this.redisService.get(redisKey);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as RemoteTerminalPersistedSessionRecord;
    } catch {
      return null;
    }
  }

  private async persistSessionRecord(session: RemoteTerminalSessionRecord): Promise<void> {
    await this.persistSession({
      sessionId: session.sessionId,
      ownerUserId: session.ownerUserId,
      entitlementId: session.entitlementId,
      deviceId: session.deviceId,
      mode: session.mode,
      shellType: session.shellType,
      workingDirectory: session.workingDirectory,
      status: session.status,
      createdAt: session.createdAt,
    });
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const browserSocket = session.browserSocket;
    session.browserSocket = null;
    session.status = "closed";

    if (browserSocket && browserSocket.readyState === WebSocket.OPEN) browserSocket.close();

    this.sessions.delete(sessionId);
    void this.deletePersistedSession(sessionId);
  }

  private async persistSession(session: RemoteTerminalPersistedSessionRecord): Promise<void> {
    if (!this.redisService.isRedisAvailable()) return;

    await this.redisService.set(
      buildRemoteTerminalSessionRedisKey(session.sessionId),
      JSON.stringify(session),
      REMOTE_TERMINAL_SESSION_REDIS_TTL_SECONDS,
    );
  }

  private async deletePersistedSession(sessionId: string): Promise<void> {
    if (!this.redisService.isRedisAvailable()) return;

    await this.redisService.delete(buildRemoteTerminalSessionRedisKey(sessionId));
  }
}
