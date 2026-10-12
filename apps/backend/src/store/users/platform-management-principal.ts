import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import type { Permission, IamPrincipal } from "@quyan/shared";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { assertIamAccountPrincipal, iamAccountDenied } from "./iam-account-principal";

/** Deployment-managed groups impose a ceiling; account policies cannot grant platform membership. */
export async function platformManagementGroupSnapshot(
  principal: IamPrincipal,
  permission: Permission,
  tx: Prisma.TransactionClient = prisma,
) {
  await assertIamAccountPrincipal(principal, tx);
  const actor = await tx.user.findUnique({
    where: { id: principal.subjectUserId },
    select: {
      groupId: true,
      group: { select: { id: true, accountOwnerId: true, status: true, permissions: true, updateTime: true } },
    },
  });
  if (
    !actor?.group ||
    actor.groupId !== actor.group.id ||
    actor.group.status !== 1 ||
    actor.group.accountOwnerId !== null ||
    !parseLegacyPermissions(actor.group.permissions).includes(permission)
  )
    throw iamAccountDenied();
  return { id: actor.group.id, updateTime: actor.group.updateTime };
}
