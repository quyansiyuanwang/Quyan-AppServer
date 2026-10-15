import type { RelayTokenAvailableModelsDto } from "@/api/dto/relay/relay.dto";
import {
  RelayTokenCapabilityRepository,
  type RelayTokenCapabilitySnapshot,
} from "@/store/relay/relay-token-capability.repository";
import type { RelayTokenInspectionTarget } from "@/store/relay/relay-token-inspection.repository";
import {
  RelayTokenInspectionIamService,
  type RelayTokenInspectionAdmission,
} from "./relay-token-inspection-iam.service";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import {
  projectRelayAvailableModels,
  canServeRelayDiscoveryModel,
  relayDiscoveryAllowsModels,
} from "./utils/relay-model-discovery.util";
import { projectRelayCompositionCatalog } from "./utils/relay-composition-catalog.util";
import { resolveRelayRequestFormatTransform } from "./relay-request-format-transform.service";
import { RELAY_COMPOSITION_POLICY, validateRelayComposition } from "@/util/relay/relay-composition.util";
import type { TypedRequest } from "@/types/express";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";
import { iamAccountDenied } from "@/store/users/iam-account-principal";

const MODEL_PROTOCOLS = [
  ["openai", "openai-chat-completions"],
  ["responses", "openai-responses"],
  ["anthropic", "anthropic"],
  ["gemini", "gemini"],
] as const;
const rootsFor = (token: RelayTokenCapabilitySnapshot) =>
  token.routingMode === "automatic-pool"
    ? token.automaticProxyPoolChannelId
      ? [token.automaticProxyPoolChannelId]
      : []
    : token.channelConfigs.length
      ? token.channelConfigs.map((edge) => edge.channelId)
      : token.channelId
        ? [token.channelId]
        : [];
export class RelayTokenCapabilityReadService {
  private static instance: RelayTokenCapabilityReadService;
  static getInstance() {
    return (this.instance ??= new RelayTokenCapabilityReadService());
  }
  constructor(
    private readonly inspection = RelayTokenInspectionIamService.getInstance(),
    private readonly repository = RelayTokenCapabilityRepository.getInstance(),
    private readonly pools = RelayPoolResolverService.getInstance(),
  ) {}
  async models(
    actorUserId: string,
    id: string,
    targetUserId: string | undefined,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayTokenAvailableModelsDto>,
  ): Promise<RelayTokenAvailableModelsDto> {
    return this.inspection.models(
      actorUserId,
      id,
      targetUserId,
      request,
      async (initial, userId, admit) => {
        const evaluatedAt = Date.now();
        const { targets, tokens } = await this.subtree(userId, initial, admit);
        validateRelayComposition(tokens);
        const graph = new Map(tokens.map((token) => [token.id, token]));
        const rootIds = [
          ...new Set(tokens.filter((token) => token.routingMode !== "composite").flatMap(rootsFor)),
        ].sort();
        const channels = await this.repository.channels(rootIds),
          catalog = await this.repository.catalog();
        const proof = JSON.stringify([tokens, channels.sources, catalog]);
        const modelMap: RelayTokenAvailableModelsDto = { openai: [], responses: [], anthropic: [], gemini: [] };
        for (const [protocol, format] of MODEL_PROTOCOLS) {
          const entries = await projectRelayCompositionCatalog(id, format, graph, {
            allows: async (token, ...names) => relayDiscoveryAllowsModels(token, catalog, ...names),
            leaf: async (token, sourceFormat, requested, ancestors) => {
              const format =
                resolveRelayRequestFormatTransform(
                  token.requestFormatTransforms,
                  sourceFormat as RelayConvertibleRequestFormat,
                )?.targetFormat ?? sourceFormat;
              const blocked = new Set(
                Array.isArray(token.blockedAutomaticProxyPoolChannelIds)
                  ? token.blockedAutomaticProxyPoolChannelIds.filter((value) => typeof value === "string")
                  : [],
              );
              const roots = rootsFor(token).filter(
                (id) =>
                  token.routingMode === "automatic-pool" ||
                  channels.graph.get(id)?.channelType !== "automatic-proxy-pool",
              );
              const paths = (await this.pools.resolveCapabilityLeafCandidates(roots, channels.graph)).filter(
                (path) => !path.routingChannelIds.some((id) => blocked.has(id)),
              );
              const limits = [...ancestors, token]
                .map((node) => node.failoverConfig?.maxAcceptedChannelMultiplier)
                .filter((value) => value != null)
                .map(Number);
              const effective = {
                ...token,
                failoverConfig: limits.length ? { maxAcceptedChannelMultiplier: Math.min(...limits) } : null,
              };
              const candidates = new Set([
                ...projectRelayAvailableModels(
                  token,
                  paths.map((path) => path.resolvedChannel),
                  catalog,
                  format,
                ),
                ...requested,
                ...Object.keys((token.modelMapping as Record<string, string>) ?? {}).filter((key) => !/[?*]/.test(key)),
              ]);
              return [...candidates].filter((model) =>
                paths.some((path) =>
                  canServeRelayDiscoveryModel(effective, path.resolvedChannel, catalog, format, model),
                ),
              );
            },
          });
          modelMap[protocol] = [...new Set(entries.map((entry) => entry.model))].sort();
        }
        if (
          JSON.stringify([
            await this.repository.tokens(userId, targets),
            (await this.repository.channels(rootIds)).sources,
            await this.repository.catalog(),
          ]) !== proof ||
          tokens.some(
            (token) =>
              token.expiresAt && token.expiresAt.getTime() > evaluatedAt && token.expiresAt.getTime() <= Date.now(),
          )
        )
          throw iamAccountDenied();
        return modelMap;
      },
      legacy,
    );
  }
  private async subtree(userId: string, initial: RelayTokenInspectionTarget[], admit: RelayTokenInspectionAdmission) {
    const targets = new Map<string, RelayTokenInspectionTarget>();
    const tokens = new Map<string, RelayTokenCapabilitySnapshot>();
    let frontier = initial;
    for (let depth = 0; frontier.length; depth++) {
      if (
        depth > RELAY_COMPOSITION_POLICY.maxDepth ||
        targets.size + frontier.length > 1 + RELAY_COMPOSITION_POLICY.maxLeafPaths * RELAY_COMPOSITION_POLICY.maxDepth
      )
        throw iamAccountDenied();
      frontier.forEach((row) => targets.set(row.id, row));
      const rows = await this.repository.tokens(userId, frontier);
      rows.forEach((row) => tokens.set(row.id, row));
      const next = new Set<string>();
      for (const row of rows)
        if (row.routingMode === "composite")
          for (const edge of row.memberTokenConfigs) {
            if (edge.status !== 1) throw iamAccountDenied();
            if (!targets.has(edge.tokenId)) next.add(edge.tokenId);
          }
      // Authorization precedes capability hydration, including disabled references.
      frontier = await admit([...next].sort());
    }
    return {
      targets: [...targets.values()].sort((a, b) => a.id.localeCompare(b.id)),
      tokens: [...tokens.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
}
