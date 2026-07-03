export interface UserOnlineSessionRecord {
  id: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  userId: string;
  authSessionId: string;
  startedAt: Date;
  lastHeartbeatAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  lastIpAddress: string;
  lastLocation: string | null;
  userAgent: string | null;
}

export interface UserOnlineSessionListFilters {
  userId?: string;
  keyword?: string;
  ipAddress?: string;
  location?: string;
  isOnline?: boolean;
  offlineOnly?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface UserOnlineSessionOverviewRow {
  userId: string;
  username: string;
  name: string | null;
  sessionId: string;
  authSessionId: string;
  startedAt: Date;
  lastHeartbeatAt: Date;
  endedAt: Date | null;
  isOnline: boolean;
  lastIpAddress: string;
  lastLocation: string | null;
  userAgent: string | null;
  totalDurationSeconds: number;
}

export interface UserOnlineSessionStore {
  findActiveByUserIdAndAuthSessionId(userId: string, authSessionId: string): Promise<UserOnlineSessionRecord | null>;
  createSession(data: {
    userId: string;
    authSessionId: string;
    startedAt: Date;
    lastHeartbeatAt: Date;
    lastIpAddress: string;
    lastLocation?: string | null;
    userAgent?: string | null;
  }): Promise<UserOnlineSessionRecord>;
  updateHeartbeat(
    sessionId: string,
    data: {
      lastHeartbeatAt: Date;
      lastIpAddress: string;
      lastLocation?: string | null;
      userAgent?: string | null;
    },
  ): Promise<UserOnlineSessionRecord>;
  closeSession(
    sessionId: string,
    data: {
      endedAt: Date;
      durationSeconds: number;
      lastHeartbeatAt: Date;
    },
  ): Promise<UserOnlineSessionRecord>;
  forceCloseSession(sessionId: string, endedAt: Date): Promise<UserOnlineSessionRecord | null>;
  closeExpiredSessions(cutoffTime: Date): Promise<number>;
  closeActiveSessionsForUser(userId: string, cutoffTime: Date): Promise<number>;
  listOverview(params: {
    skip: number;
    take: number;
    filters?: UserOnlineSessionListFilters;
  }): Promise<{ rows: UserOnlineSessionOverviewRow[]; total: number }>;
  findLatestSessionByUserId(userId: string): Promise<UserOnlineSessionRecord | null>;
  countSessionsByUserId(userId: string): Promise<number>;
  countActiveSessionsByUserId(userId: string): Promise<number>;
  sumDurationSecondsByUserId(userId: string): Promise<number>;
  listTimelineByUserId(params: {
    userId: string;
    skip: number;
    take: number;
    onlineOnly?: boolean;
    offlineOnly?: boolean;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ rows: UserOnlineSessionRecord[]; total: number }>;
}
