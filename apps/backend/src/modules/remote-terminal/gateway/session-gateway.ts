import { env } from "@/config/env";
import type {
  TerminalSessionConnectionGuard,
  TerminalConnectionConditionContext,
} from "@/services/remote-terminal/remote-terminal-session-authority.service";
import { TERMINAL_BROWSER_FRAME_LIMITS } from "./browser-frame";
import { parseTerminalBrowserFrame } from "./browser-frame";
import {
  TERMINAL_SESSION_STORAGE,
  terminalSessionRedisKey as buildRemoteTerminalSessionRedisKey,
  type TerminalSessionMetadata,
} from "@/services/infrastructure/remote-terminal-session-projection";
import { terminalDeviceDenied } from "@/store/remote-terminal-product/remote-terminal-device-snapshot";
import { createHash, randomUUID } from "node:crypto";
import {
  RemoteTerminalDeviceProbeResponse,
  RemoteTerminalAgentPreferencesData,
  RemoteTerminalAgentToServerMessage,
  RemoteTerminalDirectoryBrowseResultMessage,
  RemoteTerminalPreferencesResultMessage,
  RemoteTerminalBrowserConnectedMessage,
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
  authorizeConnection?: TerminalSessionConnectionGuard;
  connectionContext?: TerminalConnectionConditionContext;
  attachmentPending?: boolean;
  forwardingReady?: boolean;
  frameTail?: Promise<void>;
  queuedFrames?: number;
  queuedBytes?: number;
  authorizationTimer?: ReturnType<typeof setInterval>;
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

const REMOTE_TERMINAL_SESSION_REDIS_PREFIX = TERMINAL_SESSION_STORAGE.prefix;
const REMOTE_TERMINAL_SESSION_REDIS_TTL_SECONDS = TERMINAL_SESSION_STORAGE.ttlSeconds;
const REMOTE_TERMINAL_SESSION_REDIS_SCAN_LIMIT = 500;
const TERMINAL_SESSION_RUNTIME_LIMITS = Object.freeze({
  queuedFrames: 64,
  queuedBytes: 4 * TERMINAL_BROWSER_FRAME_LIMITS.frameBytes,
  authorizationCheckMs: 15_000,
});
const REMOTE_TERMINAL_DIRECTORY_BROWSE_TIMEOUT_MS = 10_000;
const REMOTE_TERMINAL_PREFERENCES_TIMEOUT_MS = 10_000;
const REMOTE_TERMINAL_AGENT_PROBE_TIMEOUT_MS = 5_000;
const NATIVE_TERMINAL_PROBE_PREFIX = "quyan:iam-probe:";
function isNativeTerminalProbePong(payload: unknown): boolean {
  return (
    Buffer.isBuffer(payload) &&
    payload.subarray(0, NATIVE_TERMINAL_PROBE_PREFIX.length).toString() === NATIVE_TERMINAL_PROBE_PREFIX
  );
}

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
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalSessionCreateResponse> {
    await authorize?.();
    const device = await this.deviceRegistry.getAccessibleDevice(ownerUserId, request.deviceId);
    if (!device.online || !this.agentSockets.has(request.deviceId)) throw new Error("Device is offline.");

    const availableShells = device.snapshot.diagnostics.availableShells;
    if (!availableShells.includes(request.shellType))
      throw new Error(`Shell ${request.shellType} is not available on this device.`);

    const sessionId = randomUUID();
    const browserToken = randomUUID();
    const createdAt = new Date().toISOString();
    await authorize?.();
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

    try {
      await this.persistSession(
        {
          sessionId,
          ownerUserId,
          entitlementId: device.entitlementId,
          deviceId: request.deviceId,
          mode: request.mode,
          shellType: request.shellType,
          workingDirectory: request.workingDirectory,
          status: "pending",
          createdAt,
        },
        Boolean(authorize),
      );
      await authorize?.();
    } catch (error) {
      this.sessions.delete(sessionId);
      await this.deletePersistedSession(sessionId);
      throw error;
    }

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

  /** Compensate a rejected issuance only; never terminate a browser's active session. */
  public async discardPendingSession(ownerUserId: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerUserId !== ownerUserId || session.status !== "pending" || session.browserSocket)
      return;
    this.sessions.delete(sessionId);
    await this.deletePersistedSession(sessionId);
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

  private liveMetadata(session: RemoteTerminalSessionRecord): TerminalSessionMetadata {
    const summary = toSessionSummary(session);
    return {
      sessionId: session.sessionId,
      ownerUserId: session.ownerUserId,
      entitlementId: session.entitlementId,
      deviceId: session.deviceId,
      status: session.status,
      revision:
        "live:" +
        createHash("sha256")
          .update(JSON.stringify([session.ownerUserId, session.entitlementId, summary]))
          .digest("hex"),
    };
  }

  /** Complete metadata scan of old and new persisted sessions; no private source hydration. */
  public async listSessionMetadata(ownerUserId: string): Promise<TerminalSessionMetadata[]> {
    const records = new Map<string, TerminalSessionMetadata>();
    const seenKeys = new Set<string>(),
      seenCursors = new Set<string>();
    let cursor = "0";
    do {
      if (seenCursors.has(cursor)) throw terminalDeviceDenied();
      seenCursors.add(cursor);
      const page = await this.redisService.scanKeyPageWithResult(REMOTE_TERMINAL_SESSION_REDIS_PREFIX + ":*", cursor);
      if (!page) throw terminalDeviceDenied();
      cursor = page.cursor;
      const keys = [...new Set(page.keys)].filter((key) => !seenKeys.has(key));
      keys.forEach((key) => seenKeys.add(key));
      for (let offset = 0; offset < keys.length; offset += TERMINAL_SESSION_STORAGE.projectionBatchSize) {
        const batch = keys.slice(offset, offset + TERMINAL_SESSION_STORAGE.projectionBatchSize);
        const rows = await this.redisService.projectTerminalSessions(ownerUserId, batch);
        if (!rows || rows.length !== batch.length) throw terminalDeviceDenied();
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          if (row.state === "missing" || row.state === "foreign") continue;
          if (row.state !== "present" || row.metadata.ownerUserId !== ownerUserId) throw terminalDeviceDenied();
          if (batch[index] !== buildRemoteTerminalSessionRedisKey(row.metadata.sessionId)) throw terminalDeviceDenied();
          records.set(row.metadata.sessionId, row.metadata);
        }
      }
    } while (cursor !== "0");
    // Preserve live-over-persisted behavior without copying capability tokens or working directories.
    for (const session of this.sessions.values()) {
      if (session.ownerUserId === ownerUserId) records.set(session.sessionId, this.liveMetadata(session));
    }
    return [...records.values()];
  }

  /** Called only with admitted metadata. A changed/missing source fails the whole read. */
  public async hydrateSessionSummaries(
    ownerUserId: string,
    targets: readonly TerminalSessionMetadata[],
  ): Promise<RemoteTerminalSessionSummary[]> {
    const summaries = new Map<string, RemoteTerminalSessionSummary>();
    const persisted: TerminalSessionMetadata[] = [];
    if (new Set(targets.map((target) => target.sessionId)).size !== targets.length) throw terminalDeviceDenied();
    for (const target of targets) {
      if (target.ownerUserId !== ownerUserId) throw terminalDeviceDenied();
      const live = this.sessions.get(target.sessionId);
      if (live) {
        if (live.ownerUserId !== ownerUserId || this.liveMetadata(live).revision !== target.revision)
          throw terminalDeviceDenied();
        summaries.set(target.sessionId, toSessionSummary(live));
      } else {
        if (!target.revision.startsWith("redis:")) throw terminalDeviceDenied();
        persisted.push(target);
      }
    }
    for (let offset = 0; offset < persisted.length; offset += TERMINAL_SESSION_STORAGE.projectionBatchSize) {
      const batch = persisted.slice(offset, offset + TERMINAL_SESSION_STORAGE.projectionBatchSize);
      const rows = await this.redisService.projectTerminalSessions(
        ownerUserId,
        batch.map((target) => buildRemoteTerminalSessionRedisKey(target.sessionId)),
        batch.map((target) => target.revision),
      );
      if (!rows || rows.length !== batch.length) throw terminalDeviceDenied();
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index],
          target = batch[index];
        if (
          row.state !== "present" ||
          !row.summary ||
          row.metadata.sessionId !== target.sessionId ||
          row.metadata.ownerUserId !== ownerUserId ||
          row.metadata.revision !== target.revision ||
          row.metadata.deviceId !== target.deviceId ||
          row.metadata.entitlementId !== target.entitlementId ||
          row.metadata.status !== target.status ||
          this.sessions.has(target.sessionId)
        )
          throw terminalDeviceDenied();
        summaries.set(target.sessionId, row.summary);
      }
    }
    return targets.map((target) => summaries.get(target.sessionId)!);
  }

  public async closeAuthorizedPendingSessions(
    ownerUserId: string,
    deviceId: string,
    authorize: () => Promise<void>,
  ): Promise<void> {
    const rows = await this.listSessionMetadata(ownerUserId);
    for (const row of rows) {
      if (row.deviceId !== deviceId || row.status !== "pending") continue;
      await authorize();
      const live = this.sessions.get(row.sessionId);
      if (live) {
        if (
          live.ownerUserId !== ownerUserId ||
          live.deviceId !== deviceId ||
          live.status !== "pending" ||
          this.liveMetadata(live).revision !== row.revision
        )
          throw terminalDeviceDenied();
        this.stopSession(row.sessionId, "Session replaced by reconnect.");
        await this.deletePersistedSession(row.sessionId, true);
      } else {
        const deleted = await this.redisService.deletePendingTerminalSession(
          ownerUserId,
          deviceId,
          row.sessionId,
          row.revision,
        );
        if (deleted !== true) throw terminalDeviceDenied();
      }
    }
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
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalDirectoryBrowseResultMessage> {
    const device = await this.deviceRegistry.getAccessibleDevice(ownerUserId, deviceId);
    if (!device.online) throw new Error("Device is offline.");

    const agentSocket = this.agentSockets.get(deviceId);
    if (!agentSocket) throw new Error("Device is offline.");

    await authorize?.();
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

  public async getAgentPreferences(
    ownerUserId: string,
    deviceId: string,
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalAgentPreferencesData> {
    const response = await this.requestAgentPreferences(
      ownerUserId,
      deviceId,
      {
        type: "preferences-get",
        requestId: randomUUID(),
      },
      authorize,
    );

    return response.preferences;
  }

  public async updateAgentPreferences(
    ownerUserId: string,
    deviceId: string,
    preferences: RemoteTerminalAgentPreferencesData,
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalAgentPreferencesData> {
    const response = await this.requestAgentPreferences(
      ownerUserId,
      deviceId,
      {
        type: "preferences-set",
        requestId: randomUUID(),
        preferences,
      },
      authorize,
    );

    return response.preferences;
  }

  public attachAgent(deviceId: string, socket: WebSocket): void {
    const existing = this.agentSockets.get(deviceId);
    if (existing && existing !== socket) existing.close();

    this.agentSockets.set(deviceId, socket);
    void this.deviceRegistry.markOnline(deviceId, true);

    socket.on("pong", (payload: Buffer) => {
      // Native probes commit through the guarded repository; ordinary agent heartbeat behavior is unchanged.
      if (isNativeTerminalProbePong(payload)) return;
      void this.deviceRegistry.updateDeviceStatus(deviceId, {
        online: true,
        lastSeenAt: new Date(),
      });
    });

    socket.on("message", (buffer: Buffer) => {
      if (this.agentSockets.get(deviceId) !== socket) return;
      this.handleAgentMessage(deviceId, buffer.toString(), socket);
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

  public registerSessionAuthorization(
    ownerUserId: string,
    sessionId: string,
    guard: TerminalSessionConnectionGuard,
  ): void {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.ownerUserId !== ownerUserId ||
      session.status !== "pending" ||
      session.browserSocket ||
      session.attachmentPending ||
      session.authorizeConnection
    )
      throw terminalDeviceDenied();
    session.authorizeConnection = guard;
  }
  private browserTarget(sessionId: string, browserToken: string): RemoteTerminalSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown session.");
    if (session.browserToken !== browserToken) throw new Error("Invalid browser websocket token.");
    if (session.browserSocket || session.attachmentPending) throw new Error("Session already has an attached browser.");
    return session;
  }
  public attachBrowser(sessionId: string, browserToken: string, socket: WebSocket): void {
    const session = this.browserTarget(sessionId, browserToken);
    if (session.authorizeConnection || env.security.iamAuthorizationMode === "enforce") throw terminalDeviceDenied();
    session.browserSocket = socket;
    session.status = "connected";
    void this.persistSessionRecord(session);
    this.completeBrowserAttach(session, socket);
  }
  public async attachAuthorizedBrowser(
    sessionId: string,
    browserToken: string,
    socket: WebSocket,
    connection: TerminalConnectionConditionContext,
  ): Promise<void> {
    const session = this.browserTarget(sessionId, browserToken);
    if (!session.authorizeConnection) {
      this.attachBrowser(sessionId, browserToken, socket);
      return;
    }
    session.attachmentPending = true;
    try {
      const context = Object.freeze({ ...connection });
      await session.authorizeConnection(context);
      if (this.sessions.get(sessionId) !== session || socket.readyState !== WebSocket.OPEN)
        throw terminalDeviceDenied();
      session.browserSocket = socket;
      session.connectionContext = context;
      session.status = "connected";
      await this.persistSessionRecord(session, true);
      await session.authorizeConnection(context);
      if (this.sessions.get(sessionId) !== session || socket.readyState !== WebSocket.OPEN)
        throw terminalDeviceDenied();
      this.completeBrowserAttach(session, socket);
    } catch {
      this.stopSession(sessionId, "IAM session authorization failed.", 1008);
      throw terminalDeviceDenied();
    } finally {
      session.attachmentPending = false;
    }
  }
  private completeBrowserAttach(session: RemoteTerminalSessionRecord, socket: WebSocket): void {
    session.forwardingReady = true;
    session.authorizationTimer = setInterval(() => {
      if (session.authorizeConnection || env.security.iamAuthorizationMode === "enforce")
        this.enqueueSession(session, 0, () => undefined);
    }, TERMINAL_SESSION_RUNTIME_LIMITS.authorizationCheckMs);
    session.authorizationTimer.unref();
    socket.on("message", (buffer: Buffer) => {
      this.handleBrowserMessage(session.sessionId, buffer.toString());
    });

    socket.on("close", () => {
      this.stopSession(session.sessionId, "Browser disconnected.");
    });

    socket.on("error", () => {
      this.stopSession(session.sessionId, "Browser connection error.");
    });

    const connectedMessage: RemoteTerminalBrowserConnectedMessage = {
      type: "browser-connected",
      sessionId: session.sessionId,
    };
    sendJson(socket, connectedMessage);

    const agentSocket = this.agentSockets.get(session.deviceId);
    if (!agentSocket) {
      this.emitBrowserError(session.sessionId, "Agent is offline.");
      return;
    }

    const startMessage: RemoteTerminalServerToAgentMessage = {
      type: "session-start",
      sessionId: session.sessionId,
      mode: session.mode,
      shellType: session.shellType,
      workingDirectory: session.workingDirectory,
    };
    sendJson(agentSocket, startMessage);
  }

  private enqueueSession(session: RemoteTerminalSessionRecord, bytes: number, operation: () => void): void {
    if (!session.forwardingReady || this.sessions.get(session.sessionId) !== session) return;
    if (
      bytes > TERMINAL_BROWSER_FRAME_LIMITS.frameBytes ||
      (session.queuedFrames ?? 0) >= TERMINAL_SESSION_RUNTIME_LIMITS.queuedFrames ||
      (session.queuedBytes ?? 0) + bytes > TERMINAL_SESSION_RUNTIME_LIMITS.queuedBytes
    ) {
      this.stopSession(session.sessionId, "Session frame queue limit exceeded.", 1008);
      return;
    }
    if (!session.authorizeConnection && env.security.iamAuthorizationMode !== "enforce") {
      operation();
      return;
    }
    session.queuedFrames = (session.queuedFrames ?? 0) + 1;
    session.queuedBytes = (session.queuedBytes ?? 0) + bytes;
    session.frameTail = (session.frameTail ?? Promise.resolve())
      .then(async () => {
        if (this.sessions.get(session.sessionId) !== session) return;
        if (!session.authorizeConnection || !session.connectionContext) throw terminalDeviceDenied();
        await session.authorizeConnection(session.connectionContext);
        if (this.sessions.get(session.sessionId) !== session || session.browserSocket?.readyState !== WebSocket.OPEN)
          return;
        operation();
      })
      .catch(() => this.stopSession(session.sessionId, "IAM session authorization failed.", 1008))
      .finally(() => {
        session.queuedFrames = Math.max(0, (session.queuedFrames ?? 1) - 1);
        session.queuedBytes = Math.max(0, (session.queuedBytes ?? bytes) - bytes);
      });
  }

  private handleBrowserMessage(sessionId: string, raw: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const message = parseTerminalBrowserFrame(raw, sessionId);
    if (!message) {
      this.stopSession(sessionId, "Invalid browser frame.");
      return;
    }
    const agentSocket = this.agentSockets.get(session.deviceId);
    if (!agentSocket) {
      this.emitBrowserError(sessionId, "Agent is offline.");
      return;
    }

    if (message.type === "session-stop") {
      this.stopSession(sessionId, "Browser requested stop.");
      return;
    }
    this.enqueueSession(session, Buffer.byteLength(raw, "utf8"), () => {
      if (this.agentSockets.get(session.deviceId) !== agentSocket) return;
      if (message.type === "browser-ping") {
        sendJson<RemoteTerminalServerToBrowserMessage>(session.browserSocket!, {
          type: "browser-pong",
          ts: message.ts,
        });
        return;
      }
      sendJson(agentSocket, message);
    });
  }

  private handleAgentMessage(deviceId: string, raw: string, sourceSocket: WebSocket): void {
    let message: RemoteTerminalAgentToServerMessage;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        typeof (parsed as { type?: unknown }).type !== "string"
      )
        throw new Error("Invalid agent frame");
      message = parsed as RemoteTerminalAgentToServerMessage;
    } catch {
      this.agentSockets.get(deviceId)?.close(1008, "Invalid agent frame.");
      this.closeSessionsForDevice(deviceId, "Invalid agent frame.");
      return;
    }

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

    this.enqueueSession(session, Buffer.byteLength(raw, "utf8"), () => {
      if (this.agentSockets.get(deviceId) !== sourceSocket) return;
      sendJson<RemoteTerminalServerToBrowserMessage>(session.browserSocket!, message);
      if (message.type === "session-exit" || message.type === "session-error") this.cleanupSession(session.sessionId);
    });
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

  private stopSession(sessionId: string, reason: string, closeCode?: number): void {
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

    this.cleanupSession(sessionId, closeCode, reason);
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
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalPreferencesResultMessage> {
    const device = await this.deviceRegistry.getAccessibleDevice(ownerUserId, deviceId);
    if (!device.online) throw new Error("Device is offline.");

    const agentSocket = this.agentSockets.get(deviceId);
    if (!agentSocket) throw new Error("Device is offline.");

    await authorize?.();
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

  /** Native probing only performs transport I/O; guarded persistence belongs to the repository. */
  public async probeAuthorizedDevice(deviceId: string, authorize: () => Promise<void>): Promise<Date | null> {
    return this.probeAgentSocket(deviceId, authorize);
  }
  private async probeAgentSocket(deviceId: string, authorize?: () => Promise<void>): Promise<Date | null> {
    const agentSocket = this.agentSockets.get(deviceId);
    await authorize?.();
    if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) return null;
    const payload = authorize ? Buffer.from(NATIVE_TERMINAL_PROBE_PREFIX + randomUUID()) : undefined;
    return await new Promise<Date | null>((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        agentSocket.off("pong", handlePong);
      };
      const handlePong = (received?: Buffer) => {
        if (settled || (payload && (!Buffer.isBuffer(received) || !received.equals(payload)))) return;
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
        if (payload) agentSocket.ping(payload);
        else agentSocket.ping();
      } catch {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }
    });
  }
  private async probeSingleDevice(
    deviceId: string,
  ): Promise<{ deviceId: string; online: boolean; lastSeenAt: string }> {
    const pongAt = await this.probeAgentSocket(deviceId);
    await this.deviceRegistry.updateDeviceStatus(
      deviceId,
      pongAt ? { online: true, lastSeenAt: pongAt } : { online: false },
    );
    const device = await this.deviceRegistry.getDevice(deviceId);
    return { deviceId, online: Boolean(pongAt), lastSeenAt: device.lastSeenAt };
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

  private async persistSessionRecord(session: RemoteTerminalSessionRecord, confirmed = false): Promise<void> {
    await this.persistSession(
      {
        sessionId: session.sessionId,
        ownerUserId: session.ownerUserId,
        entitlementId: session.entitlementId,
        deviceId: session.deviceId,
        mode: session.mode,
        shellType: session.shellType,
        workingDirectory: session.workingDirectory,
        status: session.status,
        createdAt: session.createdAt,
      },
      confirmed,
    );
  }

  private cleanupSession(sessionId: string, closeCode?: number, reason?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.authorizationTimer) clearInterval(session.authorizationTimer);
    session.forwardingReady = false;
    const browserSocket = session.browserSocket;
    session.browserSocket = null;
    session.status = "closed";

    if (browserSocket && browserSocket.readyState === WebSocket.OPEN) {
      if (closeCode === undefined) browserSocket.close();
      else browserSocket.close(closeCode, reason);
    }

    this.sessions.delete(sessionId);
    void this.deletePersistedSession(sessionId);
  }

  private async persistSession(session: RemoteTerminalPersistedSessionRecord, confirmed = false): Promise<void> {
    if (confirmed) {
      if (
        (await this.redisService.setWithResult(
          buildRemoteTerminalSessionRedisKey(session.sessionId),
          JSON.stringify(session),
          REMOTE_TERMINAL_SESSION_REDIS_TTL_SECONDS,
        )) !== true
      )
        throw terminalDeviceDenied();
      return;
    }
    if (!this.redisService.isRedisAvailable()) return;

    await this.redisService.set(
      buildRemoteTerminalSessionRedisKey(session.sessionId),
      JSON.stringify(session),
      REMOTE_TERMINAL_SESSION_REDIS_TTL_SECONDS,
    );
  }

  private async deletePersistedSession(sessionId: string, confirmed = false): Promise<void> {
    if (confirmed) {
      if ((await this.redisService.delete(buildRemoteTerminalSessionRedisKey(sessionId))) === null)
        throw terminalDeviceDenied();
      return;
    }
    if (!this.redisService.isRedisAvailable()) return;

    await this.redisService.delete(buildRemoteTerminalSessionRedisKey(sessionId));
  }
}
