import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import logger from "@/util/logger";
import {
  isModelIdAllowed,
  isModelNameAllowed,
  parseAllowedModelsJson,
  resolveModelId,
} from "@/util/model-resolution.util";

export type RelayRequestFormat = "openai" | "anthropic" | "gemini";

export const ALL_RELAY_REQUEST_FORMATS: RelayRequestFormat[] = ["openai", "anthropic", "gemini"];

export interface RelayModelFormatLike {
  model?: string | null;
  provider?: string | null;
  supportedFormats?: string | null;
}

export interface RelayChannelAccessLike {
  id?: string | null;
  allowedFormats?: string | null;
  allowedModels?: string | null;
  status?: number | null;
}

export interface RelayTokenAccessLike {
  allowedModels?: string | null;
  channel?: RelayChannelAccessLike | null;
}

const normalizeModelName = (value?: string | null): string => {
  return typeof value === "string" ? value.trim() : "";
};

const formatListIncludes = (rawValue: string, requestFormat: RelayRequestFormat): boolean => {
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(requestFormat);
};

export const parseRelayRequestFormats = (allowedFormats?: string | null): RelayRequestFormat[] => {
  const normalizedFormats = typeof allowedFormats === "string" ? allowedFormats.trim() : "";
  if (!normalizedFormats || normalizedFormats === "all") return [...ALL_RELAY_REQUEST_FORMATS];

  const validFormats = new Set<RelayRequestFormat>(ALL_RELAY_REQUEST_FORMATS);
  return normalizedFormats
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is RelayRequestFormat => validFormats.has(item as RelayRequestFormat));
};

export const supportsRelayRequestFormat = (
  allowedFormats: string | null | undefined,
  requestFormat: RelayRequestFormat,
): boolean => {
  const normalizedFormats = typeof allowedFormats === "string" ? allowedFormats.trim() : "";
  if (!normalizedFormats || normalizedFormats === "all") return true;
  return formatListIncludes(normalizedFormats, requestFormat);
};

export const requireRelayChannelForFormat = (
  relayToken: RelayTokenAccessLike,
  requestFormat: RelayRequestFormat,
): RelayChannelAccessLike => {
  const channel = relayToken.channel;
  if (!channel)
    throw new ForbiddenError("No channel assigned to this relay token. Please assign a channel before using the API.");

  if (typeof channel.status === "number" && channel.status !== RELAY_CHANNEL_STATUS.ENABLED)
    throw new ForbiddenError("The assigned relay channel is disabled. Please contact an administrator.");

  const allowedFormats = channel.allowedFormats?.trim() || "all";
  if (!supportsRelayRequestFormat(allowedFormats, requestFormat))
    throw new BadRequestError(
      `Channel does not support ${requestFormat} format requests. Allowed formats: ${allowedFormats}`,
    );

  return channel;
};

export const parseRelayChannelAllowedModelNames = (
  channel: RelayChannelAccessLike,
  _modelCatalog: Array<Pick<RelayModelFormatLike, "model" | "provider">>,
): string[] | null => {
  if (!channel.allowedModels) return null;

  const allowedModelNames = parseAllowedModelsJson(channel.allowedModels);
  if (!allowedModelNames) {
    logger.warn("Invalid allowedModels in channel config, fallback to allow-all", {
      channelId: channel.id || undefined,
      source: "relay-model-availability",
    });
    return null;
  }

  // Return the model names directly (stored as model field)
  return allowedModelNames.map((item) => item.trim()).filter(Boolean);
};

export const parseRelayTokenAllowedModelIds = (allowedModels?: string | null): string[] => {
  if (!allowedModels) return [];

  return allowedModels
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const filterRelayModelsByFormat = <T extends RelayModelFormatLike>(
  modelCatalog: T[],
  requestFormat: RelayRequestFormat,
): T[] => {
  return modelCatalog.filter((model) => supportsRelayRequestFormat(model.supportedFormats, requestFormat));
};

export const getAccessibleRelayModelConfigsForToken = <T extends RelayModelFormatLike>(
  relayToken: RelayTokenAccessLike,
  modelCatalog: T[],
  requestFormat: RelayRequestFormat,
): T[] => {
  const channel = requireRelayChannelForFormat(relayToken, requestFormat);
  const formatScopedModels = filterRelayModelsByFormat(modelCatalog, requestFormat).filter(
    (model) => normalizeModelName(model.model).length > 0,
  );

  const channelAllowedModelNames = parseRelayChannelAllowedModelNames(channel, modelCatalog);
  const channelScopedModels =
    channelAllowedModelNames == null
      ? formatScopedModels
      : formatScopedModels.filter((model) => isModelNameAllowed(channelAllowedModelNames, model.model || ""));

  const dedupedChannelScopedModels = Array.from(
    new Map(
      channelScopedModels.map((model) => {
        const modelId = resolveModelId(model);
        return [modelId, model] as const;
      }),
    ).values(),
  );

  const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(relayToken.allowedModels);
  if (tokenAllowedModelIds.length === 0) return dedupedChannelScopedModels;

  return dedupedChannelScopedModels.filter((model) => isModelIdAllowed(tokenAllowedModelIds, model));
};

export const getAccessibleRelayModelNamesForToken = <T extends RelayModelFormatLike>(
  relayToken: RelayTokenAccessLike,
  modelCatalog: T[],
  requestFormat: RelayRequestFormat,
): string[] => {
  return getAccessibleRelayModelConfigsForToken(relayToken, modelCatalog, requestFormat).map((model) =>
    resolveModelId(model),
  );
};
