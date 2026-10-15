import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { RELAY_CHANNEL_VISIBILITY_MANAGEMENT_PERMISSIONS } from "@/constant/relay-channel";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import { parseLegacyPermissions } from "@/iam/legacy-policy";
import { iamAccountDenied, assertIamAccountPrincipal } from "../users/iam-account-principal";

const selection = {
  id: true,
  status: true,
  updateTime: true,
  providerServiceEnabled: true,
  visibilityMode: true,
  visibilityConfig: true,
  channelType: true,
} as const satisfies Prisma.RelayChannelSelect;
/** Persisted visibility proof only: no channel labels, topology, user passwords or credentials. */
export class RelayChannelSelectionRepository {
  private static instance: RelayChannelSelectionRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelSelectionRepository());
  }
  async snapshot(principal: IamPrincipal, ids: readonly string[], tx: Prisma.TransactionClient = prisma) {
    if (
      !ids.length ||
      ids.length > RELAY_TOKEN_ROUTING_LIMITS.channels ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isRelayTokenResourceId(id))
    )
      throw iamAccountDenied();
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
    const channels = await tx.relayChannel.findMany({
      where: { id: { in: [...ids] } },
      select: selection,
      orderBy: { id: "asc" },
    });
    if (
      channels.length !== ids.length ||
      channels.some(
        (channel) =>
          !ids.includes(channel.id) ||
          channel.status !== 1 ||
          channel.providerServiceEnabled === false ||
          ["automatic-proxy-pool"].includes(channel.channelType) ||
          channel.visibilityMode === "hidden" ||
          (!managementBypass && !isRelayChannelVisible(channel, { id: user.id, groupId: user.groupId, roleIds })),
      )
    )
      throw iamAccountDenied();
    return { user, userRoles, groupRoles, channels };
  }
  async lock(tx: Prisma.TransactionClient, ids: readonly string[]) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`,
    );
  }
}
