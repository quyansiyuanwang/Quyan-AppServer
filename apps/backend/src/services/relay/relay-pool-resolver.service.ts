import type { Prisma, RelayChannel } from "@prisma/client";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { BadRequestError } from "@/util/errors";
import { parseAllowedModelsJson } from "@/util/model-resolution.util";
import { parseRelayRequestFormats, type RelayRequestFormat } from "@/util/relay-model-availability.util";
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

interface RelayChannelGraphNode extends RelayChannel {
  poolMembers: RelayPoolMemberGraph[];
}

interface EffectiveChannelConstraints {
  formats: Set<RelayRequestFormat>;
  allowedModelNames: string[] | null;
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

  async resolveActiveLeaves(
    roots: Array<Pick<RelayChannel, "id"> | null | undefined>,
    orderMembers?: RelayPoolMemberOrderer,
  ): Promise<RelayChannel[]> {
    const graph = await this.getActiveGraph();
    const leaves: RelayChannel[] = [];
    const seenLeaves = new Set<string>();

    for (const root of roots) {
      if (!root?.id) continue;
      const channel = graph.get(root.id);
      if (!channel) continue;
      const resolved = await this.resolveLeavesFromNode(
        channel,
        graph,
        this.initialConstraints(),
        orderMembers,
        new Set(),
      );
      for (const leaf of resolved) {
        if (seenLeaves.has(leaf.id)) continue;
        seenLeaves.add(leaf.id);
        leaves.push(leaf);
      }
    }

    return leaves;
  }

  async inferAllowedModels(
    channelId: string,
    modelCatalog: Array<{ model?: string | null; supportedFormats?: string | null }>,
  ): Promise<string[]> {
    const leaves = await this.resolveActiveLeaves([{ id: channelId }]);
    const inferred = new Set<string>();

    for (const channel of leaves) {
      const allowedNames = this.parseManualAllowedModelNames(channel);
      for (const model of modelCatalog) {
        const modelName = model.model?.trim() || "";
        if (!modelName) continue;
        if (!this.channelSupportsAnyModelFormat(channel, model.supportedFormats)) continue;
        if (allowedNames !== null && !allowedNames.includes(modelName)) continue;
        inferred.add(modelName);
      }
    }

    return [...inferred].sort((left, right) => left.localeCompare(right));
  }

  private async getActiveGraph(): Promise<Map<string, RelayChannelGraphNode>> {
    const channels = await this.relayChannelRepository.listActive();
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

  private async resolveLeavesFromNode(
    channel: RelayChannelGraphNode,
    graph: Map<string, RelayChannelGraphNode>,
    inherited: EffectiveChannelConstraints,
    orderMembers: RelayPoolMemberOrderer | undefined,
    ancestors: Set<string>,
  ): Promise<RelayChannel[]> {
    if (ancestors.has(channel.id)) throw new BadRequestError(`Relay channel pool cycle detected at '${channel.name}'`);

    const constraints = this.mergeConstraints(inherited, channel);
    if ((channel.channelType || "standalone") !== "pooled") return [this.applyConstraints(channel, constraints)];

    const nextAncestors = new Set(ancestors).add(channel.id);
    const enabledMembers = channel.poolMembers.filter(
      (member) => member.enabled !== false && graph.has(member.memberChannelId),
    );
    const orderedMembers = orderMembers
      ? await orderMembers(channel, enabledMembers)
      : [...enabledMembers].sort((left, right) => left.priority - right.priority);
    const leaves: RelayChannel[] = [];

    for (const member of orderedMembers) {
      const memberChannel = graph.get(member.memberChannelId);
      if (!memberChannel || memberChannel.status !== RELAY_CHANNEL_STATUS.ENABLED) continue;
      leaves.push(
        ...(await this.resolveLeavesFromNode(memberChannel, graph, constraints, orderMembers, nextAncestors)),
      );
    }

    return leaves;
  }

  private initialConstraints(): EffectiveChannelConstraints {
    return { formats: new Set(ALL_FORMATS), allowedModelNames: null };
  }

  private mergeConstraints(inherited: EffectiveChannelConstraints, channel: RelayChannel): EffectiveChannelConstraints {
    const channelFormats = new Set(parseRelayRequestFormats(channel.allowedFormats));
    const formats = new Set([...inherited.formats].filter((format) => channelFormats.has(format)));
    const ownAllowedModelNames = this.getManualAllowedModelNames(channel);

    return {
      formats,
      allowedModelNames: this.intersectAllowedModelNames(inherited.allowedModelNames, ownAllowedModelNames),
    };
  }

  private getManualAllowedModelNames(channel: RelayChannel): string[] | null {
    const routingConfig = channel.routingConfig as Record<string, unknown> | null;
    const mode = typeof routingConfig?.allowedModelsMode === "string" ? routingConfig.allowedModelsMode : "";
    const isManual = mode === "manual" || (mode !== "all" && mode !== "auto" && Boolean(channel.allowedModels));
    if (!isManual) return null;

    const parsed = parseAllowedModelsJson(channel.allowedModels);
    // Preserve the existing invalid-config behavior: malformed JSON is unrestricted rather than silently blocking all use.
    return parsed ? parsed.map((name) => name.trim()).filter(Boolean) : null;
  }

  private parseManualAllowedModelNames(channel: RelayChannel): string[] | null {
    const parsed = parseAllowedModelsJson(channel.allowedModels);
    return parsed ? parsed.map((name) => name.trim()).filter(Boolean) : null;
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
      allowedFormats: constraints.formats.size === ALL_FORMATS.size ? "all" : [...constraints.formats].join(","),
      allowedModels: constraints.allowedModelNames === null ? null : JSON.stringify(constraints.allowedModelNames),
      routingConfig: {
        ...routingConfig,
        allowedModelsMode: constraints.allowedModelNames === null ? "all" : "manual",
      } as Prisma.JsonObject,
    };
  }

  private channelSupportsAnyModelFormat(channel: RelayChannel, supportedFormats?: string | null): boolean {
    const channelFormats = new Set(parseRelayRequestFormats(channel.allowedFormats));
    return parseRelayRequestFormats(supportedFormats).some((format) => channelFormats.has(format));
  }
}
