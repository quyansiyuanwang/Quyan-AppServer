import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { RELAY_CHANNEL_VISIBILITY_MANAGEMENT_PERMISSIONS } from "@/constant/relay-channel";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
/** Business visibility is a persisted ceiling; an account policy cannot mint a global management bypass. */
export async function relayChannelVisibilityPrincipal(principal: IamPrincipal, tx: Prisma.TransactionClient) {
  await assertIamAccountPrincipal(principal, tx);
  return readVisibilityIdentity(principal.subjectUserId, principal.accountOwnerId, tx);
}
/** Authorization is the caller's responsibility; this helper only derives persisted business visibility. */
async function readVisibilityIdentity(userId: string, accountOwnerId: string, tx: Prisma.TransactionClient) {
  const user = await tx.user.findUnique({
    where: { id: userId },
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
    user.id !== userId ||
    user.status !== 1 ||
    (user.accountOwnerId || user.id) !== accountOwnerId ||
    (user.groupId &&
      (!user.group ||
        user.group.id !== user.groupId ||
        user.group.status !== 1 ||
        (user.group.accountOwnerId && user.group.accountOwnerId !== accountOwnerId)))
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
      accountOwnerId: accountOwnerId,
      userId: user.id,
      status: 1,
      role: { status: 1, accountOwnerId: accountOwnerId },
    },
    select: binding,
    orderBy: { id: "asc" },
  });
  const groupRoles = user.groupId
    ? await tx.ramGroupRoleBinding.findMany({
        where: {
          accountOwnerId: accountOwnerId,
          groupId: user.groupId,
          status: 1,
          role: { status: 1, accountOwnerId: accountOwnerId },
        },
        select: binding,
        orderBy: { id: "asc" },
      })
    : [];
  const roleIds = [...new Set([...userRoles, ...groupRoles].map((binding) => binding.roleId))];
  return { user, userRoles, groupRoles, managementBypass, roleIds };
}

/** No target IAM policy is loaded and no target principal is manufactured. Call only after actor preview admission. */
export async function relayChannelTargetVisibility(actor: IamPrincipal, userId: string, tx: Prisma.TransactionClient) {
  await assertIamAccountPrincipal(actor, tx);
  const target = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, accountOwnerId: true, updateTime: true },
  });
  if (!target || target.id !== userId || target.status !== 1) throw iamAccountDenied();
  const ownerId = target.accountOwnerId || target.id;
  const owner = await tx.user.findUnique({
    where: { id: ownerId },
    select: { id: true, status: true, accountOwnerId: true, updateTime: true },
  });
  if (!owner || owner.id !== ownerId || owner.status !== 1 || (owner.accountOwnerId || owner.id) !== owner.id)
    throw iamAccountDenied();
  return { target, owner, visibility: await readVisibilityIdentity(userId, ownerId, tx) };
}
