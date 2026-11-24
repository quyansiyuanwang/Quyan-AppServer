import type { RelayRequestFormat } from "@/util/relay/relay-model-availability.util";

/** DeepSeek tool requests require this field on replayed assistant messages, even when empty. */
export function normalizeDeepSeekReasoningHistory<T>(body: T, format: RelayRequestFormat, upstreamModelId: string): T {
  if (
    format !== "openai-chat-completions" ||
    !/(?:^|\/)deepseek(?:[-_.]|$)/i.test(upstreamModelId) ||
    !body ||
    typeof body !== "object" ||
    Buffer.isBuffer(body) ||
    Array.isArray(body)
  )
    return body;
  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.tools) || !request.tools.length || !Array.isArray(request.messages)) return body;
  let changed = false;
  const messages = request.messages.map((message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const entry = message as Record<string, unknown>;
    if (entry.role !== "assistant" || entry.reasoning_content !== undefined) return message;
    changed = true;
    return { ...entry, reasoning_content: "" };
  });
  // Keep object identity when untouched so the proxy can still reuse raw JSON bytes.
  return changed ? ({ ...request, messages } as T) : body;
}
