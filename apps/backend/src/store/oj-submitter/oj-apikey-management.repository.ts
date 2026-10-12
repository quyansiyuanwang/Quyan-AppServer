import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { ConflictError, ForbiddenError } from "@/util/errors";
import type { OjApiKeyTarget, OjApiKeyManagementStore } from "./oj-apikey-management.store";
export const ojApiKeyDenied = () =>
  new ForbiddenError("OJ API Key identity or target unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
/** OJAPIKey has no User relation: check the trusted user/account separately and in the final transaction. */
export class OjApiKeyManagementRepository implements OjApiKeyManagementStore {
  private static instance: OjApiKeyManagementRepository;
  static getInstance() {
    return (this.instance ??= new OjApiKeyManagementRepository());
  }
  private async actor(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    if (principal.subjectUserId !== principal.principalUserId) throw ojApiKeyDenied();
    const where = {
      status: MANAGED_STATUS.ENABLED,
      OR: [{ accountOwnerId: principal.accountOwnerId }, { id: principal.accountOwnerId, accountOwnerId: null }],
    };
    const [actor, owner] = await Promise.all([
      tx.user.findFirst({ where: { ...where, id: principal.subjectUserId }, select: { id: true } }),
      tx.user.findFirst({ where: { ...where, id: principal.accountOwnerId }, select: { id: true } }),
    ]);
    if (!actor || !owner) throw ojApiKeyDenied();
    if (principal.subjectType === "assumed_role" || principal.roleSessionId || principal.assumedRoleId) {
      if (principal.subjectType !== "assumed_role" || !principal.assumedRoleId || !principal.roleSessionId)
        throw ojApiKeyDenied();
      const session = await tx.ramRoleSession.findFirst({
        where: {
          id: principal.roleSessionId,
          subjectUserId: actor.id,
          accountOwnerId: principal.accountOwnerId,
          roleId: principal.assumedRoleId,
          status: MANAGED_STATUS.ENABLED,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          role: {
            id: principal.assumedRoleId,
            accountOwnerId: principal.accountOwnerId,
            status: MANAGED_STATUS.ENABLED,
          },
        },
        select: { id: true },
      });
      if (!session) throw ojApiKeyDenied();
    }
  }
  async target(principal: IamPrincipal, id: string) {
    await this.actor(principal);
    return prisma.oJAPIKey.findFirst({
      where: { id, userId: principal.subjectUserId, status: MANAGED_STATUS.ENABLED },
      select: { id: true, userId: true, status: true, updateTime: true },
    });
  }
  async revoke(principal: IamPrincipal, target: OjApiKeyTarget) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.actor(principal, tx);
          if (target.userId !== principal.subjectUserId || target.status !== MANAGED_STATUS.ENABLED)
            throw ojApiKeyDenied();
          const where = {
            id: target.id,
            userId: target.userId,
            status: MANAGED_STATUS.ENABLED,
            updateTime: target.updateTime,
          };
          const record = await tx.oJAPIKey.findFirst({ where, select: { id: true, userId: true, name: true } });
          if (!record) throw ojApiKeyDenied();
          if ((await tx.oJAPIKey.updateMany({ where, data: { status: MANAGED_STATUS.DELETED } })).count !== 1)
            throw ojApiKeyDenied();
          return record;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("OJ API Key changed after authorization", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
