import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { RELAY_TOKEN_CREATION_LIMITS, RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { RELAY_COMPOSITION_POLICY } from "@/util/relay/relay-composition.util";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "../users/iam-account-principal";

/** Configuration only. Source credentials, aliases, usage, users and upstream details are never hydrated. */
export const relayTokenCopySelect = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
  name: true,
  expiresAt: true,
  routingMode: true,
  automaticProxyPoolChannelId: true,
  blockedAutomaticProxyPoolChannelIds: true,
  channelId: true,
  quotaLimit: true,
  allowedModels: true,
  ipWhitelist: true,
  modelMapping: true,
  requestFormatTransforms: true,
  normalizerConfig: true,
  streamConfig: true,
  contentSafetyConfig: true,
  channelConfigs: {
    select: { channelId: true, priority: true },
    orderBy: { priority: "asc" },
    take: RELAY_TOKEN_ROUTING_LIMITS.channels + 1,
  },
  memberTokenConfigs: {
    select: { tokenId: true, priority: true, enabled: true },
    orderBy: { priority: "asc" },
    take: RELAY_COMPOSITION_POLICY.maxMembers + 1,
  },
  quotaWindows: {
    select: { quotaLimit: true, quotaUnit: true, quotaWindowHours: true },
    orderBy: [{ quotaUnit: "asc" }, { quotaWindowHours: "asc" }],
    take: 21,
  },
  failoverConfig: {
    select: {
      enabled: true,
      maxRetries: true,
      retryStatusCodes: true,
      failoverThreshold: true,
      failbackCooldownMinutes: true,
      maxAcceptedChannelMultiplier: true,
      minCacheHitRate: true,
      cacheHitRateMinSamples: true,
      cacheHitRateWindowHours: true,
    },
  },
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenCopySource = Prisma.RelayTokenGetPayload<{ select: typeof relayTokenCopySelect }>;

export class RelayTokenCopyRepository {
  private static instance: RelayTokenCopyRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenCopyRepository());
  }
  async owner(id: string) {
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const row = await prisma.relayToken.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
    if (!row || row.id !== id || ![0, 1].includes(row.status) || !isRelayTokenResourceId(row.userId))
      throw iamAccountDenied();
    return row.userId;
  }
  private validate(userId: string, ids: readonly string[]) {
    if (
      !isRelayTokenResourceId(userId) ||
      !ids.length ||
      ids.length > RELAY_TOKEN_CREATION_LIMITS.batch ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isRelayTokenResourceId(id))
    )
      throw iamAccountDenied();
  }
  async lock(tx: Prisma.TransactionClient, userId: string, ids: readonly string[]) {
    this.validate(userId, ids);
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM relay_tokens WHERE userId = ${userId} AND status IN (0, 1) AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`,
    );
    if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id))) throw iamAccountDenied();
  }
  async sources(tx: Prisma.TransactionClient, userId: string, ids: readonly string[]): Promise<RelayTokenCopySource[]> {
    this.validate(userId, ids);
    const rows = await tx.relayToken.findMany({
      where: { userId, status: { in: [0, 1] }, id: { in: [...ids] } },
      select: relayTokenCopySelect,
    });
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) =>
          row.userId !== userId ||
          !ids.includes(row.id) ||
          row.channelConfigs.length > RELAY_TOKEN_ROUTING_LIMITS.channels ||
          row.memberTokenConfigs.length > RELAY_COMPOSITION_POLICY.maxMembers ||
          row.quotaWindows.length > 20,
      )
    )
      throw iamAccountDenied();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw iamAccountDenied();
      return row;
    });
  }
}
