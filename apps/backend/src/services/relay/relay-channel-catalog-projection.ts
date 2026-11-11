import type { RelayChannel } from "@prisma/client";
import type {
  RelayCatalogOptionDto,
  RelayCatalogModelPriceRangeDto,
  RelayCatalogModelMappingDto,
  TimePeriodMultiplierRule,
  ContextLengthMultiplierRule,
} from "@/api/dto/relay/relay-channel.dto";
import type { RelayCatalogSnapshot } from "@/store/relay/relay-channel-catalog-read.repository";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { isChannelServiceEnabled } from "./relay-channel-management-projection";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { formatRelayRequestFormats, getHigherPriorityModelPatterns, RELAY_REQUEST_FORMAT_ORDER } from "@quyan/shared";
type CatalogPricingSource = Pick<
  RelayChannel,
  "status" | "providerServiceEnabled" | "multiplier" | "timePeriodMultipliers" | "contextLengthMultipliers"
>;
export function catalogModelCapabilities(
  resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
): RelayCatalogOptionDto["modelCapabilities"] {
  const capabilities = new Map<string, RelayCatalogOptionDto["modelCapabilities"][number]>();
  for (const capability of resolvedCapabilities) {
    const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
    const existing = capabilities.get(key);
    if (existing) {
      existing.supportedRequestFormats = [
        ...new Set([...existing.supportedRequestFormats, ...capability.supportedRequestFormats]),
      ];
    } else {
      capabilities.set(key, {
        catalogModelName: capability.catalogModelName,
        requestModelId: capability.requestModelId,
        supportedRequestFormats: [...capability.supportedRequestFormats],
      });
    }
  }
  return [...capabilities.values()].sort(
    (left, right) =>
      left.catalogModelName.localeCompare(right.catalogModelName) ||
      left.requestModelId.localeCompare(right.requestModelId),
  );
}

/** Project aliases before aggregating capabilities, keeping exclusions and formats on the same route. */
export function catalogModelMappings(
  resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
): RelayCatalogModelMappingDto[] {
  const mappings = new Map<string, RelayCatalogModelMappingDto>();
  for (const capability of resolvedCapabilities) {
    const patterns = Object.keys(capability.modelMapping);
    for (const [requestModelPattern, target] of Object.entries(capability.modelMapping)) {
      // Pricing resolution trims the selected target; patterns retain the resolver's byte semantics.
      if (typeof target !== "string" || target.trim() !== capability.requestModelId) continue;
      if (capability.supportedRequestFormats.length === 0) continue;
      // Determine priority before canonicalizing the exclusion set for deduplication.
      const exclusions = getHigherPriorityModelPatterns(requestModelPattern, patterns).sort((a, b) =>
        a.localeCompare(b),
      );
      const key = JSON.stringify([
        requestModelPattern,
        capability.catalogModelName,
        capability.requestModelId,
        exclusions,
      ]);
      const existing = mappings.get(key);
      if (existing) {
        existing.supportedRequestFormats = [
          ...new Set([...existing.supportedRequestFormats, ...capability.supportedRequestFormats]),
        ];
      } else {
        mappings.set(key, {
          requestModelPattern,
          catalogModelName: capability.catalogModelName,
          billingModelId: capability.requestModelId,
          supportedRequestFormats: [...new Set(capability.supportedRequestFormats)],
          ...(exclusions.length ? { excludedRequestModelPatterns: exclusions } : {}),
        });
      }
    }
  }
  for (const mapping of mappings.values())
    mapping.supportedRequestFormats.sort(
      (a, b) => RELAY_REQUEST_FORMAT_ORDER.indexOf(a) - RELAY_REQUEST_FORMAT_ORDER.indexOf(b),
    );
  return [...mappings.values()].sort(
    (a, b) =>
      a.requestModelPattern.localeCompare(b.requestModelPattern) ||
      a.catalogModelName.localeCompare(b.catalogModelName) ||
      a.billingModelId.localeCompare(b.billingModelId) ||
      JSON.stringify(a.excludedRequestModelPatterns ?? []).localeCompare(
        JSON.stringify(b.excludedRequestModelPatterns ?? []),
      ),
  );
}

export function catalogModelPriceRanges(
  resolvedCapabilities: Awaited<ReturnType<RelayPoolResolverService["resolveChannelCapabilities"]>>,
  activeChannelsById: ReadonlyMap<string, CatalogPricingSource>,
  now: Date,
): RelayCatalogModelPriceRangeDto[] {
  const ranges = new Map<string, RelayCatalogModelPriceRangeDto>();

  for (const capability of resolvedCapabilities) {
    const leaf = activeChannelsById.get(capability.leafChannelId);
    if (!leaf || !isChannelServiceEnabled(leaf)) continue;

    const key = `${capability.catalogModelName}\u0000${capability.requestModelId}`;
    const multipliers = getCatalogContextMultipliers(leaf, now);
    if (multipliers.length === 0) continue;

    const minMultiplier = Math.min(...multipliers);
    const maxMultiplier = Math.max(...multipliers);
    const existing = ranges.get(key);
    if (existing) {
      existing.minMultiplier = Math.min(existing.minMultiplier, minMultiplier);
      existing.maxMultiplier = Math.max(existing.maxMultiplier, maxMultiplier);
    } else {
      ranges.set(key, {
        catalogModelName: capability.catalogModelName,
        requestModelId: capability.requestModelId,
        minMultiplier,
        maxMultiplier,
      });
    }
  }

  return [...ranges.values()].sort(
    (left, right) =>
      left.catalogModelName.localeCompare(right.catalogModelName) ||
      left.requestModelId.localeCompare(right.requestModelId),
  );
}

function getCatalogContextMultipliers(channel: CatalogPricingSource, now: Date): number[] {
  const baseMultiplier =
    Number(channel.multiplier) *
    computeMultiplierForTime(
      (channel.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
      now,
    );
  const rules = (channel.contextLengthMultipliers as ContextLengthMultiplierRule[] | null | undefined) ?? [];
  const contextMultipliers = rules.filter((rule) => rule.enabled).map((rule) => Number(rule.multiplier));
  if (!contextMultipliers.includes(1)) contextMultipliers.push(1);
  return contextMultipliers.filter(Number.isFinite).map((multiplier) => baseMultiplier * multiplier);
}

/** Project only independently admitted, visible graph nodes; never re-preload the global graph. */
export async function projectRelayChannelCatalog(
  snapshot: RelayCatalogSnapshot,
  now = new Date(),
): Promise<RelayCatalogOptionDto[]> {
  const { sources, context, poolVisibility } = snapshot,
    byId = new Map(sources.map((row) => [row.id, row]));
  const isPool = (type: string) => type === "pooled" || type === "automatic-proxy-pool";
  const result: RelayCatalogOptionDto[] = [];
  for (const source of sources) {
    // Pool membership does not revoke a channel's independent catalog visibility.
    if (
      source.channelType === "pooled-member" ||
      (source.channelType === "pooled" && poolVisibility !== "anonymous-range")
    )
      continue;
    const capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(source.id, context, {
        preserveModelMappingPaths: true,
      }),
      modelCapabilities = catalogModelCapabilities(capabilities),
      variable = source.channelType === "automatic-proxy-pool";
    result.push({
      id: source.id,
      name: source.name,
      enabled: true,
      isAutomaticProxyPool: variable,
      allowedFormats: isPool(source.channelType)
        ? formatRelayRequestFormats([...new Set(modelCapabilities.flatMap((row) => row.supportedRequestFormats))])
        : (source.allowedFormats ?? "openai-chat-completions,anthropic,gemini"),
      modelCapabilities,
      modelMappings: catalogModelMappings(capabilities),
      pricingEffectiveAt: now,
      priceMayVary: variable,
      ...(variable
        ? { pricingMode: "range" as const, modelPriceRanges: catalogModelPriceRanges(capabilities, byId, now) }
        : {
            pricingMode: "fixed" as const,
            multiplier:
              Number(source.multiplier) *
              computeMultiplierForTime((source.timePeriodMultipliers as TimePeriodMultiplierRule[] | null) ?? [], now),
            contextLengthMultipliers: source.contextLengthMultipliers as unknown as
              | ContextLengthMultiplierRule[]
              | undefined,
          }),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
