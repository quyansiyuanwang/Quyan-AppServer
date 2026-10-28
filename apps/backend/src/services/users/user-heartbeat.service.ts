import { UserOnlineRevocationIamService } from "./user-online-revocation-iam.service";
import { env } from "@/config/env";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@quyan/shared";
import { UserOnlineMonitorIamService } from "./user-online-monitor-iam.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import { ConfigService } from "@/services/system/config.service";
import { IpGeolocationService } from "@/services/infrastructure/ip-geolocation.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { extractClientIp } from "@/util/ip-extractor";
import { UnauthorizedError } from "@/util/errors";
import {
  buildForceOfflineUserKey,
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
  ForceOfflineSessionResponse,
  ForceOfflineUserResponse,
} from "@/api/dto/users/user-online-monitor.dto";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";

export class UserHeartbeatService {
  private static instance: UserHeartbeatService;

  private constructor(
    private readonly sessionRepository: UserOnlineSessionStore = UserOnlineSessionRepository.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly ipGeolocationService: IpGeolocationService = IpGeolocationService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly redisService: RedisService = RedisService.getInstance(),
    private readonly monitorIam = UserOnlineMonitorIamService.getInstance(),
    private readonly permissions = PermissionService.getInstance(),
    private readonly revocationIam = UserOnlineRevocationIamService.getInstance(),
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
    if (!authSessionId)
      throw new UnauthorizedError("登录会话不存在，请重新登录", undefined, { messageKey: "auth.loginSessionNotFound" });

    const forcedOfflineUser = await this.redisService.get(buildForceOfflineUserKey(userId));
    if (forcedOfflineUser)
      throw new UnauthorizedError("用户已被强制下线，请重新登录", undefined, { messageKey: "auth.forcedOffline" });

    const forcedOfflineSession = await this.redisService.get(buildForceOfflineAuthSessionKey(authSessionId));
    if (forcedOfflineSession)
      throw new UnauthorizedError("当前会话已被强制结束，请重新登录", undefined, {
        messageKey: "auth.sessionForcedEnded",
      });

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

  private async legacyMonitorRead(request?: TypedRequest) {
    if (!request) return;
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== principal.principalUserId) throw iamAccountDenied();
    const result = await this.permissions.checkUserPermissions(
      principal.subjectUserId,
      [Permission.USER_ONLINE_MONITOR_READ],
      { assumedRoleSessionId: principal.roleSessionId },
    );
    if (!result.hasPermission) throw iamAccountDenied();
  }
  private async shadowMonitorRead(operation: () => Promise<unknown>, request?: TypedRequest) {
    if (env.security.iamAuthorizationMode !== "shadow" || !request) return;
    try {
      await operation();
    } catch {
      getLogger("OnlineMonitorIamBridge", LogCategory.SECURITY).warn("Online monitor IAM shadow denied", {
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
  }
  async getOverview(
    params: {
      page: number;
      pageSize: number;
      keyword?: string;
      ipAddress?: string;
      location?: string;
      status?: "online" | "offline";
    },
    request?: TypedRequest,
  ): Promise<UserOnlineMonitorOverviewResponse> {
    const runtimeConfig = await this.getRuntimeConfig();
    if (env.security.iamAuthorizationMode === "enforce")
      return this.monitorIam.overview(params, runtimeConfig.timeoutSeconds, request);
    await this.legacyMonitorRead(request);
    await this.shadowMonitorRead(
      () => this.monitorIam.overview(params, runtimeConfig.timeoutSeconds, request),
      request,
    );
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

  async getUserDetail(userId: string, request?: TypedRequest): Promise<UserOnlineMonitorDetailDto> {
    const runtimeConfig = await this.getRuntimeConfig();
    if (env.security.iamAuthorizationMode === "enforce")
      return this.monitorIam.detail(userId, runtimeConfig.timeoutSeconds, request);
    await this.legacyMonitorRead(request);
    await this.shadowMonitorRead(() => this.monitorIam.detail(userId, runtimeConfig.timeoutSeconds, request), request);
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

  async getUserTimeline(
    params: {
      userId: string;
      page: number;
      pageSize: number;
      onlineOnly?: boolean;
      offlineOnly?: boolean;
      startDate?: string;
      endDate?: string;
    },
    request?: TypedRequest,
  ): Promise<UserOnlineMonitorTimelineGroupedResponse> {
    const runtimeConfig = await this.getRuntimeConfig();
    if (env.security.iamAuthorizationMode === "enforce")
      return this.monitorIam.timeline(params, runtimeConfig.timeoutSeconds, request);
    await this.legacyMonitorRead(request);
    await this.shadowMonitorRead(
      () => this.monitorIam.timeline(params, runtimeConfig.timeoutSeconds, request),
      request,
    );
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

  private async legacyMonitorRevocation(request?: TypedRequest) {
    if (!request) return;
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== principal.principalUserId) throw iamAccountDenied();
    const result = await this.permissions.checkUserPermissions(
      principal.subjectUserId,
      [Permission.USER_ONLINE_MONITOR_FORCE_OFFLINE],
      { assumedRoleSessionId: principal.roleSessionId },
    );
    if (!result.hasPermission) throw iamAccountDenied();
  }
  async forceOfflineSession(sessionId: string): Promise<ForceOfflineSessionResponse> {
    return this.forceOfflineSessionWithCurrentSession(sessionId);
  }

  async forceOfflineSessionWithCurrentSession(
    sessionId: string,
    currentAuthSessionId?: string,
    request?: TypedRequest,
  ): Promise<ForceOfflineSessionResponse> {
    if (env.security.iamAuthorizationMode === "enforce") return this.revocationIam.session(sessionId, request);
    await this.legacyMonitorRevocation(request);
    if (env.security.iamAuthorizationMode === "shadow" && request) {
      try {
        await this.revocationIam.authorizeSession(sessionId, request);
      } catch {
        getLogger("OnlineMonitorIamBridge", LogCategory.SECURITY).warn("Online session revocation shadow denied", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
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

  async forceOfflineUser(userId: string, request?: TypedRequest): Promise<ForceOfflineUserResponse> {
    if (env.security.iamAuthorizationMode === "enforce") return this.revocationIam.user(userId, request);
    await this.legacyMonitorRevocation(request);
    if (env.security.iamAuthorizationMode === "shadow" && request) {
      try {
        await this.revocationIam.authorizeUser(userId, request);
      } catch {
        getLogger("OnlineMonitorIamBridge", LogCategory.SECURITY).warn("Online user revocation shadow denied", {
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    }
    const closedCount = await this.sessionRepository.closeActiveSessionsForUser(userId, new Date());
    await this.redisService.set(
      buildForceOfflineUserKey(userId),
      new Date().toISOString(),
      getForceOfflineAuthSessionTtlSeconds(),
    );
    return {
      closedCount,
      userId,
    };
  }
}
