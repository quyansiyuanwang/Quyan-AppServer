import { Prisma, type AccessKey } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { ConflictError, ForbiddenError, NotFoundError } from "@/util/errors";
export type AccessKeyTarget = Pick<AccessKey, "id" | "userId" | "status" | "updateTime">;
const targetSelect = { id: true, userId: true, status: true, updateTime: true } as const;
export const accessKeyAuthorizationDenied = () =>
  new ForbiddenError("Access key identity or target unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const conflict = () =>
  new ConflictError("Access key target changed after authorization", undefined, { messageKey: "errors.conflict" });
/** No credential columns are loaded by the IAM management path. */
export class AccessKeyManagementRepository {
  private static instance: AccessKeyManagementRepository;
  static getInstance() {
    return (this.instance ??= new AccessKeyManagementRepository());
  }
  private async actor(tx: Prisma.TransactionClient, principal: IamPrincipal) {
    if (principal.subjectUserId !== principal.principalUserId) throw accessKeyAuthorizationDenied();
    const actor = await tx.user.findUnique({
      where: { id: principal.subjectUserId },
      select: { id: true, accountOwnerId: true, status: true },
    });
    const owner = await tx.user.findUnique({
      where: { id: principal.accountOwnerId },
      select: { id: true, accountOwnerId: true, status: true },
    });
    if (
      !actor ||
      actor.status !== MANAGED_STATUS.ENABLED ||
      (actor.accountOwnerId || actor.id) !== principal.accountOwnerId ||
      !owner ||
      owner.status !== MANAGED_STATUS.ENABLED ||
      (owner.accountOwnerId || owner.id) !== principal.accountOwnerId
    )
      throw accessKeyAuthorizationDenied();
    if (principal.subjectType === "assumed_role" || principal.assumedRoleId || principal.roleSessionId) {
      if (principal.subjectType !== "assumed_role" || !principal.roleSessionId || !principal.assumedRoleId)
        throw accessKeyAuthorizationDenied();
      const session = await tx.ramRoleSession.findUnique({
        where: { id: principal.roleSessionId },
        include: { role: { select: { id: true, status: true, accountOwnerId: true } } },
      });
      if (
        !session ||
        session.status !== MANAGED_STATUS.ENABLED ||
        session.subjectUserId !== actor.id ||
        session.accountOwnerId !== principal.accountOwnerId ||
        session.roleId !== principal.assumedRoleId ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.role.id !== principal.assumedRoleId ||
        session.role.status !== MANAGED_STATUS.ENABLED ||
        session.role.accountOwnerId !== principal.accountOwnerId
      )
        throw accessKeyAuthorizationDenied();
    }
  }
  private async transaction<T>(principal: IamPrincipal, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.actor(tx, principal);
          return work(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw conflict();
      throw error;
    }
  }
  async target(principal: IamPrincipal, id: string): Promise<AccessKeyTarget> {
    return this.transaction(principal, async (tx) => {
      const target = await tx.accessKey.findFirst({
        where: { id, userId: principal.subjectUserId, status: MANAGED_STATUS.ENABLED },
        select: targetSelect,
      });
      if (!target) throw new NotFoundError("Access key not found", undefined, { messageKey: "accessKey.notFound" });
      return target;
    });
  }
  async revoke(principal: IamPrincipal, expected: AccessKeyTarget) {
    return this.transaction(principal, async (tx) => {
      if (expected.userId !== principal.subjectUserId || expected.status !== MANAGED_STATUS.ENABLED)
        throw accessKeyAuthorizationDenied();
      const result = await tx.accessKey.updateMany({
        where: {
          id: expected.id,
          userId: principal.subjectUserId,
          status: MANAGED_STATUS.ENABLED,
          updateTime: expected.updateTime,
        },
        data: { status: MANAGED_STATUS.DELETED },
      });
      if (result.count !== 1) throw conflict();
      return expected;
    });
  }
}
