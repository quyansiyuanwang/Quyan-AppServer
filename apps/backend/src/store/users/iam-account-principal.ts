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
