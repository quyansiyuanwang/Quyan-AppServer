import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { relayCompositionPreviewBodySchema } from "@/api/schema/relay/relay.schema";
import { BadRequestError } from "@/util/errors";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import type {
  RelayCompositionPreviewDto,
  RelayCompositionPreviewRequest,
  RelayTokenAvailableModelsDto,
} from "@/api/dto/relay/relay.dto";
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

const PREVIEW_DISPLAY_ROOT_ID = "__composition_preview__";
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
        return (await this.catalog(id, userId, targets, tokens, tokens, evaluatedAt)).models;
      },
      legacy,
    );
  }
  async preview(
    actorUserId: string,
    input: RelayCompositionPreviewRequest,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayCompositionPreviewDto>,
  ): Promise<RelayCompositionPreviewDto> {
    const parsed = relayCompositionPreviewBodySchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.routingMode !== "composite" ||
      parsed.data.editingTokenId === PREVIEW_DISPLAY_ROOT_ID ||
      [
        parsed.data.editingTokenId,
        parsed.data.targetUserId,
        ...parsed.data.memberTokenConfigs!.map((edge) => edge.tokenId),
      ].some((id) => id !== undefined && !isRelayTokenResourceId(id))
    )
      throw new BadRequestError("Invalid composition preview", undefined, { messageKey: "errors.badRequest" });
    const data = parsed.data;
    // New previews use a server-generated nonpersistent identity; clients cannot replace an existing node.
    const rootId = data.editingTokenId ?? "preview_" + randomUUID();
    const ids = [
      ...new Set([
        ...(data.editingTokenId ? [data.editingTokenId] : []),
        ...data.memberTokenConfigs!.map((edge) => edge.tokenId),
      ]),
    ];
    return this.inspection.preview(
      actorUserId,
      ids,
      data.targetUserId,
      request,
      async (initial, userId, admit) => {
        const evaluatedAt = Date.now(),
          timestamp = new Date(0);
        const virtual: RelayTokenCapabilitySnapshot = {
          id: rootId,
          userId,
          status: 1,
          createTime: timestamp,
          updateTime: timestamp,
          routingMode: "composite",
          expiresAt: data.expiresAt ?? null,
          allowedModels: data.allowedModels ?? null,
          modelMapping: data.modelMapping ?? null,
          requestFormatTransforms: (data.requestFormatTransforms ?? null) as Prisma.JsonValue,
          memberTokenConfigs: data.memberTokenConfigs!.map((edge, index) => ({
            ...edge,
            id: "preview_edge_" + index,
            status: 1,
            updateTime: timestamp,
          })),
          channelId: null,
          automaticProxyPoolChannelId: null,
          blockedAutomaticProxyPoolChannelIds: null,
          channelConfigs: [],
          failoverConfig:
            data.failoverConfig?.maxAcceptedChannelMultiplier != null
              ? {
                  maxAcceptedChannelMultiplier: new Prisma.Decimal(data.failoverConfig.maxAcceptedChannelMultiplier),
                  updateTime: timestamp,
                }
              : null,
        };
        const { targets, tokens: sources } = await this.subtree(userId, initial, admit, virtual);
        const tokens = [...sources.filter((token) => token.id !== rootId), virtual];
        const result = await this.catalog(rootId, userId, targets, sources, tokens, evaluatedAt);
        // Preserve the public placeholder for an unsaved entry, never expose an invented real Token ID.
        if (!data.editingTokenId) for (const route of result.routes) route.tokenPathIds[0] = PREVIEW_DISPLAY_ROOT_ID;
        return result;
      },
      legacy,
    );
  }
  private async catalog(
    id: string,
    userId: string,
    targets: RelayTokenInspectionTarget[],
    sources: RelayTokenCapabilitySnapshot[],
    tokens: RelayTokenCapabilitySnapshot[],
    evaluatedAt: number,
  ): Promise<RelayCompositionPreviewDto> {
    validateRelayComposition(tokens);
    const graph = new Map(tokens.map((token) => [token.id, token]));
    const rootIds = [...new Set(tokens.filter((token) => token.routingMode !== "composite").flatMap(rootsFor))].sort();
    const channels = await this.repository.channels(rootIds),
      catalog = await this.repository.catalog();
    const proof = JSON.stringify([sources, channels.sources, catalog]);
    const modelMap: RelayTokenAvailableModelsDto = { openai: [], responses: [], anthropic: [], gemini: [] };
    const routes: RelayCompositionPreviewDto["routes"] = [];
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
              token.routingMode === "automatic-pool" || channels.graph.get(id)?.channelType !== "automatic-proxy-pool",
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
            paths.some((path) => canServeRelayDiscoveryModel(effective, path.resolvedChannel, catalog, format, model)),
          );
        },
      });
      routes.push(...entries.map((entry) => ({ ...entry, protocol })));
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
    return { models: modelMap, routes };
  }
  private async subtree(
    userId: string,
    initial: RelayTokenInspectionTarget[],
    admit: RelayTokenInspectionAdmission,
    replacement?: RelayTokenCapabilitySnapshot,
  ) {
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
      for (const source of rows) {
        const row = source.id === replacement?.id ? replacement : source;
        if (row.routingMode === "composite")
          for (const edge of row.memberTokenConfigs) {
            if (edge.status !== 1) throw iamAccountDenied();
            if (!targets.has(edge.tokenId)) next.add(edge.tokenId);
          }
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
