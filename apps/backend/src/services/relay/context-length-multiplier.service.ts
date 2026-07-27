export interface ContextLengthMultiplierRule {
  name: string;
  enabled: boolean;
  minTokens: number;
  multiplier: number;
}

export interface ContextLengthMultiplierMatch {
  contextTokens: number;
  multiplier: number;
  ruleName?: string;
}

/** Resolves the single highest eligible threshold; tiers never accumulate. */
export const resolveContextLengthMultiplier = (
  rules: ContextLengthMultiplierRule[] | null | undefined,
  contextTokens: number,
): ContextLengthMultiplierMatch => {
  const normalizedContextTokens = Math.max(0, Math.floor(Number(contextTokens) || 0));
  const matchedRule = (rules ?? [])
    .filter(
      (rule) =>
        rule?.enabled === true &&
        Number.isFinite(rule.minTokens) &&
        Number.isFinite(rule.multiplier) &&
        rule.minTokens <= normalizedContextTokens,
    )
    .sort((left, right) => right.minTokens - left.minTokens)[0];

  return {
    contextTokens: normalizedContextTokens,
    multiplier: matchedRule ? Number(matchedRule.multiplier) : 1,
    ruleName: matchedRule?.name || undefined,
  };
};
