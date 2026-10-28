import { projectPublicRetryStatusRules } from "@/util/relay/relay-failover-status-rule.util";
import { routingStrategySchema } from "@/api/schema/relay/relay-channel.schema";
import { DEFAULT_ROUTING_STRATEGY } from "./relay-channel-management-projection";
import type {
  RelayRoutingCatalogOptionDto,
  RelayAutomaticProxyPoolOptionDto,
  RelayAutomaticProxyPoolRoutingConfigDto,
  ContextLengthMultiplierRule,
  TimePeriodMultiplierRule,
} from "@/api/dto/relay/relay-channel.dto";
import type { RelayCatalogSnapshot, RelayCatalogSource } from "@/store/relay/relay-channel-catalog-read.repository";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { catalogModelCapabilities } from "./relay-channel-catalog-projection";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { formatRelayRequestFormats } from "@quyan/shared";
/** Explicit public DTO projection; unknown persisted routing keys must never become response fields. */
export function consumerRoutingConfig(value: unknown): RelayAutomaticProxyPoolRoutingConfigDto | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>,
    output: RelayAutomaticProxyPoolRoutingConfigDto = {};
  const integer = (key: "maxRetries" | "failoverThreshold" | "failbackCooldownMinutes", maximum: number) => {
    const item = input[key];
    if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= maximum) output[key] = item;
  };
  integer("maxRetries", 100);
  integer("failoverThreshold", 100);
  integer("failbackCooldownMinutes", 10080);
  const nullable = (
    key: "healthScoreThreshold" | "latencyThresholdMs" | "circuitBreakerThreshold",
    maximum: number,
    whole: boolean,
  ) => {
    const item = input[key];
    if (
      item === null ||
      (typeof item === "number" &&
        Number.isFinite(item) &&
        item >= 0 &&
        item <= maximum &&
        (!whole || Number.isInteger(item)))
    )
      output[key] = item;
  };
  nullable("healthScoreThreshold", 1, false);
  nullable("latencyThresholdMs", 600000, true);
  nullable("circuitBreakerThreshold", 1000, true);
  for (const key of ["stickyByModel", "stickyByFormat"] as const)
    if (typeof input[key] === "boolean") output[key] = input[key];
  if (input.rankingMode === "price-first" || input.rankingMode === "stability-first")
    output.rankingMode = input.rankingMode;
  const retryStatusCodes = projectPublicRetryStatusRules(input.retryStatusCodes);
  if (retryStatusCodes) output.retryStatusCodes = retryStatusCodes;
  return Object.keys(output).length ? output : undefined;
}
const effectivePrice = (source: RelayCatalogSource, now: Date) => {
  const multiplier = Number(source.multiplier),
    timePeriodMultiplier = computeMultiplierForTime(
      (source.timePeriodMultipliers as TimePeriodMultiplierRule[] | null) ?? [],
      now,
    );
  return { multiplier, timePeriodMultiplier, effectiveMultiplier: multiplier * timePeriodMultiplier };
};
/** Every contributing node is already admitted for the actor and visible to both actor and optional target. */
export async function projectRelayChannelRoutingCatalog(
  snapshot: RelayCatalogSnapshot,
  now = new Date(),
): Promise<RelayRoutingCatalogOptionDto[]> {
  const { sources, context } = snapshot,
    byId = new Map(sources.map((source) => [source.id, source])),
    resolver = RelayPoolResolverService.getInstance();
  const result: RelayRoutingCatalogOptionDto[] = [];
  for (const source of sources) {
    const channelType = source.channelType;
    if (channelType !== "standalone" && channelType !== "pooled" && channelType !== "automatic-proxy-pool") continue;
    const capabilities = await resolver.resolveChannelCapabilities(source.id, context),
      modelCapabilities = catalogModelCapabilities(capabilities);
    let automaticProxyPool: RelayAutomaticProxyPoolOptionDto | undefined;
    if (channelType === "automatic-proxy-pool") {
      const members: RelayAutomaticProxyPoolOptionDto["members"] = [],
        root = context.graph.get(source.id)!;
      for (const edge of root.poolMembers) {
        const member = byId.get(edge.memberChannelId);
        if (edge.enabled === false || !member) continue;
        // Resolve the complete root->member branch. Grouping by leaf IDs loses logical members and can combine sibling constraints.
        const branchGraph = new Map(context.graph);
        branchGraph.set(root.id, { ...root, poolMembers: [edge] });
        const branchCapabilities = catalogModelCapabilities(
          await resolver.resolveChannelCapabilities(root.id, { ...context, graph: branchGraph }),
        );
        members.push({
          id: member.id,
          name: member.name,
          enabled: true,
          priority: edge.priority,
          weight: Number(edge.weight),
          ...effectivePrice(member, now),
          contextLengthMultipliers: member.contextLengthMultipliers as unknown as
            | ContextLengthMultiplierRule[]
            | undefined,
          allowedFormats: formatRelayRequestFormats([
            ...new Set(branchCapabilities.flatMap((capability) => capability.supportedRequestFormats)),
          ]),
          modelCapabilities: branchCapabilities,
        });
      }
      const strategy = routingStrategySchema.safeParse(source.routingStrategy),
        routingStrategy = strategy.success ? strategy.data : DEFAULT_ROUTING_STRATEGY;
      automaticProxyPool = {
        routingStrategy,
        routingConfig: consumerRoutingConfig(source.routingConfig),
        members: members.sort(
          (a, b) => a.priority - b.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
      };
    }
    result.push({
      id: source.id,
      name: source.name,
      enabled: true,
      channelType,
      multiplier: Number(source.multiplier),
      contextLengthMultipliers: source.contextLengthMultipliers as unknown as ContextLengthMultiplierRule[] | undefined,
      allowedFormats: formatRelayRequestFormats([
        ...new Set(modelCapabilities.flatMap((capability) => capability.supportedRequestFormats)),
      ]),
      modelCapabilities,
      ...(automaticProxyPool ? { automaticProxyPool } : {}),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
