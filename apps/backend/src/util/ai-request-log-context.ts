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

export function setAIRequestLogContext(response: Response | undefined, context: AIRequestLogAuditContext): void {
  if (!response) return;
  const existing = response.locals[AI_REQUEST_LOG_CONTEXT_KEY] as AIRequestLogAuditContext | undefined;
  response.locals[AI_REQUEST_LOG_CONTEXT_KEY] = { ...existing, ...context };
}

export function getAIRequestLogContext(response: Response): AIRequestLogAuditContext | undefined {
  const context = response.locals[AI_REQUEST_LOG_CONTEXT_KEY];
  return context && typeof context === "object" ? (context as AIRequestLogAuditContext) : undefined;
}
