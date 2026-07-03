import { prisma } from "@/config/database";
import { RECORD_STATUS } from "@/constant/status";
import type {
  UserOnlineSessionListFilters,
  UserOnlineSessionOverviewRow,
  UserOnlineSessionRecord,
  UserOnlineSessionStore,
} from "./user-online-session.store";
import type { Prisma as _Prisma } from "@prisma/client";

export class UserOnlineSessionRepository implements UserOnlineSessionStore {
  private static instance: UserOnlineSessionRepository;

  public static getInstance(): UserOnlineSessionRepository {
    if (!UserOnlineSessionRepository.instance) UserOnlineSessionRepository.instance = new UserOnlineSessionRepository();

    return UserOnlineSessionRepository.instance;
  }

  async findActiveByUserIdAndAuthSessionId(
    userId: string,
    authSessionId: string,
  ): Promise<UserOnlineSessionRecord | null> {
    return prisma.userOnlineSession.findFirst({
      where: {
        status: RECORD_STATUS.ACTIVE,
        userId,
        authSessionId,
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });
  }

  async createSession(data: {
    userId: string;
    authSessionId: string;
    startedAt: Date;
    lastHeartbeatAt: Date;
    lastIpAddress: string;
    lastLocation?: string | null;
    userAgent?: string | null;
  }): Promise<UserOnlineSessionRecord> {
    return prisma.userOnlineSession.create({
      data: {
        userId: data.userId,
        authSessionId: data.authSessionId,
        startedAt: data.startedAt,
        lastHeartbeatAt: data.lastHeartbeatAt,
        lastIpAddress: data.lastIpAddress,
        lastLocation: data.lastLocation ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async updateHeartbeat(
    sessionId: string,
    data: {
      lastHeartbeatAt: Date;
      lastIpAddress: string;
      lastLocation?: string | null;
      userAgent?: string | null;
    },
  ): Promise<UserOnlineSessionRecord> {
    return prisma.userOnlineSession.update({
      where: { id: sessionId },
      data: {
        lastHeartbeatAt: data.lastHeartbeatAt,
        lastIpAddress: data.lastIpAddress,
        lastLocation: data.lastLocation ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async closeSession(
    sessionId: string,
    data: {
      endedAt: Date;
      durationSeconds: number;
      lastHeartbeatAt: Date;
    },
  ): Promise<UserOnlineSessionRecord> {
    return prisma.userOnlineSession.update({
      where: { id: sessionId },
      data: {
        endedAt: data.endedAt,
        durationSeconds: data.durationSeconds,
        lastHeartbeatAt: data.lastHeartbeatAt,
      },
    });
  }

  async forceCloseSession(sessionId: string, endedAt: Date): Promise<UserOnlineSessionRecord | null> {
    const existing = await prisma.userOnlineSession.findUnique({ where: { id: sessionId } });
    if (!existing || existing.endedAt) return null;

    return prisma.userOnlineSession.update({
      where: { id: sessionId },
      data: {
        endedAt,
        durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - existing.startedAt.getTime()) / 1000)),
      },
    });
  }

  async closeExpiredSessions(cutoffTime: Date): Promise<number> {
    const now = new Date();
    const activeSessions = await prisma.userOnlineSession.findMany({
      where: {
        status: RECORD_STATUS.ACTIVE,
        endedAt: null,
        lastHeartbeatAt: { lt: cutoffTime },
      },
      select: {
        id: true,
        startedAt: true,
        lastHeartbeatAt: true,
      },
    });

    if (activeSessions.length === 0) return 0;

    await Promise.all(
      activeSessions.map((session: { id: string; startedAt: Date; lastHeartbeatAt: Date }) =>
        prisma.userOnlineSession.update({
          where: { id: session.id },
          data: {
            endedAt: now,
            durationSeconds: Math.max(0, Math.floor((now.getTime() - session.startedAt.getTime()) / 1000)),
          },
        }),
      ),
    );

    return activeSessions.length;
  }

  async closeActiveSessionsForUser(userId: string, cutoffTime: Date): Promise<number> {
    const activeSessions = await prisma.userOnlineSession.findMany({
      where: {
        status: RECORD_STATUS.ACTIVE,
        userId,
        endedAt: null,
      },
      select: {
        id: true,
        startedAt: true,
        lastHeartbeatAt: true,
      },
    });

    if (activeSessions.length === 0) return 0;

    await Promise.all(
      activeSessions.map((session: { id: string; startedAt: Date; lastHeartbeatAt: Date }) => {
        const endedAt = new Date(Math.max(cutoffTime.getTime(), session.lastHeartbeatAt.getTime()));
        return prisma.userOnlineSession.update({
          where: { id: session.id },
          data: {
            endedAt,
            durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000)),
          },
        });
      }),
    );

    return activeSessions.length;
  }

  private buildWhere(filters?: UserOnlineSessionListFilters): Record<string, unknown> {
    const keyword = filters?.keyword?.trim();
    const isOnline = filters?.isOnline === true;
    const isOffline = filters?.isOnline === false;

    return {
      status: RECORD_STATUS.ACTIVE,
      ...(isOnline ? { endedAt: null } : {}),
      ...(isOffline ? { endedAt: { not: null } } : {}),
      ...(filters?.userId ? { userId: filters.userId } : {}),
      ...(filters?.ipAddress
        ? {
            lastIpAddress: {
              contains: filters.ipAddress,
            },
          }
        : {}),
      ...(filters?.location
        ? {
            lastLocation: {
              contains: filters.location,
            },
          }
        : {}),
      ...(filters?.startDate || filters?.endDate
        ? {
            ...(isOffline
              ? {
                  endedAt: {
                    not: null,
                    ...(filters?.startDate ? { gte: filters.startDate } : {}),
                    ...(filters?.endDate ? { lte: filters.endDate } : {}),
                  },
                }
              : {
                  lastHeartbeatAt: {
                    ...(filters?.startDate ? { gte: filters.startDate } : {}),
                    ...(filters?.endDate ? { lte: filters.endDate } : {}),
                  },
                }),
          }
        : {}),
      ...(keyword
        ? {
            user: {
              OR: [{ username: { contains: keyword } }, { name: { contains: keyword } }, { id: { contains: keyword } }],
            },
          }
        : {}),
    };
  }

  async listOverview(params: {
    skip: number;
    take: number;
    filters?: UserOnlineSessionListFilters;
  }): Promise<{ rows: UserOnlineSessionOverviewRow[]; total: number }> {
    const where = this.buildWhere(params.filters);
    const isOnline = params.filters?.isOnline === true;
    const isOffline = params.filters?.isOnline === false;
    const [rows, total] = await Promise.all([
      prisma.userOnlineSession.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: [
          ...(isOffline
            ? ([{ endedAt: "desc" }] as const)
            : isOnline
              ? ([{ lastHeartbeatAt: "desc" }] as const)
              : ([{ updateTime: "desc" }] as const)),
          { startedAt: "desc" },
        ],
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      }),
      prisma.userOnlineSession.count({ where }),
    ]);

    return {
      rows: rows.map((row: any) => ({
        userId: row.userId,
        username: row.user.username,
        name: row.user.name,
        sessionId: row.id,
        authSessionId: row.authSessionId,
        startedAt: row.startedAt,
        lastHeartbeatAt: row.lastHeartbeatAt,
        endedAt: row.endedAt,
        isOnline: row.endedAt == null,
        lastIpAddress: row.lastIpAddress,
        lastLocation: row.lastLocation,
        userAgent: row.userAgent,
        totalDurationSeconds:
          row.durationSeconds ??
          Math.max(0, Math.floor(((row.endedAt ?? new Date()).getTime() - row.startedAt.getTime()) / 1000)),
      })),
      total,
    };
  }

  async findLatestSessionByUserId(userId: string): Promise<UserOnlineSessionRecord | null> {
    return prisma.userOnlineSession.findFirst({
      where: { userId, status: RECORD_STATUS.ACTIVE },
      orderBy: [{ lastHeartbeatAt: "desc" }, { startedAt: "desc" }],
    });
  }

  async countSessionsByUserId(userId: string): Promise<number> {
    return prisma.userOnlineSession.count({
      where: { userId, status: RECORD_STATUS.ACTIVE },
    });
  }

  async countActiveSessionsByUserId(userId: string): Promise<number> {
    return prisma.userOnlineSession.count({
      where: { userId, status: RECORD_STATUS.ACTIVE, endedAt: null },
    });
  }

  async sumDurationSecondsByUserId(userId: string): Promise<number> {
    const aggregate = await prisma.userOnlineSession.aggregate({
      where: { userId, status: RECORD_STATUS.ACTIVE },
      _sum: { durationSeconds: true },
    });
    return Number(aggregate._sum.durationSeconds || 0);
  }

  async listTimelineByUserId(params: {
    userId: string;
    skip: number;
    take: number;
    onlineOnly?: boolean;
    offlineOnly?: boolean;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ rows: UserOnlineSessionRecord[]; total: number }> {
    const where = {
      userId: params.userId,
      status: RECORD_STATUS.ACTIVE,
      ...(params.onlineOnly ? { endedAt: null } : {}),
      ...(params.offlineOnly ? { endedAt: { not: null } } : {}),
      ...(params.startDate || params.endDate
        ? {
            startedAt: {
              ...(params.startDate ? { gte: params.startDate } : {}),
              ...(params.endDate ? { lte: params.endDate } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.userOnlineSession.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: [{ startedAt: "desc" }, { lastHeartbeatAt: "desc" }],
      }),
      prisma.userOnlineSession.count({ where }),
    ]);

    return { rows, total };
  }
}
