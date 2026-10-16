import type { RelayChannel } from "@prisma/client";
import type {
  RelayCatalogOptionDto,
  RelayCatalogModelPriceRangeDto,
  TimePeriodMultiplierRule,
  ContextLengthMultiplierRule,
} from "@/api/dto/relay/relay-channel.dto";
import type { RelayCatalogSnapshot } from "@/store/relay/relay-channel-catalog-read.repository";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { isChannelServiceEnabled } from "./relay-channel-management-projection";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { formatRelayRequestFormats } from "@quyan/shared";
import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
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
  const suppressed = new Set<string>();
  if (poolVisibility === "anonymous-range") {
    const queue = sources.filter((row) => isPool(row.channelType)).map((row) => row.id),
      visited = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (visited.size > RELAY_CAPABILITY_RESOLUTION_LIMITS.traversalVisits) throw iamAccountDenied();
      for (const member of context.graph.get(id)?.poolMembers ?? []) {
        if (!member.enabled || !byId.has(member.memberChannelId)) continue;
        suppressed.add(member.memberChannelId);
        if (isPool(byId.get(member.memberChannelId)!.channelType)) queue.push(member.memberChannelId);
      }
    }
  }
  const result: RelayCatalogOptionDto[] = [];
  for (const source of sources) {
    if (
      source.channelType === "pooled-member" ||
      suppressed.has(source.id) ||
      (source.channelType === "pooled" && poolVisibility !== "anonymous-range")
    )
      continue;
    const capabilities = await RelayPoolResolverService.getInstance().resolveChannelCapabilities(source.id, context),
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
