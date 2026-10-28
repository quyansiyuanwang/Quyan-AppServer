import { resolveMappedModel } from "@/util/model-mapping.util";
import { isModelIdAllowed, isModelNameAllowed, resolveModelId } from "@/util/model-resolution.util";
import {
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  supportsRelayRequestFormat,
  type RelayModelFormatLike,
  type RelayRequestFormat,
  type RelayChannelAccessLike,
} from "@/util/relay/relay-model-availability.util";

/** Capability discovery needs public model identities and route constraints, never upstream credentials or prices. */
export interface RelayModelDiscoveryToken {
  allowedModels?: string | null;
  modelMapping?: unknown;
}
export interface RelayModelDiscoveryChannel extends RelayChannelAccessLike {
  modelMapping?: unknown;
}
/** Channels must already carry constraints for one intact root-to-leaf route. Do not union capabilities first. */
export function projectRelayAvailableModels(
  token: RelayModelDiscoveryToken,
  channels: readonly RelayModelDiscoveryChannel[],
  modelCatalog: readonly RelayModelFormatLike[],
  requestFormat: RelayRequestFormat,
): string[] {
  const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(token.allowedModels);
  const formatScopedModels = modelCatalog.filter((model) =>
    supportsRelayRequestFormat(model.supportedFormats, requestFormat),
  );
  const modelIds = new Set<string>();
  const tokenAvailableModelTargets = new Set<string>();
  const getModelMappingEntries = (mapping: unknown): Array<[string, string]> => {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return [];

    return Object.entries(mapping).reduce<Array<[string, string]>>((entries, [source, target]) => {
      if (typeof target !== "string") return entries;
      const sourceModel = source.trim();
      const targetModel = target.trim();
      if (sourceModel && targetModel) entries.push([sourceModel, targetModel]);
      return entries;
    }, []);
  };
  const addMappedModelKeys = (mapping: unknown, availableTargets: ReadonlySet<string>) => {
    for (const [sourceModel, targetModel] of getModelMappingEntries(mapping))
      if (availableTargets.has(targetModel)) modelIds.add(sourceModel);
  };

  for (const channel of channels) {
    if (!supportsRelayRequestFormat(channel.allowedFormats, requestFormat)) continue;
    const channelAllowedModelNames = parseRelayChannelAllowedModelNames(channel);
    // `/v1/models` describes the models explicitly configured on the token's
    // channels. An unrestricted channel is still routable, but it must not
    // turn the endpoint into a dump of the entire global pricing catalog.
    const channelScopedModels =
      channelAllowedModelNames == null
        ? []
        : formatScopedModels.filter(
            (model) =>
              isModelNameAllowed(channelAllowedModelNames, model.model || "") ||
              isModelNameAllowed(channelAllowedModelNames, resolveModelId(model)),
          );
    const channelAvailableModelTargets = new Set<string>();

    for (const model of channelScopedModels) {
      const modelId = resolveModelId(model).trim();
      if (!modelId) continue;
      if (tokenAllowedModelIds.length > 0 && !isModelIdAllowed(tokenAllowedModelIds, model)) continue;

      modelIds.add(modelId);
      channelAvailableModelTargets.add(modelId);
      tokenAvailableModelTargets.add(modelId);

      // Model mappings created from the management UI may use a pricing
      // display name as the target, while requests use the provider/model ID.
      const modelName = model.model?.trim();
      if (modelName) {
        channelAvailableModelTargets.add(modelName);
        tokenAvailableModelTargets.add(modelName);
      }
    }

    // A channel alias is available only when its mapping target is available
    // on that same resolved channel and in the token's allow-list.
    addMappedModelKeys(channel.modelMapping, channelAvailableModelTargets);
  }

  // Token aliases apply to every eligible channel, so they can be exposed if
  // their target is available through at least one of those channels.
  addMappedModelKeys(token.modelMapping, tokenAvailableModelTargets);

  return [...modelIds].sort((left, right) => left.localeCompare(right));
}

/** Evaluate one route, never a union of capabilities from different paths. */
export function canServeRelayDiscoveryModel(
  token: RelayModelDiscoveryToken & { failoverConfig?: { maxAcceptedChannelMultiplier?: unknown } | null },
  channel: RelayModelDiscoveryChannel & { multiplier?: unknown },
  modelCatalog: readonly RelayModelFormatLike[],
  format: RelayRequestFormat,
  model: string,
): boolean {
  if (!supportsRelayRequestFormat(channel.allowedFormats, format)) return false;
  const maximum = token.failoverConfig?.maxAcceptedChannelMultiplier;
  if (maximum != null && Number(channel.multiplier) > Number(maximum)) return false;
  const mapped = resolveMappedModel(
    model,
    channel.modelMapping as Record<string, string>,
    token.modelMapping as Record<string, string>,
  );
  const allowedNames = parseRelayChannelAllowedModelNames(channel);
  const candidates = modelCatalog.filter(
    (row) => resolveModelId(row).trim() === mapped.trim() && supportsRelayRequestFormat(row.supportedFormats, format),
  );
  const effective =
    allowedNames === null
      ? candidates[0]
      : (candidates.find((row) => isModelNameAllowed(allowedNames, row.model || "")) ??
        candidates.find((row) => isModelNameAllowed(allowedNames, resolveModelId(row))));
  if (!effective) return false;
  const allowed = parseRelayTokenAllowedModelIds(token.allowedModels);
  return (
    !allowed.length ||
    isModelIdAllowed(allowed, effective) ||
    modelCatalog.some((row) => resolveModelId(row).trim() === model.trim() && isModelIdAllowed(allowed, row))
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
