import type {
  RelayChannelOptionDto,
  RelayChannelType,
  ContextLengthMultiplierRule,
  TimePeriodMultiplierRule,
} from "@/api/dto/relay/relay-channel.dto";
import type { RelayCatalogSnapshot } from "@/store/relay/relay-channel-catalog-read.repository";
import { formatRelayRequestFormats } from "@quyan/shared";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { catalogModelCapabilities } from "./relay-channel-catalog-projection";
import { projectRelayChannelRoutingCatalog } from "./relay-channel-routing-catalog-projection";
import { computeMultiplierForTime } from "./time-period-multiplier.service";

/** Optional topology has its own per-node admission; it never expands the basic admitted graph. */
export async function projectRelayChannelOptions(
  snapshot: RelayCatalogSnapshot,
  metadataIds: ReadonlySet<string>,
  excludePooled: boolean,
  now = new Date(),
): Promise<RelayChannelOptionDto[]> {
  const { sources, context } = snapshot;
  const metadataSources = sources.filter((source) => metadataIds.has(source.id));
  const metadataGraph = new Map(
    [...context.graph]
      .filter(([id]) => metadataIds.has(id))
      .map(([id, node]) => [
        id,
        { ...node, poolMembers: node.poolMembers.filter((member) => metadataIds.has(member.memberChannelId)) },
      ]),
  );
  const metadataContext = { ...context, graph: metadataGraph };
  const routing = new Map(
    (
      await projectRelayChannelRoutingCatalog({ ...snapshot, sources: metadataSources, context: metadataContext }, now)
    ).map((row) => [row.id, row]),
  );
  const metadataById = new Map(metadataSources.map((source) => [source.id, source]));
  const resolver = RelayPoolResolverService.getInstance();
  const results: RelayChannelOptionDto[] = [];
  for (const source of sources) {
    const channelType = source.channelType as RelayChannelType;
    if (
      !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(channelType) ||
      (excludePooled && channelType === "pooled")
    )
      continue;
    const capabilities = await resolver.resolveChannelCapabilities(source.id, context);
    const modelCapabilities = catalogModelCapabilities(capabilities);
    const isPool = channelType === "pooled" || channelType === "automatic-proxy-pool";
    const option: RelayChannelOptionDto = {
      id: source.id,
      name: source.name,
      enabled: true,
      multiplier: Number(source.multiplier),
      contextLengthMultipliers: source.contextLengthMultipliers as unknown as ContextLengthMultiplierRule[] | undefined,
      allowedFormats: isPool
        ? formatRelayRequestFormats([...new Set(modelCapabilities.flatMap((item) => item.supportedRequestFormats))])
        : (source.allowedFormats ?? "openai-chat-completions,anthropic,gemini"),
      modelCapabilities,
    };
    if (metadataIds.has(source.id)) {
      option.channelType = channelType;
      if (channelType === "automatic-proxy-pool")
        option.automaticProxyPool = routing.get(source.id)?.automaticProxyPool;
      if (isPool) {
        const resolved = await resolver.resolveChannelCapabilities(source.id, metadataContext);
        const leafIds = [...new Set(resolved.map((capability) => capability.leafChannelId))];
        option.poolPricing = {
          members: leafIds
            .flatMap((id) => {
              const leaf = metadataById.get(id);
              if (!leaf) return [];
              const multiplier = Number(leaf.multiplier),
                timePeriodMultiplier = computeMultiplierForTime(
                  (leaf.timePeriodMultipliers as TimePeriodMultiplierRule[] | null) ?? [],
                  now,
                );
              return [
                {
                  id,
                  name: leaf.name,
                  enabled: true,
                  multiplier,
                  timePeriodMultiplier,
                  effectiveMultiplier: multiplier * timePeriodMultiplier,
                  contextLengthMultipliers: leaf.contextLengthMultipliers as unknown as
                    | ContextLengthMultiplierRule[]
                    | undefined,
                  modelCapabilities: catalogModelCapabilities(
                    resolved.filter((capability) => capability.leafChannelId === id),
                  ),
                },
              ];
            })
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        };
      }
    }
    results.push(option);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
