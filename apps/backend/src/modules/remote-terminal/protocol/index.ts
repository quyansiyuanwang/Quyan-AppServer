export type RemoteTerminalPlatformId = "windows" | "linux" | "macos";
export type RemoteTerminalProtocolShellType = "system-default" | "cmd" | "powershell" | "pwsh" | "bash" | "zsh" | "sh";

export interface RemoteTerminalAgentCapabilities {
  sshForward: boolean;
  nativePty: boolean;
  selfUpdate: boolean;
  proxyAware: boolean;
  serviceManaged: boolean;
  sessionRecording: boolean;
}

export interface RemoteTerminalHostDiagnostics {
  installFormats: string[];
  serviceManager: string;
  defaultLogPath: string;
  availableShells: RemoteTerminalProtocolShellType[];
  sshCheck: {
    available: boolean;
    detail: string;
  };
  notes: string[];
}

export interface RemoteTerminalHostSnapshot {
  hostname: string;
  platform: RemoteTerminalPlatformId;
  arch: string;
  agentVersion: string;
  capabilities: RemoteTerminalAgentCapabilities;
  diagnostics: RemoteTerminalHostDiagnostics;
}

export interface RemoteTerminalAgentRegistrationRequest {
  registrationToken: string;
  deviceFingerprint: string;
  fingerprintVersion: string;
  snapshot: RemoteTerminalHostSnapshot;
}

export interface RemoteTerminalAgentRegistrationResponse {
  deviceId: string;
  heartbeatIntervalSeconds: number;
  heartbeatToken: string;
  acceptedAt: string;
}

export interface RemoteTerminalAgentHeartbeatRequest {
  deviceId: string;
  heartbeatToken: string;
  snapshot: RemoteTerminalHostSnapshot;
}

export interface RemoteTerminalAgentHeartbeatResponse {
  ok: true;
  nextHeartbeatIntervalSeconds: number;
  serverTime: string;
}

export interface RemoteTerminalDeviceSummary {
  deviceId: string;
  hostname: string;
  platform: RemoteTerminalHostSnapshot["platform"];
  arch: string;
  availableShells: RemoteTerminalProtocolShellType[];
  lastSeenAt: string;
  registeredAt: string;
  online: boolean;
}

export interface RemoteTerminalDeviceProbeResult {
  deviceId: string;
  online: boolean;
  lastSeenAt: string;
}

export interface RemoteTerminalDeviceProbeResponse {
  items: RemoteTerminalDeviceProbeResult[];
}

export type RemoteTerminalSessionMode = "shell";

export interface RemoteTerminalSessionCreateRequest {
  deviceId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalProtocolShellType;
  workingDirectory?: string;
}

export interface RemoteTerminalSessionCreateResponse {
  sessionId: string;
  deviceId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalProtocolShellType;
  browserToken: string;
  websocketUrl: string;
  createdAt: string;
}

export interface RemoteTerminalSessionSummary {
  sessionId: string;
  deviceId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalProtocolShellType;
  status: "pending" | "connected" | "closed";
  createdAt: string;
}

export interface RemoteTerminalDirectoryEntry {
  name: string;
  path: string;
}

export type RemoteTerminalShortcutModifier = "ctrl" | "alt" | "shift" | "meta";
export type RemoteTerminalShortcutKind = "sequence" | "key";

export interface RemoteTerminalShortcutData {
  id: string;
  label: string;
  kind: RemoteTerminalShortcutKind;
  sequence: string[];
  key?: string;
  modifiers?: RemoteTerminalShortcutModifier[];
  preset?: boolean;
}

export interface RemoteTerminalQuickCommandData {
  id: string;
  label: string;
  command: string;
}

export interface RemoteTerminalAgentPreferencesData {
  defaultWorkingDirectory?: string;
  shortcuts: RemoteTerminalShortcutData[];
  quickCommands: RemoteTerminalQuickCommandData[];
}

export interface RemoteTerminalDirectoryBrowseRequestMessage {
  type: "directory-browse";
  requestId: string;
  path?: string;
}

export interface RemoteTerminalDirectoryBrowseResultMessage {
  type: "directory-browse-result";
  requestId: string;
  ok: boolean;
  message?: string;
  currentPath: string;
  parentPath?: string;
  items: RemoteTerminalDirectoryEntry[];
}

export interface RemoteTerminalPreferencesGetMessage {
  type: "preferences-get";
  requestId: string;
}

export interface RemoteTerminalPreferencesSetMessage {
  type: "preferences-set";
  requestId: string;
  preferences: RemoteTerminalAgentPreferencesData;
}

export interface RemoteTerminalPreferencesResultMessage {
  type: "preferences-result";
  requestId: string;
  ok: boolean;
  message?: string;
  preferences: RemoteTerminalAgentPreferencesData;
}

export interface RemoteTerminalSessionStartMessage {
  type: "session-start";
  sessionId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalProtocolShellType;
  workingDirectory?: string;
}

export interface RemoteTerminalSessionInputMessage {
  type: "session-input";
  sessionId: string;
  data: string;
}

export interface RemoteTerminalSessionResizeMessage {
  type: "session-resize";
  sessionId: string;
  cols: number;
  rows: number;
}

export interface RemoteTerminalSessionStopMessage {
  type: "session-stop";
  sessionId: string;
}

export interface RemoteTerminalSessionReadyMessage {
  type: "session-ready";
  sessionId: string;
}

export interface RemoteTerminalSessionOutputMessage {
  type: "session-output";
  sessionId: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface RemoteTerminalSessionExitMessage {
  type: "session-exit";
  sessionId: string;
  exitCode: number | null;
}

export interface RemoteTerminalSessionErrorMessage {
  type: "session-error";
  sessionId: string;
  message: string;
}

export interface RemoteTerminalBrowserConnectedMessage {
  type: "browser-connected";
  sessionId: string;
}

export type RemoteTerminalServerToAgentMessage =
  | RemoteTerminalSessionStartMessage
  | RemoteTerminalSessionInputMessage
  | RemoteTerminalSessionResizeMessage
  | RemoteTerminalSessionStopMessage
  | RemoteTerminalDirectoryBrowseRequestMessage
  | RemoteTerminalPreferencesGetMessage
  | RemoteTerminalPreferencesSetMessage;

export type RemoteTerminalAgentToServerMessage =
  | RemoteTerminalSessionReadyMessage
  | RemoteTerminalSessionOutputMessage
  | RemoteTerminalSessionExitMessage
  | RemoteTerminalSessionErrorMessage
  | RemoteTerminalDirectoryBrowseResultMessage
  | RemoteTerminalPreferencesResultMessage;

export interface RemoteTerminalBrowserPingMessage {
  type: "browser-ping";
  ts: number;
}

export interface RemoteTerminalServerPongMessage {
  type: "browser-pong";
  ts: number;
}

export type RemoteTerminalServerToBrowserMessage =
  | RemoteTerminalBrowserConnectedMessage
  | RemoteTerminalSessionReadyMessage
  | RemoteTerminalSessionOutputMessage
  | RemoteTerminalSessionExitMessage
  | RemoteTerminalSessionErrorMessage
  | RemoteTerminalServerPongMessage;

export type RemoteTerminalBrowserToServerMessage =
  | RemoteTerminalSessionInputMessage
  | RemoteTerminalSessionResizeMessage
  | RemoteTerminalSessionStopMessage
  | RemoteTerminalBrowserPingMessage;
