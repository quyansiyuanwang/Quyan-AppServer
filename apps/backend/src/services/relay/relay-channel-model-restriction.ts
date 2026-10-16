import type { Prisma } from "@prisma/client";
import { resolveModelId } from "@quyan/shared";
import { getRelayChannelAllowedModelsMode } from "@/util/relay/relay-model-availability.util";
import type { RelayModelCatalogEntry } from "./relay-pool-resolver.service";
export interface ChannelRestrictionSource {
  channelType: string;
  allowedModels: string | null;
  routingConfig: Prisma.JsonValue;
}
export type ChannelRestrictionPlan =
  | { patch: { allowedModels: string; routingConfig?: Prisma.InputJsonObject } }
  | { reason: string };
/** Business rejections are explicit safe values. Authorization/infrastructure failures must not be caught as partial success. */
export function planRelayChannelModelRestriction(
  source: ChannelRestrictionSource,
  addModels: readonly string[],
  catalog: readonly RelayModelCatalogEntry[],
): ChannelRestrictionPlan {
  const known = new Map(catalog.map((row) => [(row.model ?? "").trim(), resolveModelId(row).trim()]));
  if (addModels.some((model) => !known.has(model.trim()))) return { reason: "Unknown global pricing model" };
  let current: string[] = [];
  if (getRelayChannelAllowedModelsMode(source) === "manual" && source.allowedModels) {
    let value: unknown;
    try {
      value = JSON.parse(source.allowedModels);
    } catch {
      return { reason: "Invalid stored model restriction" };
    }
    if (!Array.isArray(value) || value.some((model) => typeof model !== "string" || !model.trim()))
      return { reason: "Invalid stored model restriction" };
    current = value.map((model) => model.trim());
  }
  const models = [...new Set([...current, ...addModels.map((model) => model.trim())])],
    identities = new Set<string>();
  for (const model of models) {
    const id = known.get(model);
    if (!id) continue; // Retain historical unregistered names, matching normal channel validation.
    if (identities.has(id)) return { reason: "Duplicate request model identity" };
    identities.add(id);
  }
  const patch: { allowedModels: string; routingConfig?: Prisma.InputJsonObject } = {
    allowedModels: JSON.stringify(models),
  };
  if (["pooled", "automatic-proxy-pool"].includes(source.channelType)) {
    if (
      source.routingConfig !== null &&
      (typeof source.routingConfig !== "object" || Array.isArray(source.routingConfig))
    )
      return { reason: "Invalid stored pool routing configuration" };
    patch.routingConfig = { ...(source.routingConfig as Prisma.InputJsonObject | null), allowedModelsMode: "manual" };
  }
  return { patch };
}
