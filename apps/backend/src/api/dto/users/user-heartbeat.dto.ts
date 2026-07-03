export interface HeartbeatRuntimeConfigDto {
  intervalSeconds: number;
  timeoutSeconds: number;
}

export type SendHeartbeatDto = Record<string, never>;

export interface SendHeartbeatResponse {
  sessionId: string;
  authSessionId: string;
  isNewSession: boolean;
  serverTime: string;
  lastHeartbeatAt: string;
}

export type StopHeartbeatDto = Record<string, never>;

export interface StopHeartbeatResponse {
  closed: boolean;
  sessionId?: string;
  authSessionId: string;
  endedAt?: string;
}
