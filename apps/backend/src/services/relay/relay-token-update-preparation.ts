import type { RelayToken } from "@prisma/client";
import type { UpdateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import type { RelayTokenUpdateInput } from "@/store/relay/relay-token.store";
import { compositionError } from "@/util/relay/relay-composition.util";
/** Preparation only: callbacks must retain their authorization, visibility and business-limit checks. */
export interface RelayTokenUpdatePreparation {
  orderedChannels: (
    channelId: string | undefined,
    configs: UpdateRelayTokenDto["channelConfigs"],
  ) => Promise<{
    defaultChannelId: string;
    channelConfigs: NonNullable<RelayTokenUpdateInput["channelConfigs"]>;
  }>;
  automaticPool: (channelId: string, blockedIds: string[] | undefined) => Promise<string[]>;
  customCredential: (preferred: string) => Promise<string>;
  expiresAt: (value: UpdateRelayTokenDto["expiresAt"]) => Date | null | undefined;
  quotaWindows: (value: UpdateRelayTokenDto["quotaWindows"]) => NonNullable<RelayTokenUpdateInput["quotaWindows"]>;
  ipWhitelist: (value: UpdateRelayTokenDto["ipWhitelist"]) => RelayTokenUpdateInput["ipWhitelist"];
  requestFormatTransforms: (
    value: UpdateRelayTokenDto["requestFormatTransforms"],
  ) => RelayTokenUpdateInput["requestFormatTransforms"];
  normalizerConfig: (value: UpdateRelayTokenDto["normalizerConfig"]) => RelayTokenUpdateInput["normalizerConfig"];
  compositeFailover: (memberCount: number) => NonNullable<RelayTokenUpdateInput["failoverConfig"]>;
}
export type RelayTokenUpdateSource = Pick<RelayToken, "routingMode" | "channelId">;
/** Preserve omission versus explicit clearing across both legacy and native IAM write paths. */
export async function prepareRelayTokenUpdate(
  source: RelayTokenUpdateSource,
  data: UpdateRelayTokenDto,
  prepare: RelayTokenUpdatePreparation,
): Promise<{ update: RelayTokenUpdateInput; requiresGraphLock: boolean }> {
  const has = (key: keyof UpdateRelayTokenDto) => Object.prototype.hasOwnProperty.call(data, key);
  const hasAutomaticMode = data.routingMode === "automatic-pool";
  const automaticPoolId = hasAutomaticMode ? data.automaticProxyPoolChannelId : undefined;
  const blockedAutomaticProxyPoolChannelIds = automaticPoolId
    ? await prepare.automaticPool(automaticPoolId, data.blockedAutomaticProxyPoolChannelIds)
    : data.routingMode === "ordered"
      ? []
      : undefined;
  const hasCompositeMode = (data.routingMode ?? source.routingMode) === "composite";
  if (!hasCompositeMode && data.memberTokenConfigs?.length) throw compositionError("mode");
  if (hasCompositeMode && (data.channelId || data.channelConfigs?.length || data.automaticProxyPoolChannelId))
    throw compositionError("mode");
  const hasRoutingUpdate = data.routingMode !== undefined || has("channelId") || has("channelConfigs");
  // Existing composites are immutable through this endpoint; creation and preview have their own workflows.
  if (source.routingMode === "composite") throw compositionError("mode");
  const normalizedConfig =
    hasCompositeMode || hasAutomaticMode
      ? { defaultChannelId: null, channelConfigs: [] }
      : hasRoutingUpdate
        ? await prepare.orderedChannels(data.channelId ?? source.channelId ?? undefined, data.channelConfigs)
        : null;
  const tokenValue = has("token") && data.token ? await prepare.customCredential(data.token) : undefined;
  return {
    requiresGraphLock: source.routingMode === "composite" || hasCompositeMode,
    update: {
      name: has("name") ? data.name?.trim() || null : undefined,
      ...(has("token")
        ? {
            token: tokenValue,
            legacyToken: data.token && data.token !== tokenValue ? data.token : null,
            isCustomKey: data.token ? true : undefined,
          }
        : {}),
      expiresAt: has("expiresAt") ? (prepare.expiresAt(data.expiresAt) ?? null) : undefined,
      quotaLimit: has("quotaLimit") ? (data.quotaLimit ?? null) : undefined,
      quotaWindows: has("quotaWindows") ? prepare.quotaWindows(data.quotaWindows) : undefined,
      allowedModels: has("allowedModels") ? data.allowedModels?.trim() || null : undefined,
      ipWhitelist: has("ipWhitelist") ? prepare.ipWhitelist(data.ipWhitelist) : undefined,
      modelMapping: has("modelMapping") ? (data.modelMapping ?? null) : undefined,
      requestFormatTransforms: has("requestFormatTransforms")
        ? prepare.requestFormatTransforms(data.requestFormatTransforms)
        : undefined,
      normalizerConfig: has("normalizerConfig") ? prepare.normalizerConfig(data.normalizerConfig) : undefined,
      contentSafetyConfig: has("contentSafetyConfig") ? (data.contentSafetyConfig ?? null) : undefined,
      channelId: normalizedConfig?.defaultChannelId,
      channelConfigs: normalizedConfig?.channelConfigs,
      routingMode: data.routingMode,
      memberTokenConfigs: data.memberTokenConfigs,
      streamConfig: data.streamConfig,
      automaticProxyPoolChannelId: hasAutomaticMode
        ? automaticPoolId
        : data.routingMode === "ordered" || hasCompositeMode
          ? null
          : undefined,
      blockedAutomaticProxyPoolChannelIds,
      failoverConfig:
        data.failoverConfig ??
        (hasCompositeMode && source.routingMode !== "composite"
          ? prepare.compositeFailover(data.memberTokenConfigs?.length ?? 0)
          : undefined),
    },
  };
}
