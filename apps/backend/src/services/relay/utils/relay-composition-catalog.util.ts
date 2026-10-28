import { resolveMappedModel } from "@/util/model-mapping.util";
import { RELAY_COMPOSITION_POLICY } from "@/util/relay/relay-composition.util";
import { resolveRelayRequestFormatTransform } from "../relay-request-format-transform.service";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";
import type { RelayRequestFormat } from "@/util/relay";
export interface RelayCompositionCatalogToken {
  id: string;
  userId: string;
  status: number;
  expiresAt: Date | null;
  routingMode: string;
  requestFormatTransforms?: unknown;
  modelMapping?: unknown;
  memberTokenConfigs: readonly { tokenId: string; enabled: boolean; priority: number }[];
}
/** Both management discovery and execution use this path-preserving composition transform. */
export async function projectRelayCompositionCatalog<TToken extends RelayCompositionCatalogToken>(
  id: string,
  format: RelayRequestFormat,
  graph: ReadonlyMap<string, TToken>,
  host: {
    leaf(token: TToken, format: RelayRequestFormat, requested: string[], ancestors: TToken[]): Promise<string[]>;
    allows(token: TToken, model: string, mapped: string): Promise<boolean>;
  },
): Promise<Array<{ model: string; tokenPathIds: string[] }>> {
  const visit = async (
    token: TToken,
    requestFormat: RelayRequestFormat,
    path: Set<string>,
    requested: string[] = [],
    ancestors: TToken[] = [],
  ): Promise<Array<{ model: string; tokenPathIds: string[] }>> => {
    if (
      path.has(token.id) ||
      path.size > RELAY_COMPOSITION_POLICY.maxDepth ||
      token.status !== 1 ||
      (token.expiresAt && token.expiresAt < new Date())
    )
      return [];
    if (token.routingMode !== "composite")
      return (await host.leaf(token, requestFormat, requested, ancestors)).map((model) => ({
        model,
        tokenPathIds: [token.id],
      }));
    const transform = resolveRelayRequestFormatTransform(
      token.requestFormatTransforms,
      requestFormat as RelayConvertibleRequestFormat,
    );
    const target = transform?.targetFormat ?? requestFormat;
    const entries: Array<{ model: string; tokenPathIds: string[] }> = [];
    for (const edge of [...token.memberTokenConfigs].sort((a, b) => a.priority - b.priority)) {
      const child = graph.get(edge.tokenId);
      if (!edge.enabled || !child || child.userId !== token.userId) continue;
      const mapping = token.modelMapping as Record<string, string> | null;
      const targets = [
        ...requested.map((model) => resolveMappedModel(model, undefined, mapping)),
        ...Object.values(mapping ?? {}),
      ];
      const available = await visit(child, target, new Set(path).add(token.id), targets, [...ancestors, token]);
      const candidates = new Set([
        ...available.map((item) => item.model),
        ...Object.keys(mapping ?? {}).filter((key) => !/[?*]/.test(key)),
      ]);
      for (const model of candidates) {
        const mapped = resolveMappedModel(model, undefined, mapping);
        if (!(await host.allows(token, model, mapped))) continue;
        for (const candidate of available)
          if (candidate.model === mapped) entries.push({ model, tokenPathIds: [token.id, ...candidate.tokenPathIds] });
      }
    }
    return entries;
  };
  const root = graph.get(id);
  return root ? visit(root, format, new Set()) : [];
}
