import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
const selection = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
  routingMode: true,
  channelId: true,
  automaticProxyPoolChannelId: true,
  channelConfigs: {
    select: { id: true, channelId: true, priority: true, updateTime: true },
    orderBy: { priority: "asc" },
    take: RELAY_TOKEN_ROUTING_LIMITS.channels + 1,
  },
  memberTokenConfigs: { select: { id: true }, take: 1 },
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenChannelSource = Prisma.RelayTokenGetPayload<{ select: typeof selection }>;
export interface RelayTokenChannelChange {
  kind: "channel";
  source: RelayTokenChannelSource;
  channelId: string;
  configs: { channelId: string; priority: number }[];
}
/** A deterministic routing plan. It cannot implicitly convert composite or automatic tokens. */
export function planRelayTokenChannelChange(
  source: RelayTokenChannelSource,
  channelId: string,
): RelayTokenChannelChange {
  const previous = source.channelConfigs.length
    ? source.channelConfigs.map((row) => row.channelId)
    : source.channelId
      ? [source.channelId]
      : [];
  if (
    source.routingMode !== "ordered" ||
    source.automaticProxyPoolChannelId ||
    source.memberTokenConfigs.length ||
    !isRelayTokenResourceId(channelId) ||
    previous.some((id) => !isRelayTokenResourceId(id)) ||
    new Set(previous).size !== previous.length ||
    new Set(source.channelConfigs.map((row) => row.priority)).size !== source.channelConfigs.length ||
    (source.channelConfigs.length > 0 && (!source.channelId || !previous.includes(source.channelId)))
  )
    throw iamAccountDenied();
  const ids = [channelId, ...previous.filter((id) => id !== channelId)];
  if (ids.length > RELAY_TOKEN_ROUTING_LIMITS.channels) throw iamAccountDenied();
  return { kind: "channel", source, channelId, configs: ids.map((id, priority) => ({ channelId: id, priority })) };
}
export class RelayTokenChannelChangeRepository {
  private static instance: RelayTokenChannelChangeRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenChannelChangeRepository());
  }
  async snapshot(userId: string, id: string, tx: Prisma.TransactionClient = prisma) {
    const row = await tx.relayToken.findFirst({ where: { id, userId, status: { in: [0, 1] } }, select: selection });
    if (!row || row.id !== id || row.userId !== userId) throw iamAccountDenied();
    return row;
  }
  async verify(change: RelayTokenChannelChange, persisted: boolean, tx: Prisma.TransactionClient) {
    const current = await this.snapshot(change.source.userId, change.source.id, tx);
    if (!persisted) {
      if (JSON.stringify(current) !== JSON.stringify(change.source)) throw iamAccountDenied();
    } else if (
      current.routingMode !== "ordered" ||
      current.automaticProxyPoolChannelId ||
      current.memberTokenConfigs.length ||
      current.status !== change.source.status ||
      current.channelId !== change.channelId ||
      JSON.stringify(current.channelConfigs.map(({ channelId, priority }) => ({ channelId, priority }))) !==
        JSON.stringify(change.configs)
    )
      throw iamAccountDenied();
  }
}
