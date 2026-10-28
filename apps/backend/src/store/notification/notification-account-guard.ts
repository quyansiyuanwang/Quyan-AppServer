import { Prisma } from "@prisma/client";
import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { ConflictError, ForbiddenError } from "@/util/errors";

export const notificationAuthorizationDenied = () =>
  new ForbiddenError("Notification identity or target unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const conflict = () =>
  new ConflictError("Notification resource changed concurrently", undefined, {
    messageKey: "errors.conflict",
  });
async function assertNotificationActor(client: Prisma.TransactionClient, principal: IamPrincipal) {
  if (principal.subjectUserId !== principal.principalUserId) throw notificationAuthorizationDenied();
  const actor = await client.user.findUnique({
    where: { id: principal.subjectUserId },
    select: { id: true, status: true, accountOwnerId: true, email: true },
  });
  const owner = await client.user.findUnique({
    where: { id: principal.accountOwnerId },
    select: { id: true, status: true, accountOwnerId: true },
  });
  if (
    !actor ||
    actor.id !== principal.subjectUserId ||
    actor.status !== MANAGED_STATUS.ENABLED ||
    (actor.accountOwnerId || actor.id) !== principal.accountOwnerId ||
    !owner ||
    owner.id !== principal.accountOwnerId ||
    owner.status !== MANAGED_STATUS.ENABLED ||
    (owner.accountOwnerId || owner.id) !== principal.accountOwnerId
  )
    throw notificationAuthorizationDenied();
  if (principal.subjectType === "assumed_role" || principal.roleSessionId || principal.assumedRoleId) {
    if (principal.subjectType !== "assumed_role" || !principal.roleSessionId || !principal.assumedRoleId)
      throw notificationAuthorizationDenied();
    const session = await client.ramRoleSession.findUnique({
      where: { id: principal.roleSessionId },
      include: { role: { select: { id: true, status: true, accountOwnerId: true } } },
    });
    if (
      !session ||
      session.id !== principal.roleSessionId ||
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
      throw notificationAuthorizationDenied();
  }
  return actor;
}

export async function notificationAccountTransaction<T>(
  principal: IamPrincipal,
  operation: (client: Prisma.TransactionClient, email: string | null) => Promise<T>,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const actor = await assertNotificationActor(tx, principal);
        return operation(tx, actor.email);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    // Do not retry against a new identity or silently overwrite concurrent initialization.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002"))
      throw conflict();
    throw error;
  }
}
