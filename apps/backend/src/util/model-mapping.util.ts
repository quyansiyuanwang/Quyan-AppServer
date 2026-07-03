/**
 * Model mapping utility.
 *
 * Resolves model mapping from channel-level and token-level configurations.
 * Priority: token mapping > channel mapping > original model (pass-through).
 *
 * Supports wildcard patterns in mapping keys:
 *   - `*` matches any sequence of characters
 *   - `?` matches any single character
 *
 * Format: { "requestModel": "billingModel" }
 * Example: { "gpt-4": "gpt-4o-mini", "gpt-*": "gpt-4o", "claude-?" : "claude-haiku" }
 *
 * Matching order: exact match first, then wildcard patterns scored by specificity.
 * When multiple wildcard patterns match, the one with the most literal (non-wildcard)
 * characters wins. If scores are tied, insertion order is preserved.
 */

/**
 * Convert a glob-style pattern to a RegExp for matching.
 * Escapes special regex chars, then converts `*` → `.*` and `?` → `.`.
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`);
}

/**
 * Check if a model name matches a pattern that may contain `*` and `?` wildcards.
 */
export function matchesModelPattern(modelName: string, pattern: string): boolean {
  return patternToRegex(pattern).test(modelName);
}

/**
 * Resolve the effective model name for billing purposes.
 * First checks exact key match, then iterates entries in order for wildcard matching.
 * Token-level mapping takes precedence over channel-level mapping.
 *
 * @param requestedModel - The model name from the original request
 * @param channelModelMapping - The channel-level model mapping (optional)
 * @param tokenModelMapping - The token-level model mapping (optional)
 * @returns The effective model name to use for billing
 */
export function resolveMappedModel(
  requestedModel: string,
  channelModelMapping?: Record<string, string> | null,
  tokenModelMapping?: Record<string, string> | null,
): string {
  // Check token-level mapping first (exact match, then wildcard)
  const tokenResult = lookupMapping(requestedModel, tokenModelMapping);
  if (tokenResult !== undefined) return tokenResult;

  // Channel-level mapping is fallback (exact match, then wildcard)
  const channelResult = lookupMapping(requestedModel, channelModelMapping);
  if (channelResult !== undefined) return channelResult;

  // No mapping found, use original model
  return requestedModel;
}

/**
 * Count the number of literal (non-wildcard) characters in a pattern.
 * Used to determine specificity when multiple patterns match.
 */
function countLiteralChars(pattern: string): number {
  let count = 0;
  for (let i = 0; i < pattern.length; i++) if (pattern[i] !== "*" && pattern[i] !== "?") count++;
  return count;
}

/**
 * Look up a model in the mapping. Tries exact match first, then wildcard patterns.
 * When multiple wildcard patterns match, the one with the most literal characters wins
 * (more specific patterns take priority). Ties preserve insertion order.
 * Returns the mapped model name if found, or undefined.
 */
function lookupMapping(requestedModel: string, mapping?: Record<string, string> | null): string | undefined {
  if (!mapping) return undefined;

  // 1. Exact match (fast path)
  if (requestedModel in mapping) return mapping[requestedModel];

  // 2. Wildcard pattern match — collect all matches, pick most specific
  let bestMatch: string | undefined;
  let bestScore = -1;
  for (const [pattern, mappedModel] of Object.entries(mapping))
    if (matchesModelPattern(requestedModel, pattern)) {
      const score = countLiteralChars(pattern);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = mappedModel;
      }
    }

  return bestMatch;
}
