import type { Response } from "express";
import { randomUUID } from "crypto";
import {
  AI_REQUEST_LOG_LIMITS,
  type AIRequestLogAuthState,
  type AIRequestLogOutcome,
  type AIRequestLogStage,
  type AIRequestLogOmissionReason,
} from "@/constant/ai-request-log";
import type { AIRequestLogAttemptDto } from "@/api/dto/relay/ai-request-log.dto";
import { auditUtf8Slice, safeAttemptExcerpt } from "@/util/ai-request-log-payload";

export interface AIRequestLogAuditContext {
  requestId?: string;
  userId?: string | null;
  username?: string | null;
  relayTokenId?: string | null;
  relayTokenName?: string | null;
  model?: string | null;
  requestFormat?: string | null;
  authenticationState?: AIRequestLogAuthState;
  outcome?: AIRequestLogOutcome;
  failureStage?: AIRequestLogStage | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  bodyOmissionReason?: AIRequestLogOmissionReason | null;
  isStreaming?: boolean;
  executionPending?: boolean;
  attempts?: AIRequestLogAttemptDto[];
  attemptsTruncated?: boolean;
}
const AI_REQUEST_LOG_CONTEXT_KEY = "aiRequestLogContext";
const observers = new WeakMap<Response, () => void>();
const attemptRecorded = new WeakMap<Response, boolean>();
export function beginAIRequestAttempt(response: Response | undefined): void {
  if (response) attemptRecorded.set(response, false);
}
export function hasAIRequestAttempt(response: Response | undefined): boolean {
  return Boolean(response && attemptRecorded.get(response));
}
function localsFor(response: Response | undefined): Response["locals"] | undefined {
  if (!response || (typeof response !== "object" && typeof response !== "function")) return undefined;
  try {
    return response.locals ?? (response.locals = {});
  } catch {
    return undefined;
  }
}
export function setAIRequestLogContext(response: Response | undefined, patch: AIRequestLogAuditContext): void {
  const locals = localsFor(response);
  if (!locals || !response) return;
  const existing = locals[AI_REQUEST_LOG_CONTEXT_KEY] as AIRequestLogAuditContext | undefined;
  // Attempt failures don't set logical outcome. Once final failure is observed, late success cannot erase it.
  if (existing && (existing.outcome === "failed" || existing.outcome === "interrupted") && patch.outcome === "success")
    patch = {
      ...patch,
      outcome: existing.outcome,
      failureStage: existing.failureStage,
      errorCode: existing.errorCode,
      errorSummary: existing.errorSummary,
    };
  locals[AI_REQUEST_LOG_CONTEXT_KEY] = { ...existing, ...patch };
  observers.get(response)?.();
}
export function getAIRequestLogContext(response: Response | undefined): AIRequestLogAuditContext | undefined {
  const context = response?.locals?.[AI_REQUEST_LOG_CONTEXT_KEY];
  return context && typeof context === "object" ? (context as AIRequestLogAuditContext) : undefined;
}
export function observeAIRequestLogContext(response: Response, observer: () => void): void {
  observers.set(response, observer);
}
export function ensureAIRequestLogId(response: Response | undefined): string {
  const existing = getAIRequestLogContext(response)?.requestId;
  if (existing) return existing;
  const id = randomUUID();
  setAIRequestLogContext(response, { requestId: id });
  return id;
}
export function recordAIRequestAttempt(
  response: Response | undefined,
  input: { success: boolean; statusCode?: number; durationMs?: number; stage?: AIRequestLogStage; error?: unknown },
): void {
  const context = getAIRequestLogContext(response);
  if (!context) return;
  if (response) attemptRecorded.set(response, true);
  const attempts = context.attempts ?? [];
  if (attempts.length >= AI_REQUEST_LOG_LIMITS.attemptRecords) {
    setAIRequestLogContext(response, { attemptsTruncated: true });
    return;
  }
  const usedBytes = attempts.reduce((sum, item) => sum + Buffer.byteLength(item.errorExcerpt ?? ""), 0);
  const available = Math.max(
    0,
    Math.min(AI_REQUEST_LOG_LIMITS.attemptErrorBytes, AI_REQUEST_LOG_LIMITS.totalAttemptErrorBytes - usedBytes),
  );
  const full = input.success ? "" : safeAttemptExcerpt(input.error ?? "Upstream request failed");
  const errorExcerpt = auditUtf8Slice(full, 0, available).text;
  const truncated = Buffer.byteLength(full) > available;
  setAIRequestLogContext(response, {
    attempts: [
      ...attempts,
      {
        sequence: attempts.length + 1,
        stage: input.stage ?? "upstream",
        success: input.success,
        statusCode: input.statusCode ?? null,
        durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
        errorExcerpt: errorExcerpt || null,
        errorTruncated: truncated,
      },
    ],
    attemptsTruncated: context.attemptsTruncated || truncated,
  });
}
export function recordAIRequestFailure(
  response: Response | undefined,
  error: unknown,
  stage?: AIRequestLogStage,
): void {
  const context = getAIRequestLogContext(response);
  if (!context) return;
  const descriptor = error as
    | { name?: string; code?: unknown; statusCode?: number; messageKey?: string; type?: string }
    | undefined;
  let safeStage = stage ?? context.failureStage ?? "upstream";
  const key = descriptor?.messageKey ?? "";
  if (key.startsWith("relayToken.")) safeStage = "authentication";
  else if (/invalidJson|modelRequired|endpointPathRequired|unsupportedRequestPath/.test(key)) safeStage = "request";
  else if (/balance|quota|pricing|channel|modelNotIn/i.test(key) && safeStage !== "settlement") safeStage = "routing";
  else if (descriptor?.name === "ContentSafetyBlockedError") safeStage = "content-safety";
  if (descriptor?.name === "AbortError" || descriptor?.code === "ERR_CANCELED") safeStage = "client";
  const code =
    key ||
    (typeof descriptor?.code === "string" && /^[A-Z_]{1,40}$/.test(descriptor.code)
      ? descriptor.code
      : "request_failed");
  setAIRequestLogContext(response, {
    outcome: descriptor?.name === "AbortError" || descriptor?.code === "ERR_CANCELED" ? "interrupted" : "failed",
    failureStage: safeStage,
    errorCode: code.slice(0, 100),
    errorSummary: "Request failed during " + safeStage,
    ...(safeStage === "authentication" ? { authenticationState: "rejected" as const } : {}),
    ...(safeStage === "request" && (/invalidJson/.test(key) || descriptor?.type === "entity.parse.failed")
      ? { bodyOmissionReason: "invalid-body" as const }
      : {}),
  });
}
