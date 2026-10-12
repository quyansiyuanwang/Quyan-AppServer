import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { ForbiddenError } from "@/util/errors";
export const iamAccountDenied = () =>
  new ForbiddenError("IAM account identity or resource unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
export function activeIamAccountUsers(accountOwnerId: string) {
  return { status: MANAGED_STATUS.ENABLED, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] };
}
/** Recheck persisted account membership and session state within the repository's read or commit boundary. */
export async function assertIamAccountPrincipal(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
  if (principal.subjectUserId !== principal.principalUserId) throw iamAccountDenied();
  const [actor, owner] = await Promise.all([
    tx.user.findFirst({
      where: { ...activeIamAccountUsers(principal.accountOwnerId), id: principal.subjectUserId },
      select: { id: true },
    }),
    tx.user.findFirst({
      where: { ...activeIamAccountUsers(principal.accountOwnerId), id: principal.accountOwnerId },
      select: { id: true },
    }),
  ]);
  if (!actor || !owner) throw iamAccountDenied();
  if (principal.subjectType === "assumed_role" || principal.assumedRoleId || principal.roleSessionId) {
    if (principal.subjectType !== "assumed_role" || !principal.assumedRoleId || !principal.roleSessionId)
      throw iamAccountDenied();
    const session = await tx.ramRoleSession.findFirst({
      where: {
        id: principal.roleSessionId,
        subjectUserId: actor.id,
        accountOwnerId: principal.accountOwnerId,
        roleId: principal.assumedRoleId,
        status: MANAGED_STATUS.ENABLED,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        role: { accountOwnerId: principal.accountOwnerId, status: MANAGED_STATUS.ENABLED },
      },
      select: { id: true },
    });
    if (!session) throw iamAccountDenied();
  }
}

export class IamAccountUserRepository {
  private static instance: IamAccountUserRepository;
  static getInstance() {
    return (this.instance ??= new IamAccountUserRepository());
  }
  async targets(principal: IamPrincipal, userIds: readonly string[]) {
    await assertIamAccountPrincipal(principal);
    if (
      !userIds.length ||
      userIds.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      Array.from(userIds).some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    )
      throw iamAccountDenied();
    return prisma.user.findMany({
      where: { ...activeIamAccountUsers(principal.accountOwnerId), id: { in: [...new Set(userIds)] } },
      select: { id: true, updateTime: true },
    });
  }
  async target(principal: IamPrincipal, userId: string) {
    await assertIamAccountPrincipal(principal);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw iamAccountDenied();
    return prisma.user.findFirst({
      where: { id: userId, ...activeIamAccountUsers(principal.accountOwnerId) },
      select: { id: true, updateTime: true },
    });
  }
}
