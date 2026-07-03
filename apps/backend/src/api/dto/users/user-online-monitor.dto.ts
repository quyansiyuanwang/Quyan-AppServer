export interface UserOnlineMonitorOverviewItemDto {
  userId: string;
  username: string;
  name?: string | null;
  sessionId: string;
  authSessionId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  endedAt?: string;
  durationSeconds: number;
  isOnline: boolean;
  ipAddress: string;
  location?: string | null;
  userAgent?: string | null;
}

export interface UserOnlineMonitorStatsDto {
  onlineUsers: number;
  offlineUsers: number;
  activeSessions: number;
  averageDurationSeconds: number;
}

export interface UserOnlineMonitorOverviewResponse {
  items: UserOnlineMonitorOverviewItemDto[];
  total: number;
  page: number;
  pageSize: number;
  stats: UserOnlineMonitorStatsDto;
}

export type UserOnlineMonitorStatusFilter = "online" | "offline";

export interface UserOnlineMonitorDetailDto {
  userId: string;
  username: string;
  name?: string | null;
  isOnline: boolean;
  currentSessionCount: number;
  totalSessions: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  latestStartedAt?: string;
  latestHeartbeatAt?: string;
  latestEndedAt?: string;
  latestIpAddress?: string;
  latestLocation?: string | null;
  latestUserAgent?: string | null;
}

export interface UserOnlineMonitorTimelineItemDto {
  sessionId: string;
  authSessionId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  endedAt?: string;
  durationSeconds: number;
  ipAddress: string;
  location?: string | null;
  userAgent?: string | null;
  isOnline: boolean;
}

export interface UserOnlineMonitorTimelineResponse {
  items: UserOnlineMonitorTimelineItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserOnlineMonitorTimelineGroupDto {
  online: UserOnlineMonitorTimelineItemDto[];
  offline: UserOnlineMonitorTimelineItemDto[];
}

export interface UserOnlineMonitorTimelineGroupedResponse extends UserOnlineMonitorTimelineResponse {
  groups: UserOnlineMonitorTimelineGroupDto;
}

export interface ForceOfflineSessionResponse {
  closed: boolean;
  sessionId: string;
  currentSessionAffected?: boolean;
}

export interface ForceOfflineUserResponse {
  closedCount: number;
  userId: string;
}
