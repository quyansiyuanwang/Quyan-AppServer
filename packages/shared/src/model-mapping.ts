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
 * Check if a model name matches a pattern that may contain `*` and `?` wildcards.
 * Dynamic programming bounds time to O(modelName.length * pattern.length) and
 * space to O(pattern.length), avoiding regex backtracking on user-owned patterns.
 * Like the previous non-Unicode, non-dotAll regex, wildcards consume UTF-16 code
 * units except LF, CR, U+2028 and U+2029. All other pattern characters are literal.
 */
export function matchesModelPattern(modelName: string, pattern: string): boolean {
  if (!/[?*]/.test(pattern)) return modelName === pattern
  let previous = new Uint8Array(pattern.length + 1)
  let current = new Uint8Array(pattern.length + 1)
  previous[0] = 1
  for (let index = 1; index <= pattern.length; index++)
    previous[index] = pattern.charAt(index - 1) === '*' ? previous[index - 1]! : 0
  for (let modelIndex = 0; modelIndex < modelName.length; modelIndex++) {
    const character = modelName.charAt(modelIndex)
    const wildcardCanConsume =
      character !== '\n' && character !== '\r' && character !== '\u2028' && character !== '\u2029'
    current[0] = 0
    for (let index = 1; index <= pattern.length; index++) {
      const part = pattern.charAt(index - 1)
      current[index] = Number(
        part === '*'
          ? current[index - 1] === 1 || (wildcardCanConsume && previous[index] === 1)
          : previous[index - 1] === 1 && (part === '?' ? wildcardCanConsume : part === character),
      )
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[pattern.length] === 1
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
  const tokenResult = lookupMapping(requestedModel, tokenModelMapping)
  if (tokenResult !== undefined) return tokenResult

  // Channel-level mapping is fallback (exact match, then wildcard)
  const channelResult = lookupMapping(requestedModel, channelModelMapping)
  if (channelResult !== undefined) return channelResult

  // No mapping found, use original model
  return requestedModel
}

/**
 * Count the number of literal (non-wildcard) characters in a pattern.
 * Used to determine specificity when multiple patterns match.
 */
function countLiteralChars(pattern: string): number {
  let count = 0
  for (let i = 0; i < pattern.length; i++) if (pattern[i] !== '*' && pattern[i] !== '?') count++
  return count
}

/**
 * Rules that take precedence over a wildcard, in their original insertion order.
 * Keep unavailable targets in `patterns`: they still shadow lower-priority rules.
 * Exact rules always win; wildcard ties are resolved by insertion order.
 */
export function getHigherPriorityModelPatterns(
  pattern: string,
  patterns: readonly string[],
): string[] {
  if (!/[?*]/.test(pattern)) return []
  const score = countLiteralChars(pattern)
  const position = patterns.indexOf(pattern)
  return [
    ...new Set(
      patterns.filter((candidate, index) => {
        if (candidate === pattern) return false
        if (!/[?*]/.test(candidate)) return true
        const candidateScore = countLiteralChars(candidate)
        return candidateScore > score || (candidateScore === score && index < position)
      }),
    ),
  ]
}

/**
 * Look up a model in the mapping. Tries exact match first, then wildcard patterns.
 * When multiple wildcard patterns match, the one with the most literal characters wins
 * (more specific patterns take priority). Ties preserve insertion order.
 * Returns the mapped model name if found, or undefined.
 */
function lookupMapping(
  requestedModel: string,
  mapping?: Record<string, string> | null,
): string | undefined {
  if (!mapping) return undefined

  // 1. Exact match (fast path)
  if (requestedModel in mapping) return mapping[requestedModel]

  // 2. Wildcard pattern match — collect all matches, pick most specific
  let bestMatch: string | undefined
  let bestScore = -1
  for (const [pattern, mappedModel] of Object.entries(mapping))
    if (matchesModelPattern(requestedModel, pattern)) {
      const score = countLiteralChars(pattern)
      if (score > bestScore) {
        bestScore = score
        bestMatch = mappedModel
      }
    }

  return bestMatch
}

export type RelayTokenModelMappingPreference = 'mapping-first' | 'original-first'

export interface RelayTokenModelMappingRule {
  source: string
  target: string
  /** Omitted or empty means global; otherwise applies to matching route ancestors or leaf. */
  channelIds?: string[]
  preference: RelayTokenModelMappingPreference
}

export const RELAY_TOKEN_MODEL_MAPPING_LIMITS = {
  maxRules: 100,
  maxPatternLength: 200,
  maxTargetLength: 200,
  maxChannelIds: 100,
} as const

export type RelayTokenModelMappingDiagnosticCode =
  | 'invalid-rules'
  | 'too-many-rules'
  | 'invalid-rule'
  | 'invalid-source'
  | 'invalid-target'
  | 'invalid-preference'
  | 'invalid-channel-ids'
  | 'duplicate-source'
  | 'overlapping-patterns'

export interface RelayTokenModelMappingDiagnostic {
  severity: 'error' | 'warning'
  code: RelayTokenModelMappingDiagnosticCode
  /** -1 indicates a diagnostic about the entire collection. */
  ruleIndex: number
  otherRuleIndex?: number
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseMappingValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/**
 * Read stored rules or a legacy source -> target object (including serialized JSON).
 * Only a missing/null rules value falls back to legacy; [] explicitly clears it.
 * Invalid input returns [], without falling back or widening a malformed channel scope.
 * Validate writes separately to report errors rather than silently discarding them.
 * Legacy records trim names and discard malformed entries. Explicit rule arrays
 * preserve literal model names, whitespace and case and fail closed on invalid rows.
 */
export function normalizeRelayTokenModelMappingRules(
  value: unknown,
  legacy?: unknown,
): RelayTokenModelMappingRule[] {
  let input = parseMappingValue(value)
  if (input === undefined || input === null) input = parseMappingValue(legacy)
  if (input === undefined || input === null) return []
  if (isRecord(input))
    input = Object.entries(input).flatMap(([source, target]) =>
      typeof target === 'string' && source.trim() && target.trim()
        ? [{ source: source.trim(), target: target.trim(), preference: 'mapping-first' }]
        : [],
    )
  if (validateRelayTokenModelMappingRules(input).length > 0) return []
  return (input as RelayTokenModelMappingRule[]).map((rule) => ({
    source: rule.source,
    target: rule.target,
    ...(rule.channelIds?.length ? { channelIds: [...new Set(rule.channelIds)] } : {}),
    preference: rule.preference,
  }))
}

function getRuleChannelPriority(
  rule: RelayTokenModelMappingRule,
  channelPathIds: readonly string[],
): number {
  if (!rule.channelIds?.length) return 0
  for (let index = channelPathIds.length - 1; index >= 0; index--) {
    const channelId = channelPathIds[index]
    if (channelId !== undefined && rule.channelIds.includes(channelId)) return index + 1
  }
  return -1
}

/**
 * channelPathIds runs from root to leaf. Scope takes priority over pattern specificity;
 * exact > wildcard literal count > input order breaks ties within the same scope depth.
 * The winner shadows lower rules even when its preferred target is unavailable.
 */
export function getMatchingRelayTokenModelMappingRules(
  requestedModel: string,
  rules: readonly RelayTokenModelMappingRule[],
  channelPathIds: readonly string[] = [],
): RelayTokenModelMappingRule[] {
  return rules
    .map((rule, index) => ({
      rule,
      index,
      depth: getRuleChannelPriority(rule, channelPathIds),
      exact: !/[?*]/.test(rule.source),
      literals: countLiteralChars(rule.source),
    }))
    .filter(({ rule, depth }) => depth >= 0 && matchesModelPattern(requestedModel, rule.source))
    .sort(
      (left, right) =>
        right.depth - left.depth ||
        Number(right.exact) - Number(left.exact) ||
        right.literals - left.literals ||
        left.index - right.index,
    )
    .map(({ rule }) => rule)
}

export function getMatchingRelayTokenModelMappingRule(
  requestedModel: string,
  rules: readonly RelayTokenModelMappingRule[],
  channelPathIds: readonly string[] = [],
): RelayTokenModelMappingRule | undefined {
  return getMatchingRelayTokenModelMappingRules(requestedModel, rules, channelPathIds)[0]
}

export const selectRelayTokenModelMappingRule = getMatchingRelayTokenModelMappingRule

/** Names in availability-check order. Targets are literals, not wildcard substitutions. */
export function getRelayTokenModelMappingTargetCandidates(
  requestedModel: string,
  rule?: RelayTokenModelMappingRule | null,
): string[] {
  if (!rule) return [requestedModel]
  return [
    ...new Set(
      rule.preference === 'original-first'
        ? [requestedModel, rule.target]
        : [rule.target, requestedModel],
    ),
  ]
}

/**
 * Decide glob-language intersection by reachability in the product of two automata.
 * A star has an epsilon edge to its successor and a consuming edge back to itself;
 * a question mark consumes one character. No example strings or alphabet sampling.
 * Time and space are O(left.length * right.length), including adversarial star runs.
 */
export function doModelPatternsOverlap(left: string, right: string): boolean {
  // Collapsing adjacent stars preserves the language and reduces the state space.
  left = left.replace(/\*+/g, '*')
  right = right.replace(/\*+/g, '*')
  const width = right.length + 1
  const seen = new Uint8Array((left.length + 1) * width)
  const pending: number[] = []
  const enqueue = (leftIndex: number, rightIndex: number): void => {
    const state = leftIndex * width + rightIndex
    if (seen[state]) return
    seen[state] = 1
    pending.push(state)
  }
  enqueue(0, 0)
  while (pending.length) {
    const state = pending.pop()!
    const leftIndex = Math.floor(state / width)
    const rightIndex = state % width
    if (leftIndex === left.length && rightIndex === right.length) return true
    const a = left[leftIndex]
    const b = right[rightIndex]
    if (a === '*') enqueue(leftIndex + 1, rightIndex)
    if (b === '*') enqueue(leftIndex, rightIndex + 1)
    if (a === undefined || b === undefined) continue
    const aWildcard = a === '*' || a === '?'
    const bWildcard = b === '*' || b === '?'
    // Match the existing regex wildcard semantics: dot excludes line terminators.
    const compatible =
      a === b ||
      (aWildcard && (bWildcard || !/[\n\r\u2028\u2029]/.test(b))) ||
      (bWildcard && !/[\n\r\u2028\u2029]/.test(a))
    if (compatible)
      enqueue(a === '*' ? leftIndex : leftIndex + 1, b === '*' ? rightIndex : rightIndex + 1)
  }
  return false
}

function haveSamePriorityChannelScope(
  left: RelayTokenModelMappingRule,
  right: RelayTokenModelMappingRule,
): boolean {
  if (!left.channelIds?.length || !right.channelIds?.length)
    return !left.channelIds?.length && !right.channelIds?.length
  return left.channelIds.some((channelId) => right.channelIds!.includes(channelId))
}

/**
 * Validate raw rule arrays and report intersecting patterns as advisory diagnostics.
 * Equal sources are errors only where they can have the same channel priority.
 * No channel tree is required; disjoint scoped IDs are treated as independent scopes.
 */
export function analyzeRelayTokenModelMappingRules(
  value: unknown,
): RelayTokenModelMappingDiagnostic[] {
  return getRelayTokenModelMappingDiagnostics(value, true)
}

function getRelayTokenModelMappingDiagnostics(
  value: unknown,
  includeOverlaps: boolean,
): RelayTokenModelMappingDiagnostic[] {
  const diagnostics: RelayTokenModelMappingDiagnostic[] = []
  const error = (
    code: RelayTokenModelMappingDiagnosticCode,
    ruleIndex: number,
    message: string,
    otherRuleIndex?: number,
  ): void => {
    diagnostics.push({
      severity: 'error',
      code,
      ruleIndex,
      message,
      ...(otherRuleIndex === undefined ? {} : { otherRuleIndex }),
    })
  }
  if (!Array.isArray(value)) {
    error('invalid-rules', -1, 'Model mapping rules must be an array.')
    return diagnostics
  }
  if (value.length > RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxRules) {
    error(
      'too-many-rules',
      -1,
      `At most ${RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxRules} model mapping rules are allowed.`,
    )
    return diagnostics
  }
  const valid: { rule: RelayTokenModelMappingRule; index: number }[] = []
  // Use a numeric loop so sparse array holes are rejected too.
  for (let index = 0; index < value.length; index++) {
    const rule: unknown = value[index]
    if (!isRecord(rule)) {
      error('invalid-rule', index, 'Each model mapping rule must be an object.')
      continue
    }
    const before = diagnostics.length
    if (
      typeof rule.source !== 'string' ||
      !rule.source.trim() ||
      rule.source.length > RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxPatternLength
    )
      error(
        'invalid-source',
        index,
        `Source must be a non-empty pattern of at most ${RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxPatternLength} characters.`,
      )
    if (
      typeof rule.target !== 'string' ||
      !rule.target.trim() ||
      rule.target.length > RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxTargetLength
    )
      error(
        'invalid-target',
        index,
        `Target must be a non-empty model name of at most ${RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxTargetLength} characters.`,
      )
    if (rule.preference !== 'mapping-first' && rule.preference !== 'original-first')
      error('invalid-preference', index, 'Preference must be mapping-first or original-first.')
    if (
      rule.channelIds !== undefined &&
      (!Array.isArray(rule.channelIds) ||
        rule.channelIds.length > RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxChannelIds ||
        Array.from(rule.channelIds).some((id: unknown) => typeof id !== 'string' || !id.trim()))
    )
      error(
        'invalid-channel-ids',
        index,
        `Channel IDs must be an array of at most ${RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxChannelIds} non-empty strings.`,
      )
    if (before === diagnostics.length)
      valid.push({ rule: rule as unknown as RelayTokenModelMappingRule, index })
  }
  for (const [index, { rule, index: ruleIndex }] of valid.entries()) {
    for (const [other, { rule: previous, index: otherRuleIndex }] of valid.entries()) {
      if (other >= index) break
      const samePriorityScope = haveSamePriorityChannelScope(rule, previous)
      if (rule.source === previous.source) {
        if (samePriorityScope)
          error(
            'duplicate-source',
            ruleIndex,
            'Duplicate sources cannot share a channel priority and scope.',
            otherRuleIndex,
          )
        continue
      }
      if (!includeOverlaps) continue
      if (!samePriorityScope && rule.channelIds?.length && previous.channelIds?.length) continue
      if (doModelPatternsOverlap(rule.source, previous.source))
        diagnostics.push({
          severity: 'warning',
          code: 'overlapping-patterns',
          ruleIndex,
          otherRuleIndex,
          message:
            'Source patterns overlap; route depth, specificity and rule order select the winner.',
        })
    }
  }
  return diagnostics
}

/** Errors only; overlaps between different sources are allowed. */
export function validateRelayTokenModelMappingRules(
  value: unknown,
): RelayTokenModelMappingDiagnostic[] {
  return getRelayTokenModelMappingDiagnostics(value, false)
}
