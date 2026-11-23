import { randomUUID } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { analyzeRelayTokenModelMappingRules, normalizeRelayTokenModelMappingRules } from "@quyan/shared";
import type {
  RelayTokenModelMappingDraftDto,
  RelayTokenModelMappingPreviewRequest,
  RelayTokenModelMappingPreviewDto,
  RelayTokenModelMappingChannelOptionsRequest,
  RelayTokenModelMappingChannelOptionsDto,
} from "@/api/dto/relay/relay-token-model-mapping.dto";
import {
  relayTokenModelMappingDraftSchema,
  relayTokenModelMappingPreviewBodySchema,
  relayTokenModelMappingChannelOptionsBodySchema,
} from "@/api/schema/relay/relay-token-model-mapping.schema";
import {
  RelayTokenCapabilityRepository,
  type RelayTokenCapabilitySnapshot,
} from "@/store/relay/relay-token-capability.repository";
import type { RelayCatalogSnapshot } from "@/store/relay/relay-channel-catalog-read.repository";
import type { RelayTokenInspectionTarget } from "@/store/relay/relay-token-inspection.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { RELAY_COMPOSITION_POLICY, validateRelayComposition } from "@/util/relay/relay-composition.util";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import { RelayTokenInspectionIamService } from "./relay-token-inspection-iam.service";
import { RelayChannelCatalogIamService } from "./relay-channel-catalog-iam.service";
import { RelayPoolResolverService } from "./relay-pool-resolver.service";
import { resolveRelayModelRoute } from "./utils/relay-model-route.util";

const DISPLAY_ROOT_ID = "__model_mapping_preview__";
export type RelayTokenModelMappingSnapshot = Pick<
  RelayTokenCapabilitySnapshot,
  | "id"
  | "userId"
  | "status"
  | "expiresAt"
  | "routingMode"
  | "channelId"
  | "channelConfigs"
  | "automaticProxyPoolChannelId"
  | "blockedAutomaticProxyPoolChannelIds"
  | "allowedModels"
  | "modelMapping"
  | "requestFormatTransforms"
  | "memberTokenConfigs"
> & {
  modelMappingRules?: unknown;
  failoverConfig: RelayTokenCapabilitySnapshot["failoverConfig"] | RelayTokenModelMappingDraftDto["failoverConfig"];
};
type MappingToken = RelayTokenModelMappingSnapshot;
/** Caller owns lifecycle admission and rechecks these snapshots before committing. */
export interface RelayTokenModelMappingScopeContext {
  userId: string;
  tokens: readonly RelayTokenModelMappingSnapshot[];
  channels: RelayCatalogSnapshot;
}
type InspectionKind = "model-mapping-preview" | "model-mapping-channel-options";
const badDraft = () =>
  new BadRequestError("Invalid model mapping draft", undefined, { messageKey: "errors.badRequest" });
const rootsFor = (token: MappingToken) =>
  token.routingMode === "automatic-pool"
    ? token.automaticProxyPoolChannelId
      ? [token.automaticProxyPoolChannelId]
      : []
    : token.channelConfigs.length
      ? [...token.channelConfigs].sort((a, b) => a.priority - b.priority).map((edge) => edge.channelId)
      : token.channelId
        ? [token.channelId]
        : [];
const membersFor = (token: MappingToken) =>
  token.memberTokenConfigs
    .map(({ tokenId, priority, enabled }) => ({ tokenId, priority, enabled }))
    .sort((a, b) => a.priority - b.priority || a.tokenId.localeCompare(b.tokenId));

export class RelayTokenModelMappingService {
  private static instance: RelayTokenModelMappingService;
  static getInstance() {
    return (this.instance ??= new RelayTokenModelMappingService());
  }
  constructor(
    private readonly inspection: Pick<
      RelayTokenInspectionIamService,
      "modelMapping"
    > = RelayTokenInspectionIamService.getInstance(),
    private readonly channels: Pick<
      RelayChannelCatalogIamService,
      "withRoutingSnapshot"
    > = RelayChannelCatalogIamService.getInstance(),
    private readonly repository: Pick<
      RelayTokenCapabilityRepository,
      "tokens"
    > = RelayTokenCapabilityRepository.getInstance(),
    private readonly pools: Pick<
      RelayPoolResolverService,
      "resolveCapabilityLeafCandidates"
    > = RelayPoolResolverService.getInstance(),
  ) {}

  async preview(
    actorUserId: string,
    input: RelayTokenModelMappingPreviewRequest,
    request?: TypedRequest,
  ): Promise<RelayTokenModelMappingPreviewDto> {
    const parsed = relayTokenModelMappingPreviewBodySchema.safeParse(input);
    if (!parsed.success) throw badDraft();
    const data = parsed.data;
    return this.withDraft(
      actorUserId,
      data.draft,
      request,
      "model-mapping-preview",
      async ({ root, paths, modelCatalog }) => {
        const diagnostics = analyzeRelayTokenModelMappingRules(normalizeInputRules(root)).map(
          ({ ruleIndex, otherRuleIndex, severity, code }) => ({
            ruleIndex,
            ...(otherRuleIndex === undefined ? {} : { otherRuleIndex }),
            severity,
            code,
          }),
        );
        const rows = new Map<string, RelayTokenModelMappingPreviewDto["items"][number]>();
        for (const path of paths) {
          const result = resolveRelayModelRoute({
            requestedModel: data.requestModel,
            requestFormat: data.requestFormat,
            tokens: path.tokens,
            channel: path.resolvedChannel,
            channelPathIds: path.routingChannelIds,
            modelCatalog,
          });
          const source = [...result.steps].reverse().find((step) => step.rule)?.tokenId;
          const row = {
            channelId: path.channel.id,
            channelName: path.channel.name,
            tokenPathIds: path.tokens.map((token) =>
              token.id === root.id && !data.draft.editingTokenId ? DISPLAY_ROOT_ID : token.id,
            ),
            requestedModel: data.requestModel,
            ...(result.effectiveModel === undefined ? {} : { effectiveModel: result.effectiveModel }),
            ...(source === undefined
              ? {}
              : { ruleSource: source === root.id && !data.draft.editingTokenId ? DISPLAY_ROOT_ID : source }),
            outcome: result.outcome,
            reason: result.reason,
          };
          // One public route has one row, regardless of physical outcomes or member count.
          // Preserve resolver priority among executable paths (or the first failure if none execute).
          const key = JSON.stringify([row.channelId, row.tokenPathIds]);
          const previous = rows.get(key);
          if (!previous || (previous.outcome === "unavailable" && result.modelConfig !== null)) rows.set(key, row);
        }
        const items = [...rows.values()].sort(
          (a, b) =>
            a.channelName.localeCompare(b.channelName) ||
            a.channelId.localeCompare(b.channelId) ||
            a.tokenPathIds.join().localeCompare(b.tokenPathIds.join()),
        );
        return {
          items: items.slice((data.page - 1) * data.pageSize, data.page * data.pageSize),
          total: items.length,
          page: data.page,
          pageSize: data.pageSize,
          diagnostics,
        };
      },
    );
  }

  async channelOptions(
    actorUserId: string,
    input: RelayTokenModelMappingChannelOptionsRequest,
    request?: TypedRequest,
  ): Promise<RelayTokenModelMappingChannelOptionsDto> {
    const parsed = relayTokenModelMappingChannelOptionsBodySchema.safeParse(input);
    if (!parsed.success) throw badDraft();
    const data = parsed.data;
    return this.withDraft(actorUserId, data.draft, request, "model-mapping-channel-options", async ({ candidates }) => {
      if (data.selectedIds.some((id) => !candidates.has(id))) throw iamAccountDenied();
      const search = data.search.toLowerCase();
      const items = [...candidates.values()]
        .filter(
          (row) =>
            !search ||
            row.name.toLowerCase().includes(search) ||
            row.id === data.search ||
            data.selectedIds.includes(row.id),
        )
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return {
        items: items.slice((data.page - 1) * data.pageSize, data.page * data.pageSize),
        total: items.length,
        page: data.page,
        pageSize: data.pageSize,
      };
    });
  }

  async validateDraftScope(
    draft: RelayTokenModelMappingDraftDto,
    context: RelayTokenModelMappingScopeContext,
  ): Promise<void> {
    const parsed = relayTokenModelMappingDraftSchema.safeParse(draft);
    if (!parsed.success) throw badDraft();
    if (
      (draft.targetUserId !== undefined && draft.targetUserId !== context.userId) ||
      context.tokens.some((row) => row.userId !== context.userId)
    )
      throw iamAccountDenied();
    const graph = new Map(context.tokens.map((row) => [row.id, row]));
    const original = draft.editingTokenId ? graph.get(draft.editingTokenId) : undefined;
    if (draft.editingTokenId && !original) throw iamAccountDenied();
    const root = this.draftRoot(parsed.data, original, context.userId);
    graph.set(root.id, root);
    validateRelayComposition([...graph.values()]);
    const { candidates } = await this.paths(root, graph, context.channels);
    validateRelayTokenModelMappingScopes(normalizeInputRules(root), new Set(candidates.keys()));
  }

  private async withDraft<T>(
    actorUserId: string,
    draft: RelayTokenModelMappingDraftDto,
    request: TypedRequest | undefined,
    kind: InspectionKind,
    read: (context: Awaited<ReturnType<RelayTokenModelMappingService["paths"]>> & { root: MappingToken }) => Promise<T>,
  ): Promise<T> {
    const ids = [
      ...new Set([
        ...(draft.editingTokenId ? [draft.editingTokenId] : []),
        ...(draft.memberTokenConfigs ?? []).map((edge) => edge.tokenId),
      ]),
    ];
    return this.inspection.modelMapping(
      kind,
      actorUserId,
      ids,
      draft.targetUserId,
      request,
      async (initial, userId, admit) => {
        const evaluatedAt = Date.now();
        const targets = new Map<string, RelayTokenInspectionTarget>(),
          tokens = new Map<string, MappingToken>();
        const hydrate = async (frontier: RelayTokenInspectionTarget[]) => {
          for (let depth = 0; frontier.length; depth++) {
            if (
              depth > RELAY_COMPOSITION_POLICY.maxDepth ||
              targets.size + frontier.length >
                1 + RELAY_COMPOSITION_POLICY.maxLeafPaths * RELAY_COMPOSITION_POLICY.maxDepth
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
            frontier = await admit([...next].sort());
          }
        };
        await hydrate(initial);
        const original = draft.editingTokenId ? tokens.get(draft.editingTokenId) : undefined;
        if (draft.editingTokenId && !original) throw iamAccountDenied();
        const proofTargets = [...targets.values()],
          before = JSON.stringify([...tokens.values()].sort((a, b) => a.id.localeCompare(b.id)));
        const root = this.draftRoot(draft, original, userId);
        tokens.set(root.id, root);
        validateRelayComposition([...tokens.values()]);
        return this.channels.withRoutingSnapshot(actorUserId, userId, request, async (snapshot) => {
          const context = await this.paths(root, tokens, snapshot);
          const rawRules = root.modelMappingRules;
          const scopeIds = Array.isArray(rawRules)
            ? rawRules.flatMap((rule: unknown) =>
                rule && typeof rule === "object" && "channelIds" in rule && Array.isArray(rule.channelIds)
                  ? rule.channelIds
                  : [],
              )
            : [];
          if (scopeIds.some((id) => !context.candidates.has(id))) throw iamAccountDenied();
          const result = await read({ ...context, root });
          if (
            JSON.stringify(await this.repository.tokens(userId, proofTargets)) !== before ||
            [...tokens.values()].some(
              (token) =>
                token.expiresAt && token.expiresAt.getTime() > evaluatedAt && token.expiresAt.getTime() <= Date.now(),
            )
          )
            throw iamAccountDenied();
          return result;
        });
      },
    );
  }

  private draftRoot(
    draft: RelayTokenModelMappingDraftDto,
    original: MappingToken | undefined,
    userId: string,
  ): MappingToken {
    const routingMode = draft.routingMode ?? original?.routingMode ?? "ordered";
    if (
      original?.routingMode === "composite" &&
      (routingMode !== "composite" ||
        (draft.memberTokenConfigs !== undefined &&
          !same(
            [...draft.memberTokenConfigs].sort((a, b) => a.priority - b.priority || a.tokenId.localeCompare(b.tokenId)),
            membersFor(original),
          )))
    )
      throw badDraft();
    const timestamp = new Date(0);
    const memberTokenConfigs =
      draft.memberTokenConfigs === undefined
        ? (original?.memberTokenConfigs ?? [])
        : draft.memberTokenConfigs.map((edge, index) => ({
            ...edge,
            id: "draft_" + index,
            status: 1,
            updateTime: timestamp,
          }));
    const channelConfigs =
      draft.channelConfigs === undefined
        ? (original?.channelConfigs ?? [])
        : draft.channelConfigs.map((edge, index) => ({ ...edge, id: "draft_" + index, updateTime: timestamp }));
    const root: MappingToken = {
      id: original?.id ?? "preview_" + randomUUID(),
      userId,
      status: 1,
      expiresAt: original?.expiresAt ?? null,
      routingMode,
      memberTokenConfigs,
      channelConfigs,
      channelId: draft.channelId === undefined ? (original?.channelId ?? null) : draft.channelId,
      automaticProxyPoolChannelId:
        draft.automaticProxyPoolChannelId === undefined
          ? (original?.automaticProxyPoolChannelId ?? null)
          : draft.automaticProxyPoolChannelId,
      blockedAutomaticProxyPoolChannelIds:
        draft.blockedAutomaticProxyPoolChannelIds === undefined
          ? (original?.blockedAutomaticProxyPoolChannelIds ?? null)
          : draft.blockedAutomaticProxyPoolChannelIds,
      allowedModels: draft.allowedModels === undefined ? (original?.allowedModels ?? null) : draft.allowedModels,
      modelMapping:
        draft.modelMappingRules !== undefined
          ? null
          : draft.modelMapping === undefined
            ? (original?.modelMapping ?? null)
            : draft.modelMapping,
      modelMappingRules:
        draft.modelMapping !== undefined
          ? null
          : draft.modelMappingRules === undefined
            ? original?.modelMappingRules
            : draft.modelMappingRules,
      requestFormatTransforms:
        draft.requestFormatTransforms === undefined
          ? (original?.requestFormatTransforms ?? null)
          : (draft.requestFormatTransforms as MappingToken["requestFormatTransforms"]),
      failoverConfig: draft.failoverConfig === undefined ? (original?.failoverConfig ?? null) : draft.failoverConfig,
    };
    if (
      (routingMode === "composite" &&
        (root.channelId || root.channelConfigs.length || root.automaticProxyPoolChannelId)) ||
      (routingMode !== "composite" && root.memberTokenConfigs.length) ||
      (routingMode === "automatic-pool" && (root.channelId || root.channelConfigs.length))
    )
      throw badDraft();
    return root;
  }

  private async paths(root: MappingToken, graph: ReadonlyMap<string, MappingToken>, snapshot: RelayCatalogSnapshot) {
    type ChannelPath = Awaited<ReturnType<RelayPoolResolverService["resolveCapabilityLeafCandidates"]>>[number];
    const paths: Array<ChannelPath & { tokens: MappingToken[]; channel: { id: string; name: string } }> = [];
    const candidates = new Map<string, { id: string; name: string }>();
    const logical = new Map(
      snapshot.sources
        .filter((row) => ["standalone", "pooled", "automatic-proxy-pool"].includes(row.channelType))
        .map((row) => [row.id, row]),
    );
    const visit = async (token: MappingToken, ancestors: MappingToken[]) => {
      if (ancestors.some((row) => row.id === token.id) || ancestors.length > RELAY_COMPOSITION_POLICY.maxDepth)
        throw badDraft();
      if (token.status !== 1 || (token.expiresAt && token.expiresAt.getTime() <= Date.now())) return;
      const tokens = [...ancestors, token];
      if (token.routingMode === "composite") {
        for (const edge of [...token.memberTokenConfigs].sort((a, b) => a.priority - b.priority)) {
          if (!edge.enabled) continue;
          const member = graph.get(edge.tokenId);
          if (!member || member.userId !== root.userId) throw iamAccountDenied();
          await visit(member, tokens);
        }
        return;
      }
      const roots = rootsFor(token).filter((id) => logical.has(id));
      if (
        roots.some(
          (id) =>
            (token.routingMode === "automatic-pool") !== (logical.get(id)?.channelType === "automatic-proxy-pool"),
        )
      )
        throw badDraft();
      const blocked = new Set(
        tokens.flatMap((node) =>
          Array.isArray(node.blockedAutomaticProxyPoolChannelIds)
            ? node.blockedAutomaticProxyPoolChannelIds.filter((value): value is string => typeof value === "string")
            : [],
        ),
      );
      for (const path of await this.pools.resolveCapabilityLeafCandidates(roots, snapshot.context.graph)) {
        if (path.routingChannelIds.some((id) => blocked.has(id))) continue;
        const visiblePath = path.routingChannelIds.map((id) => logical.get(id)).filter((row) => row !== undefined);
        const channel = visiblePath.at(-1);
        if (!channel) continue;
        for (const row of visiblePath) candidates.set(row.id, { id: row.id, name: row.name });
        paths.push({ ...path, tokens, channel: { id: channel.id, name: channel.name } });
      }
    };
    await visit(root, []);
    return { paths, candidates, modelCatalog: snapshot.context.modelCatalog };
  }
}

const normalizeInputRules = (token: MappingToken): unknown =>
  token.modelMappingRules ?? normalizeRelayTokenModelMappingRules(undefined, token.modelMapping);

/** Reuse current lifecycle admission; this helper requests no preview/list operation permissions. */
export async function validateRelayTokenModelMappingDraftScope(
  draft: RelayTokenModelMappingDraftDto,
  context: RelayTokenModelMappingScopeContext,
): Promise<void> {
  return RelayTokenModelMappingService.getInstance().validateDraftScope(draft, context);
}

/** For lifecycle callers that already computed reachable logical IDs inside their catalog boundary. */
export function validateRelayTokenModelMappingScopes(
  rules: unknown,
  reachableLogicalChannelIds: ReadonlySet<string>,
): void {
  if (analyzeRelayTokenModelMappingRules(rules).some((row) => row.severity === "error")) throw badDraft();
  if (
    normalizeRelayTokenModelMappingRules(rules).some((rule) =>
      rule.channelIds?.some((id) => !reachableLogicalChannelIds.has(id)),
    )
  )
    throw iamAccountDenied();
}
