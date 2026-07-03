import type { TypedRequest } from "@/types/express";
import { ConfigService } from "@/services/system/config.service";
import { IpGeolocationService } from "@/services/infrastructure/ip-geolocation.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { extractClientIp } from "@/util/ip-extractor";
import { UnauthorizedError } from "@/util/errors";
import {
  buildForceOfflineAuthSessionKey,
  extractAuthSessionId,
  getForceOfflineAuthSessionTtlSeconds,
  setAuthSessionIdCookie,
} from "@/util/auth-session";
import type { UserOnlineSessionStore } from "@/store/users/user-online-session.store";
import { UserOnlineSessionRepository } from "@/store/users/user-online-session.repository";
import type {
  HeartbeatRuntimeConfigDto,
  SendHeartbeatResponse,
  StopHeartbeatResponse,
} from "@/api/dto/users/user-heartbeat.dto";
import type { UserOnlineMonitorOverviewResponse } from "@/api/dto/users/user-online-monitor.dto";
import type {
  UserOnlineMonitorDetailDto,
  UserOnlineMonitorTimelineGroupedResponse,
  UserOnlineMonitorTimelineResponse as _UserOnlineMonitorTimelineResponse,
  ForceOfflineSessionResponse,
  ForceOfflineUserResponse,
} from "@/api/dto/users/user-online-monitor.dto";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";

export class UserHeartbeatService {
  private static instance: UserHeartbeatService;

  private getForceOfflineUserKey(userId: string) {
    return `user:force_offline:${userId}`;
  }

  private constructor(
    private readonly sessionRepository: UserOnlineSessionStore = UserOnlineSessionRepository.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly ipGeolocationService: IpGeolocationService = IpGeolocationService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
  ) {}

  static getInstance(): UserHeartbeatService {
    if (!UserHeartbeatService.instance) UserHeartbeatService.instance = new UserHeartbeatService();
    return UserHeartbeatService.instance;
  }

  async getRuntimeConfig(): Promise<HeartbeatRuntimeConfigDto> {
    return this.configService.getHeartbeatConfig();
  }

  private getUserAgent(request: TypedRequest): string | null {
    const userAgent = request.headers["user-agent"];
    if (Array.isArray(userAgent)) return userAgent[0] || null;
    return userAgent || null;
  }

  private getRequestId(request: TypedRequest): string | undefined {
    const requestId = request.headers["x-request-id"];
    if (Array.isArray(requestId)) return requestId[0];
    return typeof requestId === "string" ? requestId : undefined;
  }

  private async maybeLogIpChange(params: {
    userId: string;
    username: string | null;
    sessionId: string;
    previousIpAddress: string;
    nextIpAddress: string;
    nextLocation: string;
    request: TypedRequest;
  }) {
    if (params.previousIpAddress === params.nextIpAddress) return;

    await this.businessLogService.logOperation({
      operationType: OperationType.USER_ONLINE_SESSION_IP_CHANGE,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: params.userId,
      targetUserId: params.userId,
      targetResourceType: "USER_ONLINE_SESSION",
      targetResourceId: params.sessionId,
      description: `用户 '${params.username || params.userId}' 在线会话 IP 发生变化`,
      success: true,
      changes: {
        previousIpAddress: params.previousIpAddress,
        nextIpAddress: params.nextIpAddress,
        nextLocation: params.nextLocation,
      },
      ipAddress: params.nextIpAddress,
      userAgent: this.getUserAgent(params.request) || undefined,
      requestId: this.getRequestId(params.request),
    });
  }

  async recordHeartbeat(userId: string, request: TypedRequest): Promise<SendHeartbeatResponse> {
    const authSessionId = extractAuthSessionId(request) || setAuthSessionIdCookie(request);
    if (!authSessionId) throw new UnauthorizedError("登录会话不存在，请重新登录");

    const forcedOfflineUser = await this.redisService.get(this.getForceOfflineUserKey(userId));
    if (forcedOfflineUser) throw new UnauthorizedError("用户已被强制下线，请重新登录");

    const forcedOfflineSession = await this.redisService.get(buildForceOfflineAuthSessionKey(authSessionId));
    if (forcedOfflineSession) throw new UnauthorizedError("当前会话已被强制结束，请重新登录");

    const runtimeConfig = await this.getRuntimeConfig();
    const cutoffTime = new Date(Date.now() - runtimeConfig.timeoutSeconds * 1000);
    await this.sessionRepository.closeExpiredSessions(cutoffTime);

    const now = new Date();
    const ipAddress = extractClientIp(request);
    const location = await this.ipGeolocationService.getLocation(ipAddress);
    const userAgent = this.getUserAgent(request);
    const user = await this.userRepository.findById(userId);
    const username = user?.username ?? null;

    const existingSession = await this.sessionRepository.findActiveByUserIdAndAuthSessionId(userId, authSessionId);

    if (!existingSession) {
      const created = await this.sessionRepository.createSession({
        userId,
        authSessionId,
        startedAt: now,
        lastHeartbeatAt: now,
        lastIpAddress: ipAddress,
        lastLocation: location,
        userAgent,
      });

      return {
        sessionId: created.id,
        authSessionId,
        isNewSession: true,
        serverTime: now.toISOString(),
        lastHeartbeatAt: created.lastHeartbeatAt.toISOString(),
      };
    }

    const updated = await this.sessionRepository.updateHeartbeat(existingSession.id, {
      lastHeartbeatAt: now,
      lastIpAddress: ipAddress,
      lastLocation: location,
      userAgent,
    });

    await this.maybeLogIpChange({
      userId,
      username,
      sessionId: existingSession.id,
      previousIpAddress: existingSession.lastIpAddress,
      nextIpAddress: ipAddress,
      nextLocation: location,
      request,
    });

    return {
      sessionId: updated.id,
      authSessionId,
      isNewSession: false,
      serverTime: now.toISOString(),
      lastHeartbeatAt: updated.lastHeartbeatAt.toISOString(),
    };
  }

  async stopHeartbeat(userId: string, request: TypedRequest): Promise<StopHeartbeatResponse> {
    const authSessionId = extractAuthSessionId(request);
    if (!authSessionId)
      return {
        closed: false,
        authSessionId: "",
      };

    const activeSession = await this.sessionRepository.findActiveByUserIdAndAuthSessionId(userId, authSessionId);

    if (!activeSession)
      return {
        closed: false,
        authSessionId,
      };

    const endedAt = new Date();
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - activeSession.startedAt.getTime()) / 1000));

    const closed = await this.sessionRepository.closeSession(activeSession.id, {
      endedAt,
      durationSeconds,
      lastHeartbeatAt: activeSession.lastHeartbeatAt,
    });

    const user = await this.userRepository.findById(userId);
    await this.businessLogService.logOperation({
      operationType: OperationType.USER_ONLINE_SESSION_END,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: userId,
      targetUserId: userId,
      targetResourceType: "USER_ONLINE_SESSION",
      targetResourceId: closed.id,
      description: `用户 '${user?.username || userId}' 结束在线会话`,
      success: true,
      metadata: {
        authSessionId,
        durationSeconds,
      },
      ipAddress: activeSession.lastIpAddress,
      userAgent: this.getUserAgent(request) || undefined,
      requestId: this.getRequestId(request),
    });

    return {
      closed: true,
      sessionId: closed.id,
      authSessionId,
      endedAt: endedAt.toISOString(),
    };
  }

  async getOverview(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    ipAddress?: string;
    location?: string;
    status?: "online" | "offline";
  }): Promise<UserOnlineMonitorOverviewResponse> {
    const runtimeConfig = await this.getRuntimeConfig();
    const cutoffTime = new Date(Date.now() - runtimeConfig.timeoutSeconds * 1000);
    await this.sessionRepository.closeExpiredSessions(cutoffTime);

    const skip = (params.page - 1) * params.pageSize;
    const result = await this.sessionRepository.listOverview({
      skip,
      take: params.pageSize,
      filters: {
        keyword: params.keyword,
        ipAddress: params.ipAddress,
        location: params.location,
        isOnline: params.status === "online" ? true : params.status === "offline" ? false : undefined,
      },
    });

    const onlineTotal =
      params.status !== "online"
        ? (await this.sessionRepository.listOverview({ skip: 0, take: 1, filters: { isOnline: true } })).total
        : result.total;

    const userCount = await this.userRepository.countAll();
    const totalDurationSeconds = result.rows.reduce((sum, row) => sum + row.totalDurationSeconds, 0);

    const overviewItems = result.rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      name: row.name,
      sessionId: row.sessionId,
      authSessionId: row.authSessionId,
      startedAt: row.startedAt.toISOString(),
      lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
      endedAt: row.endedAt?.toISOString(),
      durationSeconds: row.totalDurationSeconds,
      isOnline: row.isOnline,
      ipAddress: row.lastIpAddress,
      location: row.lastLocation,
      userAgent: row.userAgent,
    }));

    return {
      items: overviewItems,
      total: result.total,
      page: params.page,
      pageSize: params.pageSize,
      stats: {
        onlineUsers: onlineTotal,
        offlineUsers: Math.max(0, userCount - onlineTotal),
        activeSessions: onlineTotal,
        averageDurationSeconds: result.rows.length > 0 ? Math.floor(totalDurationSeconds / result.rows.length) : 0,
      },
    };
  }

  async getUserDetail(userId: string): Promise<UserOnlineMonitorDetailDto> {
    const runtimeConfig = await this.getRuntimeConfig();
    const cutoffTime = new Date(Date.now() - runtimeConfig.timeoutSeconds * 1000);
    await this.sessionRepository.closeExpiredSessions(cutoffTime);

    const [user, latestSession, totalSessions, currentSessionCount, totalDurationSeconds] = await Promise.all([
      this.userRepository.findById(userId),
      this.sessionRepository.findLatestSessionByUserId(userId),
      this.sessionRepository.countSessionsByUserId(userId),
      this.sessionRepository.countActiveSessionsByUserId(userId),
      this.sessionRepository.sumDurationSecondsByUserId(userId),
    ]);

    return {
      userId,
      username: user?.username || userId,
      name: user?.name ?? null,
      isOnline: currentSessionCount > 0,
      currentSessionCount,
      totalSessions,
      totalDurationSeconds,
      averageDurationSeconds: totalSessions > 0 ? Math.floor(totalDurationSeconds / totalSessions) : 0,
      latestStartedAt: latestSession?.startedAt.toISOString(),
      latestHeartbeatAt: latestSession?.lastHeartbeatAt.toISOString(),
      latestEndedAt: latestSession?.endedAt?.toISOString(),
      latestIpAddress: latestSession?.lastIpAddress,
      latestLocation: latestSession?.lastLocation,
      latestUserAgent: latestSession?.userAgent,
    };
  }

  async getUserTimeline(params: {
    userId: string;
    page: number;
    pageSize: number;
    onlineOnly?: boolean;
    offlineOnly?: boolean;
    startDate?: string;
    endDate?: string;
  }): Promise<UserOnlineMonitorTimelineGroupedResponse> {
    const runtimeConfig = await this.getRuntimeConfig();
    const cutoffTime = new Date(Date.now() - runtimeConfig.timeoutSeconds * 1000);
    await this.sessionRepository.closeExpiredSessions(cutoffTime);

    const skip = (params.page - 1) * params.pageSize;
    const result = await this.sessionRepository.listTimelineByUserId({
      userId: params.userId,
      skip,
      take: params.pageSize,
      onlineOnly: params.onlineOnly,
      offlineOnly: params.offlineOnly,
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
    });

    const items = result.rows.map((row) => ({
      sessionId: row.id,
      authSessionId: row.authSessionId,
      startedAt: row.startedAt.toISOString(),
      lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
      endedAt: row.endedAt?.toISOString(),
      durationSeconds:
        row.durationSeconds ??
        Math.max(0, Math.floor(((row.endedAt ?? row.lastHeartbeatAt).getTime() - row.startedAt.getTime()) / 1000)),
      ipAddress: row.lastIpAddress,
      location: row.lastLocation,
      userAgent: row.userAgent,
      isOnline: row.endedAt == null,
    }));

    return {
      items,
      total: result.total,
      page: params.page,
      pageSize: params.pageSize,
      groups: {
        online: items.filter((item) => item.isOnline),
        offline: items.filter((item) => !item.isOnline),
      },
    };
  }

  async forceOfflineSession(sessionId: string): Promise<ForceOfflineSessionResponse> {
    return this.forceOfflineSessionWithCurrentSession(sessionId);
  }

  async forceOfflineSessionWithCurrentSession(
    sessionId: string,
    currentAuthSessionId?: string,
  ): Promise<ForceOfflineSessionResponse> {
    const endedAt = new Date();
    const closed = await this.sessionRepository.forceCloseSession(sessionId, endedAt);
    if (closed)
      await this.redisService.set(
        buildForceOfflineAuthSessionKey(closed.authSessionId),
        endedAt.toISOString(),
        getForceOfflineAuthSessionTtlSeconds(),
      );

    return {
      closed: Boolean(closed),
      sessionId,
      currentSessionAffected: Boolean(closed && currentAuthSessionId && closed.authSessionId === currentAuthSessionId),
    };
  }

  async forceOfflineUser(userId: string): Promise<ForceOfflineUserResponse> {
    const closedCount = await this.sessionRepository.closeActiveSessionsForUser(userId, new Date());
    await this.redisService.set(
      this.getForceOfflineUserKey(userId),
      new Date().toISOString(),
      getForceOfflineAuthSessionTtlSeconds(),
    );
    return {
      closedCount,
      userId,
    };
  }
}
