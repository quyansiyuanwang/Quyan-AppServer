import type { Response } from "express";

export interface AIRequestLogAuditContext {
  requestId?: string;
  userId?: string | null;
  username?: string | null;
  relayTokenId?: string | null;
  relayTokenName?: string | null;
  model?: string | null;
  requestFormat?: string | null;
}

const AI_REQUEST_LOG_CONTEXT_KEY = "aiRequestLogContext";

function getExistingResponseLocals(response: Response | undefined): Response["locals"] | undefined {
  if (!response || (typeof response !== "object" && typeof response !== "function")) return undefined;

  const locals = (response as { locals?: Response["locals"] }).locals;
  return locals && typeof locals === "object" ? locals : undefined;
}

function ensureResponseLocals(response: Response | undefined): Response["locals"] | undefined {
  const existing = getExistingResponseLocals(response);
  if (existing) return existing;
  if (!response) return undefined;

  try {
    const locals: Response["locals"] = {};
    (response as { locals?: Response["locals"] }).locals = locals;
    return locals;
  } catch {
    return undefined;
  }
}

export function setAIRequestLogContext(response: Response | undefined, context: AIRequestLogAuditContext): void {
  const locals = ensureResponseLocals(response);
  if (!locals) return;

  const existing = locals[AI_REQUEST_LOG_CONTEXT_KEY] as AIRequestLogAuditContext | undefined;
  locals[AI_REQUEST_LOG_CONTEXT_KEY] = { ...existing, ...context };
}

export function getAIRequestLogContext(response: Response): AIRequestLogAuditContext | undefined {
  const locals = getExistingResponseLocals(response);
  if (!locals) return undefined;

  const context = locals[AI_REQUEST_LOG_CONTEXT_KEY];
  return context && typeof context === "object" ? (context as AIRequestLogAuditContext) : undefined;
}
