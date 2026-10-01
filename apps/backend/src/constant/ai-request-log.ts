export const AI_REQUEST_LOG_PREFIX = "/relay/proxy";

export const AI_REQUEST_LOG_LIMITS = {
  requestBodyBytes: 1024 * 1024,
  responseBodyBytes: 2 * 1024 * 1024,
  contentChunkBytes: 32 * 1024,
  contentPageItems: 20,
  maxPageItems: 100,
  previewBytes: 1024,
  attemptErrorBytes: 16 * 1024,
  totalAttemptErrorBytes: 64 * 1024,
  attemptRecords: 100,
  maxDepth: 12,
} as const;

export const AI_REQUEST_LOG_OUTCOMES = ["pending", "success", "failed", "interrupted"] as const;
export const AI_REQUEST_LOG_STAGES = [
  "authentication",
  "request",
  "routing",
  "upstream",
  "content-safety",
  "settlement",
  "client",
] as const;
export const AI_REQUEST_LOG_AUTH_STATES = ["unknown", "identified", "authenticated", "rejected"] as const;
export const AI_REQUEST_LOG_OMISSION_REASONS = [
  "unknown-identity",
  "invalid-body",
  "request-too-large",
  "not-recorded",
] as const;
export type AIRequestLogOutcome = (typeof AI_REQUEST_LOG_OUTCOMES)[number];
export type AIRequestLogStage = (typeof AI_REQUEST_LOG_STAGES)[number];
export type AIRequestLogAuthState = (typeof AI_REQUEST_LOG_AUTH_STATES)[number];
export type AIRequestLogOmissionReason = (typeof AI_REQUEST_LOG_OMISSION_REASONS)[number];
