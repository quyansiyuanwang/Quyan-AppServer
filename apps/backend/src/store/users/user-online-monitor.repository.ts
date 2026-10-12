import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { activeIamAccountUsers, assertIamAccountPrincipal } from "./iam-account-principal";
import type { UserOnlineMonitorStore, OnlineSessionTarget, OnlineUserTarget } from "./user-online-monitor.store";
export class UserOnlineMonitorRepository implements UserOnlineMonitorStore {
  private static instance: UserOnlineMonitorRepository;
  static getInstance() {
    return (this.instance ??= new UserOnlineMonitorRepository());
  }
  async userTarget(principal: IamPrincipal, id: string) {
    await assertIamAccountPrincipal(principal);
    return prisma.user.findFirst({
      where: { ...activeIamAccountUsers(principal.accountOwnerId), id },
      select: { id: true, updateTime: true },
    });
  }
  async scan(principal: IamPrincipal, userId?: string, after?: OnlineSessionTarget) {
    await assertIamAccountPrincipal(principal);
    return prisma.userOnlineSession.findMany({
      where: {
        status: 1,
        user: activeIamAccountUsers(principal.accountOwnerId),
        ...(userId ? { userId } : {}),
        ...(after
          ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
          : {}),
      },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      select: { id: true, userId: true, status: true, createTime: true, updateTime: true },
    });
  }
  async hydrate(principal: IamPrincipal, targets: OnlineSessionTarget[]) {
    await assertIamAccountPrincipal(principal);
    if (!targets.length) return [];
    return prisma.userOnlineSession.findMany({
      where: {
        status: 1,
        user: activeIamAccountUsers(principal.accountOwnerId),
        OR: targets.map((t) => ({ id: t.id, userId: t.userId, updateTime: t.updateTime })),
      },
      select: {
        id: true,
        userId: true,
        authSessionId: true,
        startedAt: true,
        lastHeartbeatAt: true,
        endedAt: true,
        durationSeconds: true,
        lastIpAddress: true,
        lastLocation: true,
        userAgent: true,
        user: { select: { username: true, name: true } },
      },
    });
  }
  async detail(principal: IamPrincipal, target: OnlineUserTarget, cutoff: Date) {
    await assertIamAccountPrincipal(principal);
    const user = await prisma.user.findFirst({
      where: { ...activeIamAccountUsers(principal.accountOwnerId), id: target.id, updateTime: target.updateTime },
      select: { id: true, username: true, name: true },
    });
    if (!user) return null;
    const where = { userId: user.id, status: 1, user: activeIamAccountUsers(principal.accountOwnerId) };
    const [total, current, totalDuration, latest] = await Promise.all([
      prisma.userOnlineSession.count({ where }),
      prisma.userOnlineSession.count({ where: { ...where, endedAt: null, lastHeartbeatAt: { gt: cutoff } } }),
      prisma.userOnlineSession.aggregate({ where, _sum: { durationSeconds: true } }),
      prisma.userOnlineSession.findFirst({
        where,
        orderBy: [{ lastHeartbeatAt: "desc" }, { startedAt: "desc" }, { id: "desc" }],
        select: {
          startedAt: true,
          lastHeartbeatAt: true,
          endedAt: true,
          lastIpAddress: true,
          lastLocation: true,
          userAgent: true,
        },
      }),
    ]);
    const seconds = totalDuration._sum.durationSeconds ?? 0;
    const ended = latest?.endedAt ?? (latest && latest.lastHeartbeatAt <= cutoff ? latest.lastHeartbeatAt : undefined);
    return {
      userId: user.id,
      username: user.username,
      name: user.name,
      isOnline: current > 0,
      currentSessionCount: current,
      totalSessions: total,
      totalDurationSeconds: seconds,
      averageDurationSeconds: total ? Math.floor(seconds / total) : 0,
      latestStartedAt: latest?.startedAt.toISOString(),
      latestHeartbeatAt: latest?.lastHeartbeatAt.toISOString(),
      latestEndedAt: ended?.toISOString(),
      latestIpAddress: latest?.lastIpAddress,
      latestLocation: latest?.lastLocation,
      latestUserAgent: latest?.userAgent,
    };
  }
}
