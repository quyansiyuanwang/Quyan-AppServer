/** Database rule budget shared by legacy validation and native transactional mutations. */
export const CONTENT_SAFETY_RULE_LIMITS = Object.freeze({ maxRules: 500, maxPatternBytes: 1024 * 1024 });
