import type { RelayToken, Prisma } from "@prisma/client";
import type { UpdateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import type { RelayTokenUpdateInput } from "@/store/relay/relay-token.store";
import { compositionError } from "@/util/relay/relay-composition.util";
import { BadRequestError } from "@/util/errors";
import { validateRelayTokenModelMappingRules } from "@quyan/shared";
import type { RelayTokenRoutingSource } from "@/store/relay/relay-token-update-admission.repository";
import type { RelayTokenUpdateAdmissionRepository } from "@/store/relay/relay-token-update-admission.repository";
import type { RelayPoolResolverService } from "./relay-pool-resolver.service";

/** Scope checks reuse lifecycle admission; preview permissions are never requested. */
export async function validateRelayTokenSavedModelMappingScope(
  source: RelayTokenRoutingSource,
  update: RelayTokenUpdateInput,
  tx?: Prisma.TransactionClient,
  admitChannels?: (ids: readonly string[]) => Promise<readonly string[]>,
  dependencies?: {
    repository: Pick<RelayTokenUpdateAdmissionRepository, "mappingScopeSnapshot">;
    pools: Pick<RelayPoolResolverService, "resolveCapabilityLeafCandidates">;
  },
): Promise<string | undefined> {
  const rules = update.modelMappingRules === undefined ? source.modelMappingRules : update.modelMappingRules;
  if (
    !Array.isArray(rules) ||
    !rules.some(
      (rule) =>
        rule &&
        typeof rule === "object" &&
        "channelIds" in rule &&
        Array.isArray(rule.channelIds) &&
        rule.channelIds.length,
    )
  )
    return;
  const { validateRelayTokenModelMappingScopes } = await import("./relay-token-model-mapping.service");
  const repository =
    dependencies?.repository ??
    (
      await import("@/store/relay/relay-token-update-admission.repository")
    ).RelayTokenUpdateAdmissionRepository.getInstance();
  const pools =
    dependencies?.pools ?? (await import("./relay-pool-resolver.service")).RelayPoolResolverService.getInstance();
  const snapshot = await repository.mappingScopeSnapshot(source, update, tx, admitChannels);
  const byId = new Map(snapshot.tokens.map((token) => [token.id, token]));
  const reachable = new Set<string>();
  const visit = async (id: string, blocked: ReadonlySet<string>, ancestors: ReadonlySet<string>): Promise<void> => {
    if (ancestors.has(id)) throw compositionError("cycle");
    const token = byId.get(id);
    if (!token || token.status !== 1 || (token.expiresAt && token.expiresAt.getTime() <= Date.now())) return;
    const next = new Set(ancestors).add(id);
    const excluded = new Set([
      ...blocked,
      ...(Array.isArray(token.blockedAutomaticProxyPoolChannelIds)
        ? token.blockedAutomaticProxyPoolChannelIds.filter((value): value is string => typeof value === "string")
        : []),
    ]);
    if (token.routingMode === "composite") {
      for (const member of token.memberTokenConfigs) if (member.enabled) await visit(member.tokenId, excluded, next);
      return;
    }
    const roots =
      token.routingMode === "automatic-pool"
        ? token.automaticProxyPoolChannelId
          ? [token.automaticProxyPoolChannelId]
          : []
        : token.channelConfigs.length
          ? token.channelConfigs.map((row) => row.channelId)
          : token.channelId
            ? [token.channelId]
            : [];
    for (const path of await pools.resolveCapabilityLeafCandidates(roots, snapshot.channels.graph)) {
      if (path.routingChannelIds.some((channelId) => excluded.has(channelId))) continue;
      for (const channelId of path.routingChannelIds) {
        const channel = snapshot.channels.graph.get(channelId);
        if (channel && ["standalone", "pooled", "automatic-proxy-pool"].includes(channel.channelType))
          reachable.add(channelId);
      }
    }
  };
  await visit(source.id, new Set(), new Set());
  validateRelayTokenModelMappingScopes(rules, reachable);
  return JSON.stringify({ members: snapshot.tokens.slice(1), channels: snapshot.channels.sources });
}
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
export type RelayTokenUpdateSource = Pick<RelayToken, "routingMode" | "channelId"> &
  Partial<Pick<RelayToken, "modelMappingRules">>;

/** Explicit clearing removes both representations; omission leaves both untouched. */
export function prepareRelayTokenModelMapping(
  data: Pick<UpdateRelayTokenDto, "modelMapping" | "modelMappingRules">,
  source?: Pick<RelayTokenUpdateSource, "modelMappingRules">,
): Pick<RelayTokenUpdateInput, "modelMapping" | "modelMappingRules"> {
  const hasLegacy = data.modelMapping !== undefined;
  const hasRules = data.modelMappingRules !== undefined;
  if (hasLegacy && hasRules)
    throw new BadRequestError("Token model mapping representations are mutually exclusive", undefined, {
      messageKey: "relayToken.modelMappingMutuallyExclusive",
    });
  if (hasRules) {
    if (data.modelMappingRules !== null && validateRelayTokenModelMappingRules(data.modelMappingRules).length)
      throw new BadRequestError("Invalid token model mapping rules", undefined, {
        messageKey: "relayToken.modelMappingRulesInvalid",
      });
    return { modelMapping: null, modelMappingRules: data.modelMappingRules?.length ? data.modelMappingRules : null };
  }
  if (hasLegacy) {
    if (data.modelMapping !== null && Array.isArray(source?.modelMappingRules) && source.modelMappingRules.length)
      throw new BadRequestError("Legacy mapping cannot overwrite saved token mapping rules", undefined, {
        messageKey: "relayToken.modelMappingRulesLegacyOverwrite",
      });
    return { modelMapping: data.modelMapping ?? null, modelMappingRules: null };
  }
  return {};
}
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
  const modelMapping = prepareRelayTokenModelMapping(data, source);
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
      ...modelMapping,
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
