import type { RelayCapabilityGraphNode } from "@/services/relay/relay-pool-resolver.service";
import { resolveEffectiveRelayPoolMembers } from "@/services/relay/utils/relay-pool-members.util";
import type { RelayCatalogSource } from "./relay-catalog-source";

/** Credential-free, structured-cloneable projection shared by reads and post-commit warmup. */
export function buildRelayCatalogGraph(sources: readonly RelayCatalogSource[]): Map<string, RelayCapabilityGraphNode> {
  const byId = new Map(sources.map((row) => [row.id, row]));
  const children = new Map<string, RelayCatalogSource[]>();
  for (const row of sources)
    if (row.pooledParentId) {
      const list = children.get(row.pooledParentId) ?? [];
      list.push(row);
      children.set(row.pooledParentId, list);
    }
  return new Map(
    sources.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        status: row.status,
        providerServiceEnabled: row.providerServiceEnabled,
        channelType: row.channelType,
        allowedFormats: row.allowedFormats,
        allowedModels: row.allowedModels,
        modelMapping: row.modelMapping,
        routingConfig: row.routingConfig,
        multiplier: Number(row.multiplier),
        poolMembers: resolveEffectiveRelayPoolMembers<RelayCatalogSource>({
          ...row,
          pooledChildren: children.get(row.id) ?? [],
        })
          .filter((member) => byId.has(member.memberChannelId))
          .map((member) => ({
            memberChannelId: member.memberChannelId,
            priority: member.priority,
            weight: Number(member.weight),
            enabled: member.enabled,
          })),
      },
    ]),
  );
}
