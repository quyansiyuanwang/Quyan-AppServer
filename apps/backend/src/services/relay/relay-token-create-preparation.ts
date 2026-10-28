import type { CreateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import type { RelayTokenCreateInput } from "@/store/relay/relay-token.store";
import { DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG } from "@/util/anthropic-token-normalizer.util";
import type { RelayTokenUpdatePreparation } from "./relay-token-update-preparation";

export type RelayTokenCreatePreparation = RelayTokenUpdatePreparation & {
  generatedCredential: () => string | Promise<string>;
};

/** Build the existing create semantics; admission, locks, persistence and projection belong to the caller. */
export async function prepareRelayTokenCreate(
  userId: string,
  data: CreateRelayTokenDto,
  prepare: RelayTokenCreatePreparation,
): Promise<{ create: RelayTokenCreateInput; requiresGraphLock: boolean }> {
  const automaticPoolId = data.routingMode === "automatic-pool" ? data.automaticProxyPoolChannelId : undefined;
  const blockedAutomaticProxyPoolChannelIds = automaticPoolId
    ? await prepare.automaticPool(automaticPoolId, data.blockedAutomaticProxyPoolChannelIds)
    : [];
  const normalizedConfig =
    data.routingMode === "composite" || automaticPoolId
      ? { defaultChannelId: undefined, channelConfigs: [] }
      : await prepare.orderedChannels(data.channelId, data.channelConfigs);
  const token = data.token ? await prepare.customCredential(data.token) : await prepare.generatedCredential();
  return {
    requiresGraphLock: data.routingMode === "composite",
    create: {
      userId,
      name: data.name?.trim() || undefined,
      token,
      isCustomKey: Boolean(data.token),
      expiresAt: prepare.expiresAt(data.expiresAt) ?? undefined,
      channelId: normalizedConfig.defaultChannelId,
      routingMode: data.routingMode === "composite" ? "composite" : automaticPoolId ? "automatic-pool" : "ordered",
      memberTokenConfigs: data.memberTokenConfigs,
      streamConfig: data.streamConfig,
      automaticProxyPoolChannelId: automaticPoolId,
      blockedAutomaticProxyPoolChannelIds,
      channelConfigs: normalizedConfig.channelConfigs,
      failoverConfig:
        data.failoverConfig ??
        (data.routingMode === "composite"
          ? prepare.compositeFailover(data.memberTokenConfigs?.length ?? 0)
          : undefined),
      quotaLimit: data.quotaLimit ?? undefined,
      quotaWindows: prepare.quotaWindows(data.quotaWindows),
      allowedModels: data.allowedModels?.trim() || undefined,
      requestFormatTransforms: prepare.requestFormatTransforms(data.requestFormatTransforms),
      normalizerConfig: data.normalizerConfig
        ? prepare.normalizerConfig(data.normalizerConfig)
        : structuredClone(DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG),
      contentSafetyConfig: data.contentSafetyConfig ?? undefined,
      ipWhitelist: prepare.ipWhitelist(data.ipWhitelist),
      modelMapping: data.modelMapping ?? undefined,
    },
  };
}
