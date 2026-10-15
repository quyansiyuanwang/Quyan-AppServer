import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayCompositionGraphSelect } from "./relay-token-composition-read.repository";
import type { RelayTokenInspectionTarget } from "./relay-token-inspection.repository";
import type { RelayCapabilityGraphNode } from "@/services/relay/relay-pool-resolver.service";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";

const tokenSelect = {
  ...relayCompositionGraphSelect,
  allowedModels: true,
  modelMapping: true,
  requestFormatTransforms: true,
  channelId: true,
  automaticProxyPoolChannelId: true,
  blockedAutomaticProxyPoolChannelIds: true,
  channelConfigs: { select: { id: true, channelId: true, priority: true, updateTime: true }, orderBy: { id: "asc" } },
  failoverConfig: { select: { maxAcceptedChannelMultiplier: true, updateTime: true } },
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenCapabilitySnapshot = Prisma.RelayTokenGetPayload<{ select: typeof tokenSelect }>;
/** No name, upstream URL, credentials, prices, user record or full channel configuration. */
const channelSelect = {
  id: true,
  status: true,
  updateTime: true,
  providerServiceEnabled: true,
  channelType: true,
  allowedFormats: true,
  allowedModels: true,
  modelMapping: true,
  routingConfig: true,
  multiplier: true,
  poolMembers: {
    select: { memberChannelId: true, priority: true, weight: true, enabled: true },
    orderBy: { id: "asc" },
  },
  pooledChildren: {
    select: { id: true, pooledPriority: true, pooledWeight: true, pooledMemberEnabled: true },
    orderBy: { id: "asc" },
  },
} as const satisfies Prisma.RelayChannelSelect;
export class RelayTokenCapabilityRepository {
  private static instance: RelayTokenCapabilityRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenCapabilityRepository());
  }
  async tokens(userId: string, targets: readonly RelayTokenInspectionTarget[]) {
    const rows: RelayTokenCapabilitySnapshot[] = [];
    for (let offset = 0; offset < targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      if (new Set(batch.map((row) => row.id)).size !== batch.length || batch.some((row) => row.userId !== userId))
        throw iamAccountDenied();
      const found = await prisma.relayToken.findMany({
        where: { userId, OR: batch.map((row) => ({ id: row.id, status: row.status, updateTime: row.updateTime })) },
        select: tokenSelect,
        orderBy: { id: "asc" },
      });
      if (
        found.length !== batch.length ||
        found.some((row) => row.userId !== userId || !batch.some((old) => old.id === row.id))
      )
        throw iamAccountDenied();
      rows.push(...found);
    }
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }
  async channels(rootIds: readonly string[]) {
    const rows = new Map<string, Prisma.RelayChannelGetPayload<{ select: typeof channelSelect }>>();
    const seen = new Set<string>();
    let frontier = [...new Set(rootIds)].sort();
    while (frontier.length) {
      if (seen.size + frontier.length > RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes) throw iamAccountDenied();
      const next = new Set<string>();
      for (let offset = 0; offset < frontier.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
        const ids = frontier.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
        ids.forEach((id) => seen.add(id));
        const found = await prisma.relayChannel.findMany({
          where: { id: { in: ids } },
          select: channelSelect,
          orderBy: { id: "asc" },
        });
        for (const row of found) {
          if (!ids.includes(row.id)) throw iamAccountDenied();
          rows.set(row.id, row);
          if (!["pooled", "automatic-proxy-pool"].includes(row.channelType)) continue;
          for (const edge of resolveEffectiveRelayPoolMembers<{ id: string; channelType: string }>({
            id: row.id,
            channelType: row.channelType,
            poolMembers: row.poolMembers,
            pooledChildren: row.pooledChildren.map((child) => ({ ...child, channelType: "pooled-member" })),
          }))
            if (!seen.has(edge.memberChannelId)) next.add(edge.memberChannelId);
        }
      }
      frontier = [...next].filter((id) => !seen.has(id)).sort();
    }
    const sources = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
    const graph = new Map<string, RelayCapabilityGraphNode & { multiplier: Prisma.Decimal }>();
    for (const row of sources)
      graph.set(row.id, {
        ...row,
        name: row.id,
        poolMembers: resolveEffectiveRelayPoolMembers<{ id: string; channelType: string }>({
          id: row.id,
          channelType: row.channelType,
          poolMembers: row.poolMembers,
          pooledChildren: row.pooledChildren.map((child) => ({ ...child, channelType: "pooled-member" })),
        }),
      });
    return { sources, graph };
  }
  async catalog() {
    return prisma.modelPricing.findMany({
      where: { status: 1 },
      select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
      orderBy: { id: "asc" },
    });
  }
}
