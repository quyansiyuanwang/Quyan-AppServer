import type { Prisma, RelayChannel } from "@prisma/client";
import { parseRelayModelNameConstraint, resolveModelId, type RelayRequestFormat } from "@appserver/shared";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { BadRequestError } from "@/util/errors";
import logger from "@/util/logger";
import { parseRelayRequestFormats } from "@/util/relay-model-availability.util";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import type { RelayChannelStore } from "@/store/relay/relay-channel.store";

export interface RelayPoolMemberGraph {
  memberChannelId: string;
  priority: number;
  weight: Prisma.Decimal | number;
  enabled: boolean;
}

export type RelayPoolMemberOrderer = (
  pool: RelayChannel,
  members: RelayPoolMemberGraph[],
) => Promise<RelayPoolMemberGraph[]>;

export interface RelayChannelGraphNode extends RelayChannel {
  poolMembers: RelayPoolMemberGraph[];
}

interface EffectiveChannelConstraints {
  formats: Set<RelayRequestFormat>;
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
  supportedRequestFormats: RelayRequestFormat[];
  modelMapping: Record<string, string>;
}

/**
 * A resolved physical leaf paired with the logical channel selected by the
 * caller. Public history must use the display channel, never the leaf.
 */
export interface RelayResolvedChannelCandidate {
  resolvedChannel: RelayChannel;
  displayChannel: RelayChannel;
}

interface ResolvedLeafPath {
  channel: RelayChannelGraphNode;
  constraints: EffectiveChannelConstraints;
}

const ALL_FORMATS = new Set<RelayRequestFormat>(["openai", "anthropic", "gemini"]);

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
    return new Map(
      channels.map((channel) => [
        channel.id,
        {
          ...channel,
          poolMembers: Array.isArray((channel as RelayChannel & { poolMembers?: RelayPoolMemberGraph[] }).poolMembers)
            ? ((channel as RelayChannel & { poolMembers?: RelayPoolMemberGraph[] }).poolMembers ?? [])
            : [],
        },
      ]),
    );
  }

  private async resolveLeafPaths(
    channel: RelayChannelGraphNode,
    graph: ReadonlyMap<string, RelayChannelGraphNode>,
    inherited: EffectiveChannelConstraints,
    orderMembers: RelayPoolMemberOrderer | undefined,
    ancestors: Set<string>,
    includeDisabled = false,
  ): Promise<ResolvedLeafPath[]> {
    if (ancestors.has(channel.id)) throw new BadRequestError(`Relay channel pool cycle detected at '${channel.name}'`);

    const constraints = this.mergeConstraints(inherited, channel);
    if (!["pooled", "automatic-proxy-pool"].includes(channel.channelType || "standalone"))
      return [{ channel, constraints }];

    const nextAncestors = new Set(ancestors).add(channel.id);
    const enabledMembers = channel.poolMembers.filter(
      (member) => member.enabled !== false && graph.has(member.memberChannelId),
    );
    const orderedMembers = orderMembers
      ? await orderMembers(channel, enabledMembers)
      : [...enabledMembers].sort((left, right) => left.priority - right.priority);
    const leaves: ResolvedLeafPath[] = [];

    for (const member of orderedMembers) {
      const memberChannel = graph.get(member.memberChannelId);
      if (!memberChannel || (!includeDisabled && memberChannel.status !== RELAY_CHANNEL_STATUS.ENABLED)) continue;
      leaves.push(
        ...(await this.resolveLeafPaths(
          memberChannel,
          graph,
          constraints,
          orderMembers,
          nextAncestors,
          includeDisabled,
        )),
      );
    }

    return leaves;
  }

  private initialConstraints(): EffectiveChannelConstraints {
    return { formats: new Set(ALL_FORMATS), allowedModelNames: null, modelMapping: {} };
  }

  private mergeConstraints(inherited: EffectiveChannelConstraints, channel: RelayChannel): EffectiveChannelConstraints {
    const channelFormats = new Set(parseRelayRequestFormats(channel.allowedFormats));
    const formats = new Set([...inherited.formats].filter((format) => channelFormats.has(format)));
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
      allowedFormats:
        constraints.formats.size === ALL_FORMATS.size
          ? "all"
          : constraints.formats.size === 0
            ? "none"
            : [...constraints.formats].join(","),
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

  private sortFormats(formats: RelayRequestFormat[]): RelayRequestFormat[] {
    return [...formats].sort(
      (left, right) => ALL_RELAY_FORMAT_ORDER.indexOf(left) - ALL_RELAY_FORMAT_ORDER.indexOf(right),
    );
  }
}

const ALL_RELAY_FORMAT_ORDER: RelayRequestFormat[] = ["openai", "anthropic", "gemini"];
