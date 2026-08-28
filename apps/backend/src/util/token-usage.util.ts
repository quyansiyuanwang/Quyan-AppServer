export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
}

export interface TokenUsageMetrics extends TokenBreakdown {
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export const parseNumericTokenValue = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const hasTokenValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim().length === 0) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
};

export const sumTokenValues = (...values: unknown[]): number =>
  values.reduce<number>((sum, value) => sum + parseNumericTokenValue(value), 0);

const sumNonNegativeTokenValues = (...values: unknown[]): number =>
  values.reduce<number>((sum, value) => sum + Math.max(0, parseNumericTokenValue(value)), 0);

const maxNonNegativeTokenValues = (...values: unknown[]): number =>
  values.reduce<number>((maxValue, value) => Math.max(maxValue, Math.max(0, parseNumericTokenValue(value))), 0);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const normalizeTokenBreakdown = (
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  inputFallback: number = 0,
): TokenBreakdown => {
  let resolvedInputTokens = Math.max(0, parseNumericTokenValue(inputTokens));
  let resolvedOutputTokens = Math.max(0, parseNumericTokenValue(outputTokens));
  let resolvedTotalTokens = Math.max(0, parseNumericTokenValue(totalTokens));
  const normalizedFallbackInput = Math.max(0, parseNumericTokenValue(inputFallback));

  if (resolvedTotalTokens <= 0 && (resolvedInputTokens > 0 || resolvedOutputTokens > 0))
    resolvedTotalTokens = resolvedInputTokens + resolvedOutputTokens;

  if (resolvedTotalTokens > 0)
    if (resolvedInputTokens <= 0 && resolvedOutputTokens > 0)
      resolvedInputTokens = Math.max(resolvedTotalTokens - resolvedOutputTokens, 0);
    else if (resolvedOutputTokens <= 0 && resolvedInputTokens > 0)
      resolvedOutputTokens = Math.max(resolvedTotalTokens - resolvedInputTokens, 0);
    else if (resolvedInputTokens <= 0 && resolvedOutputTokens <= 0 && normalizedFallbackInput > 0) {
      resolvedInputTokens = Math.min(normalizedFallbackInput, resolvedTotalTokens);
      resolvedOutputTokens = Math.max(resolvedTotalTokens - resolvedInputTokens, 0);
    }

  if (resolvedInputTokens <= 0 && normalizedFallbackInput > 0) resolvedInputTokens = normalizedFallbackInput;

  if (resolvedTotalTokens <= 0) resolvedTotalTokens = resolvedInputTokens + resolvedOutputTokens;

  if (resolvedTotalTokens > 0 && resolvedOutputTokens <= 0 && resolvedInputTokens > 0)
    resolvedOutputTokens = Math.max(resolvedTotalTokens - resolvedInputTokens, 0);

  if (resolvedInputTokens > 0 || resolvedOutputTokens > 0)
    resolvedTotalTokens = resolvedInputTokens + resolvedOutputTokens;

  return {
    inputTokens: resolvedInputTokens,
    outputTokens: resolvedOutputTokens,
    requestTokens: resolvedInputTokens,
    responseTokens: resolvedOutputTokens,
    totalTokens: resolvedTotalTokens,
  };
};

/**
 * Resolve the fresh-input portion used for token-based billing.
 * Cache-inclusive providers report cache reads and writes inside input tokens;
 * cache-exclusive providers already report fresh input and must not be reduced.
 */
export const resolveFreshInputTokens = (
  inputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  inputIncludesCacheRead: boolean,
): number => {
  const input = Math.max(0, parseNumericTokenValue(inputTokens));
  if (!inputIncludesCacheRead) return input;

  return Math.max(
    0,
    input -
      Math.max(0, parseNumericTokenValue(cacheReadTokens)) -
      Math.max(0, parseNumericTokenValue(cacheCreationTokens)),
  );
};

export const extractTokenUsageMetrics = (usage: unknown): TokenUsageMetrics => {
  const usageData: Record<string, unknown> = isRecord(usage) ? usage : {};
  const cacheCreationData = isRecord(usageData.cache_creation) ? usageData.cache_creation : {};
  const cacheReadData = isRecord(usageData.cache_read) ? usageData.cache_read : {};
  const promptTokenDetails = isRecord(usageData.prompt_tokens_details) ? usageData.prompt_tokens_details : {};
  const inputTokenDetails = isRecord(usageData.input_tokens_details) ? usageData.input_tokens_details : {};

  const hasPromptTokens = hasTokenValue(usageData.prompt_tokens) || hasTokenValue(usageData.promptTokenCount);
  const hasInputTokens = hasTokenValue(usageData.input_tokens);
  const hasCompletionTokens =
    hasTokenValue(usageData.completion_tokens) || hasTokenValue(usageData.candidatesTokenCount);
  const hasOutputTokens = hasTokenValue(usageData.output_tokens);
  const hasTotalTokens = hasTokenValue(usageData.total_tokens) || hasTokenValue(usageData.totalTokenCount);

  const rawInputTokens = hasPromptTokens
    ? parseNumericTokenValue(usageData.prompt_tokens ?? usageData.promptTokenCount)
    : hasInputTokens
      ? parseNumericTokenValue(usageData.input_tokens)
      : 0;
  const rawOutputTokens = hasCompletionTokens
    ? parseNumericTokenValue(usageData.completion_tokens ?? usageData.candidatesTokenCount)
    : hasOutputTokens
      ? parseNumericTokenValue(usageData.output_tokens)
      : 0;
  const rawTotalTokens = hasTotalTokens
    ? parseNumericTokenValue(usageData.total_tokens ?? usageData.totalTokenCount)
    : 0;

  const normalizedTokens = normalizeTokenBreakdown(rawInputTokens, rawOutputTokens, rawTotalTokens);

  // Upstream providers may return both aggregate and structured cache fields for the same usage.
  // Use max/priority semantics to avoid counting aliases twice.
  const cacheCreationBucketTokens = sumNonNegativeTokenValues(
    usageData.claude_cache_creation_5_m_tokens,
    usageData.claude_cache_creation_1_h_tokens,
  );
  const cacheCreationStructuredTokens = sumNonNegativeTokenValues(
    cacheCreationData.ephemeral_5m_input_tokens,
    cacheCreationData.ephemeral_1h_input_tokens,
  );
  const cacheCreationTokens = maxNonNegativeTokenValues(
    usageData.cache_creation_input_tokens,
    cacheCreationBucketTokens,
    cacheCreationStructuredTokens,
  );

  const cacheReadBucketTokens = sumNonNegativeTokenValues(
    usageData.claude_cache_read_5_m_tokens,
    usageData.claude_cache_read_1_h_tokens,
  );
  const cacheReadStructuredTokens = sumNonNegativeTokenValues(
    cacheReadData.ephemeral_5m_input_tokens,
    cacheReadData.ephemeral_1h_input_tokens,
  );
  const cacheReadAliasTokens = maxNonNegativeTokenValues(
    usageData.cache_read_input_tokens,
    promptTokenDetails.cached_tokens,
    inputTokenDetails.cached_tokens,
    usageData.cached_tokens,
    usageData.prompt_cache_hit_tokens,
    usageData.cachedContentTokenCount,
  );
  const cacheReadTokens = maxNonNegativeTokenValues(
    cacheReadAliasTokens,
    cacheReadBucketTokens,
    cacheReadStructuredTokens,
  );

  return {
    inputTokens: normalizedTokens.inputTokens,
    outputTokens: normalizedTokens.outputTokens,
    requestTokens: normalizedTokens.requestTokens,
    responseTokens: normalizedTokens.responseTokens,
    totalTokens: normalizedTokens.totalTokens,
    cacheCreationTokens,
    cacheReadTokens,
  };
};
