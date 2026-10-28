import type { IamPrincipal } from "@quyan/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isCanonicalOnlineId, canRevokeOnlineUser } from "@/iam/resources/online-session-resources";
import { ConflictError } from "@/util/errors";
import { activeIamAccountUsers, assertIamAccountPrincipal, iamAccountDenied as denied } from "./iam-account-principal";
import type { OnlineUserTarget } from "./user-online-monitor.store";
import type { UserOnlineRevocationStore, OnlineRevocationTarget } from "./user-online-revocation.store";
export function assertOnlineRecoveryTarget(principal: IamPrincipal, userId: string) {
  if (!canRevokeOnlineUser(principal, userId)) throw denied();
}
export class UserOnlineRevocationRepository implements UserOnlineRevocationStore {
  private static instance: UserOnlineRevocationRepository;
  static getInstance() {
    return (this.instance ??= new UserOnlineRevocationRepository());
  }
  async userTarget(principal: IamPrincipal, id: string) {
    await assertIamAccountPrincipal(principal);
    assertOnlineRecoveryTarget(principal, id);
    return prisma.user.findFirst({
      where: { id, ...activeIamAccountUsers(principal.accountOwnerId) },
      select: { id: true, updateTime: true },
    });
  }
  async sessionTarget(principal: IamPrincipal, id: string) {
    await assertIamAccountPrincipal(principal);
    const target = await prisma.userOnlineSession.findFirst({
      where: { id, status: 1, user: activeIamAccountUsers(principal.accountOwnerId) },
      select: { id: true, userId: true, status: true, updateTime: true, endedAt: true },
    });
    if (target) assertOnlineRecoveryTarget(principal, target.userId);
    return target;
  }
  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Online revocation target changed after authorization", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
  async closeSession(
    principal: IamPrincipal,
    target: OnlineRevocationTarget,
    mark: (authSessionId: string, endedAt: Date) => Promise<void>,
  ) {
    return this.transaction(async (tx) => {
      await assertIamAccountPrincipal(principal, tx);
      assertOnlineRecoveryTarget(principal, target.userId);
      const where = {
        id: target.id,
        userId: target.userId,
        status: 1,
        updateTime: target.updateTime,
        user: activeIamAccountUsers(principal.accountOwnerId),
      };
      const row = await tx.userOnlineSession.findFirst({
        where,
        select: { id: true, authSessionId: true, endedAt: true, startedAt: true, lastHeartbeatAt: true },
      });
      if (!row) throw denied();
      if (row.endedAt) return { closed: false };
      if (!isCanonicalOnlineId(row.authSessionId)) throw denied();
      const endedAt = new Date(Math.max(Date.now(), row.lastHeartbeatAt.getTime()));
      if (
        (
          await tx.userOnlineSession.updateMany({
            where: { ...where, endedAt: null },
            data: {
              endedAt,
              durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - row.startedAt.getTime()) / 1000)),
              updateTime: new Date(Math.max(Date.now(), target.updateTime.getTime() + 1)),
            },
          })
        ).count !== 1
      )
        throw denied();
      // Confirm the external revocation marker before committing the snapshot-guarded DB closure.
      await mark(row.authSessionId, endedAt);
      return { closed: true, authSessionId: row.authSessionId };
    });
  }
  async closeUser(
    principal: IamPrincipal,
    target: OnlineUserTarget,
    mark: (userId: string, endedAt: Date) => Promise<void>,
  ) {
    return this.transaction(async (tx) => {
      await assertIamAccountPrincipal(principal, tx);
      assertOnlineRecoveryTarget(principal, target.id);
      const user = await tx.user.findFirst({
        where: { id: target.id, updateTime: target.updateTime, ...activeIamAccountUsers(principal.accountOwnerId) },
        select: { id: true },
      });
      if (!user) throw denied();
      const endedAt = new Date(),
        where = { userId: user.id, status: 1, endedAt: null, user: activeIamAccountUsers(principal.accountOwnerId) };
      let count = 0;
      while (true) {
        const rows = await tx.userOnlineSession.findMany({
          where,
          take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
          orderBy: { id: "asc" },
          select: { id: true, startedAt: true, lastHeartbeatAt: true, updateTime: true },
        });
        if (!rows.length) break;
        for (const row of rows) {
          const closeAt = new Date(Math.max(endedAt.getTime(), row.lastHeartbeatAt.getTime()));
          if (
            (
              await tx.userOnlineSession.updateMany({
                where: { ...where, id: row.id, updateTime: row.updateTime },
                data: {
                  endedAt: closeAt,
                  durationSeconds: Math.max(0, Math.floor((closeAt.getTime() - row.startedAt.getTime()) / 1000)),
                  updateTime: new Date(Math.max(Date.now(), row.updateTime.getTime() + 1)),
                },
              })
            ).count !== 1
          )
            throw denied();
          count++;
        }
      }
      // A durable user revision also invalidates pre-existing JWTs after the Redis marker expires or is cleared on login.
      if (
        (
          await tx.user.updateMany({
            where: { id: user.id, updateTime: target.updateTime, ...activeIamAccountUsers(principal.accountOwnerId) },
            data: { updateTime: new Date(Math.max(Date.now(), target.updateTime.getTime() + 1)) },
          })
        ).count !== 1
      )
        throw denied();
      await mark(user.id, endedAt);
      return count;
    });
  }
}
