import { captureIamOAuthRevision } from "../users/iam-oauth-authority";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
const userSelect = { id: true, accountOwnerId: true, groupId: true, status: true, updateTime: true } as const;
export interface RelayTokenAuthorityIdentity {
  principal: IamPrincipal;
  userId: string;
  managed: boolean;
  oauth?: { id: string; clientId: string };
}
export interface RelayTokenAuthoritySnapshot {
  users: Prisma.UserGetPayload<{ select: typeof userSelect }>[];
  group?: { id: string; updateTime: Date };
  actorGroup?: { id: string; updateTime: Date };
  oauthRevision?: string;
}
/** Trusted operation profiles only. Request input must never choose these ceilings. */
export const RELAY_TOKEN_AUTHORITY_REQUIREMENTS = Object.freeze({
  read: Object.freeze({
    operationPermission: Permission.RELAY_TOKEN_READ,
    managementPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
  }),
  update: Object.freeze({
    operationPermission: Permission.RELAY_TOKEN_UPDATE,
    managementPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
  }),
  delete: Object.freeze({
    operationPermission: Permission.RELAY_TOKEN_DELETE,
    managementPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
  }),
});
export async function captureRelayTokenAuthority(
  identity: RelayTokenAuthorityIdentity,
  requirements: (typeof RELAY_TOKEN_AUTHORITY_REQUIREMENTS)[keyof typeof RELAY_TOKEN_AUTHORITY_REQUIREMENTS],
  tx: Prisma.TransactionClient = prisma,
): Promise<RelayTokenAuthoritySnapshot> {
  const { principal, userId, managed, oauth } = identity;
  if (!isRelayTokenResourceId(userId) || managed !== (userId !== principal.subjectUserId)) throw iamAccountDenied();
  await assertIamAccountPrincipal(principal, tx);
  const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId, userId])].sort();
  const users = await tx.user.findMany({
    where: { id: { in: ids }, status: 1 },
    select: userSelect,
    orderBy: { id: "asc" },
  });
  if (users.length !== ids.length || users.some((row, index) => row.id !== ids[index])) throw iamAccountDenied();
  const actor = users.find((row) => row.id === principal.subjectUserId)!;
  let actorGroup: { id: string; updateTime: Date } | undefined;
  if (actor.groupId) {
    const group = await tx.group.findUnique({
      where: { id: actor.groupId },
      select: { id: true, updateTime: true, status: true, accountOwnerId: true },
    });
    if (!group || group.status !== 1 || (group.accountOwnerId && group.accountOwnerId !== principal.accountOwnerId))
      throw iamAccountDenied();
    actorGroup = { id: group.id, updateTime: group.updateTime };
  }
  const group = managed
    ? await platformManagementGroupSnapshot(principal, requirements.managementPermission, tx)
    : undefined;
  const oauthRevision = await captureIamOAuthRevision(
    principal,
    oauth,
    [requirements.operationPermission, ...(managed ? [requirements.managementPermission] : [])],
    tx,
  );

  return {
    users,
    ...(group ? { group } : {}),
    ...(actorGroup ? { actorGroup } : {}),
    ...(oauthRevision ? { oauthRevision } : {}),
  };
}
