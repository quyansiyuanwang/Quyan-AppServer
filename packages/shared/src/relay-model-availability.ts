/** `openai` is retained only for internal legacy-call compatibility and normalizes to Chat Completions. */
export type RelayRequestFormat = 'openai' | 'openai-chat-completions' | 'openai-responses' | 'anthropic' | 'gemini';
export type RelayConfiguredRequestFormat = Exclude<RelayRequestFormat, 'openai'>;

export const ALL_RELAY_REQUEST_FORMATS: RelayConfiguredRequestFormat[] = [
  'openai-chat-completions',
  'anthropic',
  'gemini',
];

export const RELAY_REQUEST_FORMATS: RelayConfiguredRequestFormat[] = [
  ...ALL_RELAY_REQUEST_FORMATS.slice(0, 1),
  'openai-responses',
  ...ALL_RELAY_REQUEST_FORMATS.slice(1),
];

export interface ModelIdentityLike {
  model?: string | null;
  provider?: string | null;
}

export type RelayModelNameConstraint =
  | { kind: 'unrestricted' }
  | { kind: 'restricted'; values: string[] }
  | { kind: 'malformed' };

export const normalizeModelEntry = (value?: string | null): string => {
  return typeof value === 'string' ? value.trim() : '';
};

export const resolveModelId = (modelConfig: ModelIdentityLike): string => {
  const provider = normalizeModelEntry(modelConfig.provider);
  return provider || normalizeModelEntry(modelConfig.model);
};

export const parseAllowedModelsJson = (allowedModels?: string | null): string[] | null => {
  if (!allowedModels) return null;

  try {
    const parsed = JSON.parse(allowedModels);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item) => normalizeModelEntry(String(item ?? ''))).filter(Boolean);
  } catch {
    return null;
  }
};

export const parseRelayModelNameConstraint = (allowedModels?: string | null): RelayModelNameConstraint => {
  if (allowedModels == null || allowedModels.trim() === '') return { kind: 'unrestricted' };

  try {
    const parsed = JSON.parse(allowedModels);
    if (!Array.isArray(parsed)) return { kind: 'malformed' };

    return {
      kind: 'restricted',
      values: parsed.map((item) => normalizeModelEntry(String(item ?? ''))).filter(Boolean),
    };
  } catch {
    return { kind: 'malformed' };
  }
};

export const parseRelayTokenAllowedModelIds = (allowedModels?: string | null): string[] => {
  if (!allowedModels) return [];

  return allowedModels.split(',').map(normalizeModelEntry).filter(Boolean);
};

export const parseRelayRequestFormats = (allowedFormats?: string | null): RelayConfiguredRequestFormat[] => {
  const normalizedFormats = normalizeModelEntry(allowedFormats).toLowerCase();
  if (!normalizedFormats) return [...RELAY_REQUEST_FORMATS];

  const validFormats = new Set<RelayConfiguredRequestFormat>(RELAY_REQUEST_FORMATS);
  return normalizedFormats
    .split(',')
    .map(normalizeModelEntry)
    .map((item) => (item === 'openai' ? 'openai-chat-completions' : item))
    .filter((item): item is RelayConfiguredRequestFormat => validFormats.has(item as RelayConfiguredRequestFormat));
};

export const formatRelayRequestFormats = (formats: ReadonlyArray<RelayRequestFormat>): string => {
  const selected = RELAY_REQUEST_FORMATS.filter((format) => formats.includes(format));
  return selected.join(',');
};

export const supportsRelayRequestFormat = (
  allowedFormats: string | null | undefined,
  requestFormat: RelayRequestFormat,
): boolean => {
  const normalizedFormats = normalizeModelEntry(allowedFormats).toLowerCase();
  const normalizedRequestFormat = requestFormat === 'openai' ? 'openai-chat-completions' : requestFormat;
  return parseRelayRequestFormats(normalizedFormats).includes(normalizedRequestFormat);
};

export const isModelNameAllowed = (allowedEntries: string[] | null | undefined, modelName: string): boolean => {
  if (!allowedEntries) return true;

  const normalizedModelName = normalizeModelEntry(modelName);
  return !!normalizedModelName && allowedEntries.some((entry) => normalizeModelEntry(entry) === normalizedModelName);
};

export const isModelIdAllowed = (
  allowedModelIds: string[] | null | undefined,
  modelConfig: ModelIdentityLike,
): boolean => {
  if (!allowedModelIds) return true;

  const modelId = resolveModelId(modelConfig);
  return !!modelId && allowedModelIds.some((entry) => normalizeModelEntry(entry) === modelId);
};

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
    const modelId = resolveModelId(item);
    if (!modelId || modelId === modelName) continue;

    const previous = modelIdToName.get(modelId);
    if (previous === undefined) modelIdToName.set(modelId, modelName);
    else if (previous !== modelName) modelIdToName.set(modelId, null);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawEntry of allowedEntries) {
    const normalizedEntry = normalizeModelEntry(rawEntry);
    if (!normalizedEntry) continue;

    const canonicalName = exactModelNames.has(normalizedEntry)
      ? normalizedEntry
      : (modelIdToName.get(normalizedEntry) ?? normalizedEntry);
    if (seen.has(canonicalName)) continue;
    seen.add(canonicalName);
    result.push(canonicalName);
  }

  return result;
};

export const unionUniqueModelIds = (...modelIdLists: Array<ReadonlyArray<string> | null | undefined>): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const modelIds of modelIdLists) {
    for (const modelId of modelIds ?? []) {
      const normalizedModelId = normalizeModelEntry(modelId);
      if (!normalizedModelId || seen.has(normalizedModelId)) continue;
      seen.add(normalizedModelId);
      result.push(normalizedModelId);
    }
  }
  return result;
};
