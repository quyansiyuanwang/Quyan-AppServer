import type { Prisma } from "@prisma/client";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
export const metadataSelect = { id: true, status: true, providerServiceEnabled: true, updateTime: true } as const;
/** Consumer projection only: never URLs, credentials, provider identities, or complete configuration. */
export const relayCatalogSourceSelect = {
  ...metadataSelect,
  name: true,
  channelType: true,
  routingStrategy: true,
  allowedFormats: true,
  allowedModels: true,
  modelMapping: true,
  routingConfig: true,
  multiplier: true,
  timePeriodMultipliers: true,
  contextLengthMultipliers: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  poolMembers: {
    select: { memberChannelId: true, priority: true, weight: true, enabled: true },
    orderBy: { memberChannelId: "asc" },
    take: RELAY_CAPABILITY_RESOLUTION_LIMITS.channelNodes + 1,
  },
} as const satisfies Prisma.RelayChannelSelect;
export type RelayCatalogSource = Prisma.RelayChannelGetPayload<{ select: typeof relayCatalogSourceSelect }>;
