/** MySQL TEXT is a storage contract, not a deployment tuning policy. No schema migration in this change. */
export const CHAT_MESSAGE_STORAGE_LIMIT_BYTES = 65535;

/** Existing Chat default for Anthropic's required output cap, including relay conversions. */
export const CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS = 4096;
