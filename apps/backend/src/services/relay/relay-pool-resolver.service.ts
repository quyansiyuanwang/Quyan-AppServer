import type { Prisma, RelayChannel } from "@prisma/client";
import { parseRelayModelNameConstraint, resolveModelId, type RelayConfiguredRequestFormat } from "@appserver/shared";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { BadRequestError } from "@/util/errors";
import logger from "@/util/logger";
import { parseRelayRequestFormats } from "@/util/relay-model-availability.util";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import type { RelayChannelStore } from "@/store/relay/relay-channel.store";
import { resolveEffectiveRelayPoolMembers } from "./relay-pool-members.util";

export interface RelayPoolMemberGraph {
  memberChannelId: string;
  priority: number;
  weight: Prisma.Decimal | number;
  enabled: boolean;
  memberChannel?: RelayChannel | null;
}

export interface RelayPoolMemberOrderContext {
  /** An automatic proxy pool is an ancestor, so every eligible leaf must remain reachable. */
  expandAllEligibleMembers: boolean;
}

export type RelayPoolMemberOrderer = (
  pool: RelayChannel,
  members: RelayPoolMemberGraph[],
  context: RelayPoolMemberOrderContext,
) => Promise<RelayPoolMemberGraph[]>;

export interface RelayChannelGraphNode extends RelayChannel {
  poolMembers: RelayPoolMemberGraph[];
}

interface EffectiveChannelConstraints {
  formats: Set<RelayConfiguredRequestFormat>;
  allowedModelNames: string[] | null;
  modelMapping: Record<string, string>;
}

export interface RelayModelCatalogEntry {
  model?: string | null;
  provider?: string | null;
  supportedFormats?: string | null;
}

export interface RelayPoolResolverContext<TModel extends RelayModelCatalogEntry = RelayModelCatalogEntry> {
  graph: ReadonlyMap<string, RelayChannelGraphNode>;
  modelCatalog: readonly TModel[];
  includeDisabled?: boolean;
}

export interface RelayPoolResolverOptions {
  includeDisabled?: boolean;
}

export interface RelayChannelModelCapability {
  leafChannelId: string;
  catalogModelName: string;
  requestModelId: string;
  supportedRequestFormats: RelayConfiguredRequestFormat[];
  modelMapping: Record<string, string>;
}

/**
 * A resolved physical leaf paired with the logical channel selected by the
 * caller. Public history must use the display channel, never the leaf.
 */
export interface RelayResolvedChannelCandidate {
  resolvedChannel: RelayChannel;
  /** Logical route root, retained for internal diagnostics. */
  displayChannel: RelayChannel;
  /** User-facing billable channel. For automatic pools this is the direct pooled parent. */
  billingChannel?: RelayChannel;
}

interface ResolvedLeafPath {
  channel: RelayChannelGraphNode;
  constraints: EffectiveChannelConstraints;
}

const ALL_FORMATS = new Set<RelayConfiguredRequestFormat>([
  "openai-chat-completions",
  "openai-responses",
  "anthropic",
  "gemini",
]);

export class RelayPoolResolverService {
  private static instance: RelayPoolResolverService;

  private constructor(
    private readonly relayChannelRepository: RelayChannelStore = RelayChannelRepository.getInstance(),
  ) {}

  static getInstance(): RelayPoolResolverService {
    if (!this.instance) this.instance = new RelayPoolResolverService();
    return this.instance;
  }

  async preloadContext<TModel extends RelayModelCatalogEntry>(
    modelCatalog: readonly TModel[],
    options: RelayPoolResolverOptions = {},
  ): Promise<RelayPoolResolverContext<TModel>> {
    return { graph: await this.getGraph(options), modelCatalog, includeDisabled: options.includeDisabled === true };
  }

  async resolveChannelCapabilities<TModel extends RelayModelCatalogEntry>(
    channelId: string,
    context: RelayPoolResolverContext<TModel>,
  ): Promise<RelayChannelModelCapability[]> {
    const channel = context.graph.get(channelId);
    if (!channel) return [];

    const paths = await this.resolveLeafPaths(
      channel,
      context.graph,
      this.initialConstraints(),
      undefined,
      new Set(),
      context.includeDisabled === true,
    );
    const capabilities = new Map<string, RelayChannelModelCapability>();

    for (const path of paths) {
      for (const model of context.modelCatalog) {
        const catalogModelName = model.model?.trim() || "";
        const requestModelId = resolveModelId(model);
        if (!catalogModelName || !requestModelId) continue;
        if (
          path.constraints.allowedModelNames !== null &&
          !path.constraints.allowedModelNames.includes(catalogModelName)
        )
          continue;

        const supportedRequestFormats = parseRelayRequestFormats(model.supportedFormats).filter((format) =>
          path.constraints.formats.has(format),
        );
        if (supportedRequestFormats.length === 0) continue;

        const key = `${path.channel.id}\u0000${catalogModelName}\u0000${requestModelId}`;
        const existing = capabilities.get(key);
        if (existing) {
          existing.supportedRequestFormats = this.sortFormats([
            ...new Set([...existing.supportedRequestFormats, ...supportedRequestFormats]),
          ]);
          continue;
        }

        capabilities.set(key, {
          leafChannelId: path.channel.id,
          catalogModelName,
          requestModelId,
          supportedRequestFormats: this.sortFormats(supportedRequestFormats),
          modelMapping: path.constraints.modelMapping,
        });
      }
    }

    return [...capabilities.values()].sort(
      (left, right) =>
        left.catalogModelName.localeCompare(right.catalogModelName) ||
        left.requestModelId.localeCompare(right.requestModelId) ||
        left.leafChannelId.localeCompare(right.leafChannelId),
    );
  }

  async resolveActiveLeaves(
    roots: Array<Pick<RelayChannel, "id"> | null | undefined>,
    orderMembers?: RelayPoolMemberOrderer,
  ): Promise<RelayChannel[]> {
    const candidates = await this.resolveActiveLeafCandidates(roots, orderMembers);
    const leaves = new Map<string, RelayChannel>();

    for (const candidate of candidates)
      leaves.set(this.getLeafConstraintSignature(candidate.resolvedChannel), candidate.resolvedChannel);

    return [...leaves.values()];
  }

  async resolveActiveLeafCandidates(
    roots: Array<Pick<RelayChannel, "id"> | null | undefined>,
    orderMembers?: RelayPoolMemberOrderer,
  ): Promise<RelayResolvedChannelCandidate[]> {
    const graph = await this.getGraph({});
    const candidates = new Map<string, RelayResolvedChannelCandidate>();

    for (const root of roots) {
      if (!root?.id) continue;
      const channel = graph.get(root.id);
      if (!channel) continue;
      const resolved = await this.resolveLeafPaths(channel, graph, this.initialConstraints(), orderMembers, new Set());
      for (const path of resolved) {
        const leaf = this.applyConstraints(path.channel, path.constraints);
        const signature = `${channel.id}\u0000${this.getLeafConstraintSignature(leaf)}`;
        candidates.set(signature, {
          resolvedChannel: leaf,
          displayChannel: channel,
          billingChannel:
            leaf.pooledParentId && graph.get(leaf.pooledParentId)?.channelType === "pooled"
              ? graph.get(leaf.pooledParentId)!
              : channel,
        });
      }
    }

    return [...candidates.values()];
  }

  async resolveEffectiveAllowedModels(
    channelId: string,
    modelCatalog: Array<{ model?: string | null; supportedFormats?: string | null }>,
    options: RelayPoolResolverOptions = {},
  ): Promise<string[]> {
    const context = await this.preloadContext(modelCatalog, options);
    const capabilities = await this.resolveChannelCapabilities(channelId, context);
    return [...new Set(capabilities.map((capability) => capability.catalogModelName))].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  /** @deprecated Use resolveEffectiveAllowedModels for final channel availability. */
  async inferAllowedModels(
    channelId: string,
    modelCatalog: Array<{ model?: string | null; supportedFormats?: string | null }>,
  ): Promise<string[]> {
    return this.resolveEffectiveAllowedModels(channelId, modelCatalog);
  }

  private async getGraph(options: RelayPoolResolverOptions): Promise<Map<string, RelayChannelGraphNode>> {
    const channels = options.includeDisabled
      ? await this.relayChannelRepository.listVisible()
      : await this.relayChannelRepository.listActive();
    const graph = new Map(
      channels.map((channel) => [channel.id, { ...channel, poolMembers: resolveEffectiveRelayPoolMembers(channel) }]),
    );

    // Pool relations only store member IDs. Hydrate the in-memory graph reference once so ordering
    // callbacks can use the same leaf multiplier and health configuration that routing will use.
    for (const channel of graph.values())
      channel.poolMembers = channel.poolMembers.map((member) => ({
        ...member,
        memberChannel: graph.get(member.memberChannelId) ?? null,
      }));
    return graph;
  }

  private async resolveLeafPaths(
    channel: RelayChannelGraphNode,
    graph: ReadonlyMap<string, RelayChannelGraphNode>,
    inherited: EffectiveChannelConstraints,
    orderMembers: RelayPoolMemberOrderer | undefined,
    ancestors: Set<string>,
    includeDisabled = false,
    expandAllEligibleMembers = false,
  ): Promise<ResolvedLeafPath[]> {
    if (ancestors.has(channel.id)) throw new BadRequestError(`Relay channel pool cycle detected at '${channel.name}'`);

    const constraints = this.mergeConstraints(inherited, channel);
    if (!["pooled", "automatic-proxy-pool"].includes(channel.channelType || "standalone"))
      return [{ channel, constraints }];

    const nextAncestors = new Set(ancestors).add(channel.id);
    const enabledMembers = channel.poolMembers.filter(
      (member) => member.enabled !== false && graph.has(member.memberChannelId),
    );
    const childPathsMustRemainReachable = expandAllEligibleMembers || channel.channelType === "automatic-proxy-pool";
    const orderedMembers = orderMembers
      ? await orderMembers(channel, enabledMembers, {
          expandAllEligibleMembers: childPathsMustRemainReachable,
        })
      : [...enabledMembers].sort((left, right) => left.priority - right.priority);
    const leaves: ResolvedLeafPath[] = [];

    for (const member of orderedMembers) {
      const memberChannel = graph.get(member.memberChannelId);
      if (
        !memberChannel ||
        (!includeDisabled &&
          (memberChannel.status !== RELAY_CHANNEL_STATUS.ENABLED || memberChannel.providerServiceEnabled === false))
      )
        continue;
      leaves.push(
        ...(await this.resolveLeafPaths(
          memberChannel,
          graph,
          constraints,
          orderMembers,
          nextAncestors,
          includeDisabled,
          childPathsMustRemainReachable,
        )),
      );
    }

    return leaves;
  }

  private initialConstraints(): EffectiveChannelConstraints {
    return { formats: new Set(ALL_FORMATS), allowedModelNames: null, modelMapping: {} };
  }

  private mergeConstraints(inherited: EffectiveChannelConstraints, channel: RelayChannel): EffectiveChannelConstraints {
    const isPool = ["pooled", "automatic-proxy-pool"].includes(channel.channelType || "standalone");
    const configuredFormats = channel.allowedFormats?.trim().toLowerCase() ?? "";
    // Logical pools do not have an upstream of their own. Empty, `none`, and
    // the former synthetic pool default mean "derive from members"; applying
    // either to every leaf would make the route deny all requests or hide
    // valid OpenAI Responses capabilities. Explicit non-default pool
    // restrictions remain supported for existing configurations.
    const shouldDerivePoolFormats =
      isPool && ["", "none", "openai-chat-completions,anthropic,gemini"].includes(configuredFormats);
    const channelFormats = shouldDerivePoolFormats
      ? new Set(ALL_FORMATS)
      : new Set(parseRelayRequestFormats(channel.allowedFormats));
    const formats = new Set([...inherited.formats].filter((format) => channelFormats.has(format)));
    // A physical pooled member is still the execution leaf. Its model
    // whitelist and mapping are therefore part of the effective capability;
    // otherwise `/v1/models` advertises models that the selected upstream
    // cannot serve and routing loses the member's model alias.
    const ownAllowedModelNames = this.getManualAllowedModelNames(channel);

    return {
      formats,
      allowedModelNames: this.intersectAllowedModelNames(inherited.allowedModelNames, ownAllowedModelNames),
      modelMapping: {
        ...inherited.modelMapping,
        ...((channel.modelMapping as Record<string, string> | null) ?? {}),
      },
    };
  }

  private getManualAllowedModelNames(channel: RelayChannel): string[] | null {
    const routingConfig = channel.routingConfig as Record<string, unknown> | null;
    const mode = typeof routingConfig?.allowedModelsMode === "string" ? routingConfig.allowedModelsMode : "";
    const isManual = mode === "manual" || (mode !== "all" && mode !== "auto" && Boolean(channel.allowedModels));
    if (!isManual) return null;

    const constraint = parseRelayModelNameConstraint(channel.allowedModels);
    if (constraint.kind === "restricted") return constraint.values;
    if (constraint.kind === "malformed") {
      logger.warn("Invalid allowedModels in channel config, fallback to allow-all", {
        channelId: channel.id,
        source: "relay-pool-resolver",
      });
      return null;
    }

    return mode === "manual" ? [] : null;
  }

  private intersectAllowedModelNames(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right;
    if (right === null) return left;
    const rightSet = new Set(right);
    return left.filter((name) => rightSet.has(name));
  }

  private applyConstraints(channel: RelayChannel, constraints: EffectiveChannelConstraints): RelayChannel {
    const routingConfig = (channel.routingConfig as Record<string, unknown> | null) ?? {};
    return {
      ...channel,
      allowedFormats: constraints.formats.size === 0 ? "none" : [...constraints.formats].join(","),
      allowedModels: constraints.allowedModelNames === null ? null : JSON.stringify(constraints.allowedModelNames),
      modelMapping: constraints.modelMapping as Prisma.JsonObject,
      routingConfig: {
        ...routingConfig,
        allowedModelsMode: constraints.allowedModelNames === null ? "all" : "manual",
      } as Prisma.JsonObject,
    };
  }

  private getLeafConstraintSignature(channel: RelayChannel): string {
    const formats = this.sortFormats(parseRelayRequestFormats(channel.allowedFormats));
    const models = this.getManualAllowedModelNames(channel);
    const mapping = Object.entries((channel.modelMapping as Record<string, string> | null) ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return JSON.stringify([channel.id, formats, models, mapping]);
  }

  private sortFormats(formats: RelayConfiguredRequestFormat[]): RelayConfiguredRequestFormat[] {
    return [...formats].sort(
      (left, right) => ALL_RELAY_FORMAT_ORDER.indexOf(left) - ALL_RELAY_FORMAT_ORDER.indexOf(right),
    );
  }
}

const ALL_RELAY_FORMAT_ORDER: RelayConfiguredRequestFormat[] = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic",
  "gemini",
];
