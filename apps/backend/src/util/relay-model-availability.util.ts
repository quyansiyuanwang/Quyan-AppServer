import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import logger from "@/util/logger";
import type { Prisma } from "@prisma/client";
import {
  ALL_RELAY_REQUEST_FORMATS,
  RELAY_REQUEST_FORMATS,
  isModelIdAllowed,
  isModelNameAllowed,
  parseRelayModelNameConstraint,
  parseRelayRequestFormats,
  parseRelayTokenAllowedModelIds,
  resolveModelId,
  supportsRelayRequestFormat,
  type RelayConfiguredRequestFormat,
  type RelayRequestFormat,
} from "@quyan/shared";

export {
  ALL_RELAY_REQUEST_FORMATS,
  parseRelayRequestFormats,
  parseRelayTokenAllowedModelIds,
  supportsRelayRequestFormat,
};
export type { RelayConfiguredRequestFormat, RelayRequestFormat };

export interface RelayModelFormatLike {
  model?: string | null;
  provider?: string | null;
  supportedFormats?: string | null;
}

export interface RelayChannelAccessLike {
  id?: string | null;
  channelType?: string | null;
  allowedFormats?: string | null;
  allowedModels?: string | null;
  status?: number | null;
  routingConfig?: Prisma.JsonValue | null;
  poolMembers?: Array<{
    enabled?: boolean | null;
    memberChannelId?: string | null;
    memberChannel?: RelayChannelAccessLike | null;
  }> | null;
}

export interface RelayTokenAccessLike {
  allowedModels?: string | null;
  channel?: RelayChannelAccessLike | null;
}

const normalizeModelName = (value?: string | null): string => {
  return typeof value === "string" ? value.trim() : "";
};

const getRoutingConfigAllowedModelsMode = (routingConfig: Prisma.JsonValue | null | undefined): string => {
  if (!routingConfig || typeof routingConfig !== "object" || Array.isArray(routingConfig)) return "";

  const rawMode = (routingConfig as Record<string, unknown>).allowedModelsMode;
  return typeof rawMode === "string" ? rawMode.trim() : "";
};

export const getRelayChannelAllowedModelsMode = (channel: RelayChannelAccessLike): "all" | "manual" | "auto" => {
  const rawMode = getRoutingConfigAllowedModelsMode(channel.routingConfig);

  if (["pooled", "automatic-proxy-pool"].includes(channel.channelType || "standalone") && rawMode === "auto")
    return "auto";
  if (rawMode === "manual") return "manual";
  if (rawMode === "all") return "all";
  return channel.allowedModels ? "manual" : "all";
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

  const allowedFormats = channel.allowedFormats?.trim() || RELAY_REQUEST_FORMATS.join(",");
  if (!supportsRelayRequestFormat(allowedFormats, requestFormat)) {
    const formatLabel =
      requestFormat === "openai-chat-completions"
        ? "openai format requests (openai-chat-completions format requests)"
        : `${requestFormat} format requests`;
    throw new BadRequestError(`Channel does not support ${formatLabel}. Allowed formats: ${allowedFormats}`);
  }

  return channel;
};

export const parseRelayChannelAllowedModelNames = (channel: RelayChannelAccessLike): string[] | null => {
  const allowedModelsMode = getRelayChannelAllowedModelsMode(channel);
  if (allowedModelsMode === "all") return null;
  // Pool auto mode must be resolved by RelayPoolResolverService. A raw channel
  // record cannot safely infer nested, disabled, or inherited restrictions.
  if (allowedModelsMode === "auto") return [];

  const constraint = parseRelayModelNameConstraint(channel.allowedModels);
  if (constraint.kind === "unrestricted") return [];
  if (constraint.kind === "malformed") {
    logger.warn("Invalid allowedModels in channel config, fallback to allow-all", {
      channelId: channel.id || undefined,
      source: "relay-model-availability",
    });
    return null;
  }

  // Return the model names directly (stored as model field)
  return constraint.values;
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

  const channelAllowedModelNames = parseRelayChannelAllowedModelNames(channel);
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
