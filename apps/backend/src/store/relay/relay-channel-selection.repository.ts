import { relayChannelVisibilityPrincipal } from "./relay-channel-visibility-principal";
import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { isRelayChannelVisible } from "@/util/relay/relay-channel-visibility.util";
import { iamAccountDenied } from "../users/iam-account-principal";

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
  async snapshot(
    principal: IamPrincipal,
    ids: readonly string[],
    tx: Prisma.TransactionClient = prisma,
    mode: "ordered" | "automatic" = "ordered",
  ) {
    if (
      !ids.length ||
      (mode === "automatic" && ids.length !== 1) ||
      ids.length > RELAY_TOKEN_ROUTING_LIMITS.channels ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isRelayTokenResourceId(id))
    )
      throw iamAccountDenied();
    const { user, userRoles, groupRoles, managementBypass, roleIds } = await relayChannelVisibilityPrincipal(
      principal,
      tx,
    );
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
          channel.status !== RELAY_CHANNEL_STATUS.ENABLED ||
          channel.providerServiceEnabled === false ||
          (mode === "automatic"
            ? channel.channelType !== "automatic-proxy-pool"
            : channel.channelType === "automatic-proxy-pool") ||
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
