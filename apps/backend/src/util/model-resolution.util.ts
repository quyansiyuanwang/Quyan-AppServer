export interface ModelIdentityLike {
  model?: string | null;
  provider?: string | null;
}

const normalizeModelEntry = (value?: string | null): string => {
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Resolves the model ID from a model configuration.
 *
 * The model ID is determined by the `provider` field if present, otherwise falls back to the `model` field.
 * This distinction allows multiple model names to share the same underlying provider/model ID.
 *
 * @param modelConfig - Configuration object containing model and/or provider information
 * @returns The resolved model ID (provider takes precedence over model)
 *
 * @example
 * resolveModelId({ model: "gpt-4", provider: "gpt-4-0613" }) // Returns "gpt-4-0613"
 * resolveModelId({ model: "gpt-4" }) // Returns "gpt-4"
 */
export const resolveModelId = (modelConfig: ModelIdentityLike): string => {
  const provider = typeof modelConfig.provider === "string" ? modelConfig.provider.trim() : "";
  if (provider.length > 0) return provider;

  return typeof modelConfig.model === "string" ? modelConfig.model.trim() : "";
};

export const parseAllowedModelsJson = (allowedModels?: string | null): string[] | null => {
  if (!allowedModels) return null;

  try {
    const parsed = JSON.parse(allowedModels);
    if (!Array.isArray(parsed)) return null;

    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return null;
  }
};

export const isModelNameAllowed = (allowedEntries: string[] | null | undefined, modelName: string): boolean => {
  if (!allowedEntries) return true;

  const normalizedModelName = normalizeModelEntry(modelName);
  if (!normalizedModelName) return false;

  return allowedEntries.some((entry) => normalizeModelEntry(entry) === normalizedModelName);
};

/**
 * Checks if a model configuration is allowed based on a list of allowed model IDs.
 *
 * The model ID is resolved using the provider/model distinction (see resolveModelId).
 * If no allowed list is provided, all models are considered allowed.
 *
 * @param allowedModelIds - Array of allowed model IDs, or null/undefined to allow all
 * @param modelConfig - Configuration object containing model and/or provider information
 * @returns true if the model is allowed, false otherwise
 *
 * @example
 * isModelIdAllowed(["gpt-4-0613"], { model: "gpt-4", provider: "gpt-4-0613" }) // Returns true
 * isModelIdAllowed(["gpt-3.5"], { model: "gpt-4" }) // Returns false
 * isModelIdAllowed(null, { model: "any-model" }) // Returns true (no restrictions)
 */
export const isModelIdAllowed = (
  allowedModelIds: string[] | null | undefined,
  modelConfig: ModelIdentityLike,
): boolean => {
  if (!allowedModelIds) return true;

  const modelId = resolveModelId(modelConfig);
  const normalizedModelId = normalizeModelEntry(modelId);
  if (!normalizedModelId) return false;

  return allowedModelIds.some((entry) => normalizeModelEntry(entry) === normalizedModelId);
};

/**
 * Normalizes allowed model entries (which may be model IDs) to model names.
 *
 * This function handles the case where multiple models share the same model ID (provider).
 * When a model ID maps to multiple model names, the mapping is set to null to indicate ambiguity.
 * In such cases, the model ID entry is kept as-is in the output rather than being resolved to a name.
 *
 * @param allowedEntries - Array of allowed model entries (can be model names or model IDs)
 * @param modelCatalog - Catalog of available models with their configurations
 * @returns Normalized array of model names, or null/undefined if input is null/undefined
 *
 * @remarks
 * Ambiguity handling: When multiple models share the same provider/model ID:
 * - Example: Model A { model: "gpt-4", provider: "gpt-4-0613" } and Model B { model: "gpt-4-turbo", provider: "gpt-4-0613" }
 * - Both share provider "gpt-4-0613", so the mapping becomes null
 * - The original model ID is preserved in the output without resolution
 *
 * @example
 * const catalog = [
 *   { model: "gpt-4", provider: "gpt-4-0613" },
 *   { model: "gpt-3.5-turbo", provider: "gpt-3.5-turbo-0125" }
 * ]
 * normalizeAllowedModelEntriesToModelNames(["gpt-4-0613"], catalog) // Returns ["gpt-4"]
 * normalizeAllowedModelEntriesToModelNames(["gpt-4"], catalog) // Returns ["gpt-4"]
 */
export const normalizeAllowedModelEntriesToModelNames = (
  allowedEntries: string[] | null | undefined,
  modelCatalog: ModelIdentityLike[],
): string[] | null | undefined => {
  if (!allowedEntries) return allowedEntries;

  const exactModelNames = new Set<string>();
  const modelIdToName = new Map<string, string | null>();

  for (const item of modelCatalog) {
    const modelName = normalizeModelEntry(item.model);
    if (!modelName) continue;

    exactModelNames.add(modelName);

    const modelId = normalizeModelEntry(resolveModelId(item));
    if (!modelId || modelId === modelName) continue;

    const previous = modelIdToName.get(modelId);
    if (previous === undefined) {
      modelIdToName.set(modelId, modelName);
      continue;
    }

    // Multiple models share the same model ID - mark as ambiguous
    if (previous !== modelName) modelIdToName.set(modelId, null);
  }

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const rawEntry of allowedEntries) {
    const normalizedEntry = normalizeModelEntry(rawEntry);
    if (!normalizedEntry) continue;

    let canonicalName = normalizedEntry;
    if (!exactModelNames.has(normalizedEntry)) {
      const mappedModelName = modelIdToName.get(normalizedEntry);
      if (mappedModelName) canonicalName = mappedModelName;
    }

    if (seen.has(canonicalName)) continue;

    seen.add(canonicalName);
    deduped.push(canonicalName);
  }

  return deduped;
};
