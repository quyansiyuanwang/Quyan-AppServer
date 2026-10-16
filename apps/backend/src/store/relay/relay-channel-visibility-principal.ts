import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { RELAY_CHANNEL_VISIBILITY_MANAGEMENT_PERMISSIONS } from "@/constant/relay-channel";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
/** Business visibility is a persisted ceiling; an account policy cannot mint a global management bypass. */
export async function relayChannelVisibilityPrincipal(principal: IamPrincipal, tx: Prisma.TransactionClient) {
  await assertIamAccountPrincipal(principal, tx);
  const user = await tx.user.findUnique({
    where: { id: principal.subjectUserId },
    select: {
      id: true,
      status: true,
      updateTime: true,
      groupId: true,
      accountOwnerId: true,
      permissionRemoves: true,
      group: { select: { id: true, accountOwnerId: true, status: true, updateTime: true, permissions: true } },
    },
  });
  if (
    !user ||
    user.status !== 1 ||
    (user.accountOwnerId || user.id) !== principal.accountOwnerId ||
    (user.groupId &&
      (!user.group ||
        user.group.id !== user.groupId ||
        user.group.status !== 1 ||
        (user.group.accountOwnerId && user.group.accountOwnerId !== principal.accountOwnerId)))
  )
    throw iamAccountDenied();
  const removed = parseLegacyPermissions(user.permissionRemoves),
    groupPermissions = user.group?.accountOwnerId === null ? parseLegacyPermissions(user.group.permissions) : [];
  const managementBypass = RELAY_CHANNEL_VISIBILITY_MANAGEMENT_PERMISSIONS.some(
    (permission) => groupPermissions.includes(permission) && !removed.includes(permission),
  );
  const binding = {
    id: true,
    roleId: true,
    status: true,
    updateTime: true,
    role: { select: { id: true, status: true, updateTime: true, accountOwnerId: true } },
  } as const;
  const userRoles = await tx.ramUserRoleBinding.findMany({
    where: {
      accountOwnerId: principal.accountOwnerId,
      userId: user.id,
      status: 1,
      role: { status: 1, accountOwnerId: principal.accountOwnerId },
    },
    select: binding,
    orderBy: { id: "asc" },
  });
  const groupRoles = user.groupId
    ? await tx.ramGroupRoleBinding.findMany({
        where: {
          accountOwnerId: principal.accountOwnerId,
          groupId: user.groupId,
          status: 1,
          role: { status: 1, accountOwnerId: principal.accountOwnerId },
        },
        select: binding,
        orderBy: { id: "asc" },
      })
    : [];
  const roleIds = [...new Set([...userRoles, ...groupRoles].map((binding) => binding.roleId))];
  return { user, userRoles, groupRoles, managementBypass, roleIds };
}
