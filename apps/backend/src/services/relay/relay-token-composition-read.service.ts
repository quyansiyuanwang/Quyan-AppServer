import { relayCompositionCandidatesQuerySchema, relayTokenIdsSchema } from "@/api/schema/relay/relay.schema";
import type { RelayCompositionCandidatesDto } from "@/api/dto/relay/relay.dto";
import {
  RelayTokenCompositionReadRepository,
  type RelayTokenCompositionReadNode,
} from "@/store/relay/relay-token-composition-read.repository";
import type { RelayTokenInspectionTarget } from "@/store/relay/relay-token-inspection.repository";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { RELAY_COMPOSITION_POLICY } from "@/util/relay/relay-composition.util";
import { BadRequestError } from "@/util/errors";
import { RelayTokenInspectionIamService } from "./relay-token-inspection-iam.service";
import type { TypedRequest } from "@/types/express";
export interface RelayCompositionCandidatesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  editingTokenId?: string;
  selectedIds?: string;
  targetUserId?: string;
}
/** A candidate is visible only if its complete referenced subtree is authorized, including disabled references. */
export function projectRelayCompositionCandidates(
  targets: readonly Pick<RelayTokenInspectionTarget, "id" | "userId" | "status" | "updateTime" | "name">[],
  graph: readonly RelayTokenCompositionReadNode[],
  query: Required<Pick<RelayCompositionCandidatesQuery, "page" | "pageSize" | "search">> &
    Pick<RelayCompositionCandidatesQuery, "editingTokenId">,
  selectedIds: readonly string[],
): RelayCompositionCandidatesDto {
  const allowed = new Map(targets.map((row) => [row.id, row])),
    nodes = new Map(graph.map((row) => [row.id, row]));
  if ((query.editingTokenId && !allowed.has(query.editingTokenId)) || selectedIds.some((id) => !allowed.has(id)))
    throw iamAccountDenied();
  const memo = new Map<string, boolean>();
  const complete = (rootId: string): boolean => {
    if (memo.has(rootId)) return memo.get(rootId)!;
    let leaves = 0;
    const visit = (id: string, path: Set<string>, depth: number): boolean => {
      if (path.has(id)) return false;
      const node = nodes.get(id),
        target = allowed.get(id);
      if (
        !node ||
        !target ||
        node.userId !== target.userId ||
        node.userId !== nodes.get(rootId)?.userId ||
        node.status !== target.status ||
        node.updateTime.getTime() !== target.updateTime.getTime() ||
        !["ordered", "automatic-pool", "composite"].includes(node.routingMode)
      )
        return false;
      if (node.routingMode !== "composite") return ++leaves <= RELAY_COMPOSITION_POLICY.maxLeafPaths;
      if (
        depth >= RELAY_COMPOSITION_POLICY.maxDepth ||
        !node.memberTokenConfigs.length ||
        node.memberTokenConfigs.length > RELAY_COMPOSITION_POLICY.maxMembers ||
        new Set(node.memberTokenConfigs.map((edge) => edge.priority)).size !== node.memberTokenConfigs.length
      )
        return false;
      const next = new Set(path).add(id);
      return node.memberTokenConfigs.every(
        (edge) => isRelayTokenResourceId(edge.tokenId) && edge.status === 1 && visit(edge.tokenId, next, depth + 1),
      );
    };
    // Only root results are reusable: nested validity depends on the current path and depth.
    const result = visit(rootId, new Set(), 0);
    memo.set(rootId, result);
    return result;
  };
  const visible = graph.filter((node) => complete(node.id));
  if (selectedIds.some((id) => !visible.some((node) => node.id === id))) throw iamAccountDenied();
  const ancestors = new Set<string>(),
    queue = query.editingTokenId ? [query.editingTokenId] : [];
  for (let index = 0; index < queue.length; index++)
    for (const node of visible)
      if (
        node.routingMode === "composite" &&
        !ancestors.has(node.id) &&
        node.memberTokenConfigs.some((edge) => edge.tokenId === queue[index])
      ) {
        ancestors.add(node.id);
        queue.push(node.id);
      }
  const search = query.search.toLowerCase();
  const matches = visible
    .filter(
      (node) =>
        !search ||
        allowed.get(node.id)!.name?.toLowerCase().includes(search) ||
        node.id === query.search ||
        selectedIds.includes(node.id),
    )
    .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || a.id.localeCompare(b.id));
  return {
    page: query.page,
    pageSize: query.pageSize,
    total: matches.length,
    limits: {
      maxMembers: RELAY_COMPOSITION_POLICY.maxMembers,
      maxDepth: RELAY_COMPOSITION_POLICY.maxDepth,
      maxLeafPaths: RELAY_COMPOSITION_POLICY.maxLeafPaths,
      retryStatusCodes: [...RELAY_COMPOSITION_POLICY.retryStatusCodes],
    },
    items: matches.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((node) => ({
      id: node.id,
      name: allowed.get(node.id)!.name ?? undefined,
      routingMode: node.routingMode as "ordered" | "automatic-pool" | "composite",
      status: node.status,
      expiresAt: node.expiresAt ?? undefined,
      memberCount: node.routingMode === "composite" ? node.memberTokenConfigs.length : 0,
      memberTokenConfigs:
        node.routingMode === "composite"
          ? node.memberTokenConfigs.map((edge) => ({
              tokenId: edge.tokenId,
              priority: edge.priority,
              enabled: edge.enabled,
            }))
          : [],
      selectable: node.id !== query.editingTokenId && !ancestors.has(node.id),
      unavailableReason: node.id === query.editingTokenId ? "self" : ancestors.has(node.id) ? "cycle" : undefined,
    })),
  };
}
export class RelayTokenCompositionReadService {
  private static instance: RelayTokenCompositionReadService;
  static getInstance() {
    return (this.instance ??= new RelayTokenCompositionReadService());
  }
  constructor(
    private readonly inspection: Pick<
      RelayTokenInspectionIamService,
      "candidates"
    > = RelayTokenInspectionIamService.getInstance(),
    private readonly repository: Pick<
      RelayTokenCompositionReadRepository,
      "graph"
    > = RelayTokenCompositionReadRepository.getInstance(),
  ) {}
  async candidates(
    actorUserId: string,
    input: RelayCompositionCandidatesQuery,
    request: TypedRequest | undefined,
    legacy: () => Promise<RelayCompositionCandidatesDto>,
  ) {
    const parsed = relayCompositionCandidatesQuerySchema.strict().safeParse(input);
    if (
      !parsed.success ||
      [
        parsed.success ? parsed.data.editingTokenId : undefined,
        parsed.success ? parsed.data.targetUserId : undefined,
      ].some((id) => id !== undefined && !isRelayTokenResourceId(id))
    )
      throw new BadRequestError("Invalid composition candidates query", undefined, { messageKey: "errors.badRequest" });
    const selected = parsed.data.selectedIds
      ? relayTokenIdsSchema.safeParse(parsed.data.selectedIds.split(","))
      : undefined;
    if (selected && (!selected.success || selected.data.some((id) => !isRelayTokenResourceId(id))))
      throw new BadRequestError("Invalid selected composition candidates", undefined, {
        messageKey: "errors.badRequest",
      });
    const query = { ...parsed.data, search: parsed.data.search ?? "" },
      selectedIds = selected?.success ? selected.data : [];
    return this.inspection.candidates(
      actorUserId,
      query.targetUserId,
      request,
      async (targets, userId) => {
        const allowed = new Set(targets.map((row) => row.id));
        if ((query.editingTokenId && !allowed.has(query.editingTokenId)) || selectedIds.some((id) => !allowed.has(id)))
          throw iamAccountDenied();
        const graph = await this.repository.graph(userId, targets),
          proof = JSON.stringify(graph);
        const result = projectRelayCompositionCandidates(targets, graph, query, selectedIds);
        if (JSON.stringify(await this.repository.graph(userId, targets)) !== proof) throw iamAccountDenied();
        return result;
      },
      legacy,
    );
  }
}
