import { resolveModelId } from "@quyan/shared";
import type { RelayChannelUpstreamModelsResponse } from "@/api/dto/relay/relay-channel.dto";
import type { RelayModelCatalogEntry } from "./relay-pool-resolver.service";

/** Transport, bounded parsing and worker limits belong to this operation, not deployment configuration. */
export const relayUpstreamModelsPolicy = Object.freeze({
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024,
  concurrency: 4,
  maxModelIdLength: 512,
  maxModels: 10_000,
  transactionTimeoutMs: 30_000,
});
export interface UpstreamModelConfiguration {
  upstreamUrl?: string;
  apiKey?: string;
  useProxy: boolean;
}
export interface UpstreamModelExecutionGuard {
  catalog: readonly RelayModelCatalogEntry[];
  beforeSend: () => Promise<void>;
}
/** Never coerce objects, reflect upstream fields, or return credential/configuration data. */
export function parseUpstreamModels(
  payload: unknown,
  catalog: readonly RelayModelCatalogEntry[],
): RelayChannelUpstreamModelsResponse["models"] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const source = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
  const identities = new Map<string, RelayModelCatalogEntry | undefined>();
  for (const model of catalog) {
    const id = resolveModelId(model).trim();
    identities.set(id, identities.has(id) ? undefined : model);
  }
  const seen = new Set<string>();
  const result: RelayChannelUpstreamModelsResponse["models"] = [];
  for (const item of source.slice(0, relayUpstreamModelsPolicy.maxModels)) {
    const value =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? ((item as Record<string, unknown>).id ??
            (item as Record<string, unknown>).name ??
            (item as Record<string, unknown>).model)
          : undefined;
    if (
      typeof value !== "string" ||
      value.length > relayUpstreamModelsPolicy.maxModelIdLength ||
      [...value].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
    )
      continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Ambiguous pricing identities are not silently resolved to an arbitrary row.
    const matched = identities.get(id);
    result.push({
      id,
      matched: Boolean(matched),
      pricingModel: matched?.model ?? undefined,
      pricingModelId: matched ? resolveModelId(matched) : undefined,
    });
  }
  return result;
}
