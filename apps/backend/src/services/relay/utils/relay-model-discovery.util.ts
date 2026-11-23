import { resolveRelayModelRoute, relayModelRouteRequestCandidates } from "./relay-model-route.util";
import { isModelIdAllowed, resolveModelId } from "@/util/model-resolution.util";
import {
  parseRelayTokenAllowedModelIds,
  type RelayModelFormatLike,
  type RelayRequestFormat,
  type RelayChannelAccessLike,
} from "@/util/relay/relay-model-availability.util";

/** Capability discovery needs public model identities and route constraints, never upstream credentials or prices. */
export interface RelayModelDiscoveryToken {
  allowedModels?: string | null;
  modelMapping?: unknown;
  modelMappingRules?: unknown;
}
export interface RelayModelDiscoveryChannel extends RelayChannelAccessLike {
  routingChannelIds?: readonly string[];
  modelMapping?: unknown;
}
/** Channels must already carry constraints for one intact root-to-leaf route. Do not union capabilities first. */
export function projectRelayAvailableModels(
  token: RelayModelDiscoveryToken,
  channels: readonly RelayModelDiscoveryChannel[],
  modelCatalog: readonly RelayModelFormatLike[],
  requestFormat: RelayRequestFormat,
): string[] {
  return relayModelRouteRequestCandidates([token], channels, modelCatalog).filter((model) =>
    channels.some((channel) => canServeRelayDiscoveryModel(token, channel, modelCatalog, requestFormat, model)),
  );
}

/** Evaluate one route, never a union of capabilities from different paths. */
export function canServeRelayDiscoveryModel(
  token: RelayModelDiscoveryToken & { failoverConfig?: { maxAcceptedChannelMultiplier?: unknown } | null },
  channel: RelayModelDiscoveryChannel & { multiplier?: unknown },
  modelCatalog: readonly RelayModelFormatLike[],
  format: RelayRequestFormat,
  model: string,
): boolean {
  return Boolean(
    resolveRelayModelRoute({ requestedModel: model, requestFormat: format, tokens: [token], channel, modelCatalog })
      .modelConfig,
  );
}
export function relayDiscoveryAllowsModels(
  token: RelayModelDiscoveryToken,
  catalog: readonly RelayModelFormatLike[],
  ...names: string[]
): boolean {
  const allowed = parseRelayTokenAllowedModelIds(token.allowedModels);
  return (
    !allowed.length ||
    names.some(
      (name) =>
        allowed.includes(name) ||
        catalog.some((row) => resolveModelId(row).trim() === name.trim() && isModelIdAllowed(allowed, row)),
    )
  );
}
