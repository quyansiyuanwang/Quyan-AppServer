import type { EnvSnapshot } from "./source";

const KIB = 1024;
const MIB = KIB * KIB;

/** Deployment budgets: explicit invalid settings must not silently fall back or clamp. */
export function resourceInteger(source: EnvSnapshot, key: string, fallback: number, min = 1, max = 2147483647): number {
  const raw = source[key];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${key} must be an integer between ${min} and ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  return value;
}

export function buildAiResourcesConfig(source: EnvSnapshot) {
  const integer = (key: string, fallback: number, min = 1, max = 2147483647) =>
    resourceInteger(source, key, fallback, min, max);
  const highWatermarkBytes = integer("AI_RSS_HIGH_WATERMARK_MB", 512) * MIB;
  const resumeWatermarkBytes = integer("AI_RSS_RESUME_WATERMARK_MB", 448) * MIB;
  if (resumeWatermarkBytes >= highWatermarkBytes)
    throw new Error("AI_RSS_RESUME_WATERMARK_MB must be less than AI_RSS_HIGH_WATERMARK_MB");
  const http = {
    maxSockets: integer("AI_HTTP_MAX_SOCKETS", 4),
    maxTotalSockets: integer("AI_HTTP_MAX_TOTAL_SOCKETS", 8),
    maxFreeSockets: integer("AI_HTTP_MAX_FREE_SOCKETS", 1),
  };
  if (http.maxTotalSockets < http.maxSockets || http.maxFreeSockets > http.maxSockets)
    throw new Error("AI HTTP limits require maxFreeSockets <= maxSockets <= maxTotalSockets");
  return {
    maxActiveRequests: integer("AI_MAX_ACTIVE_REQUESTS", 3),
    maxQueuedRequests: integer("AI_MAX_QUEUED_REQUESTS", 4, 0),
    queueTimeoutMs: integer("AI_QUEUE_TIMEOUT_MS", 10000),
    memory: {
      sampleIntervalMs: integer("AI_MEMORY_SAMPLE_INTERVAL_MS", 1000),
      highWatermarkBytes,
      resumeWatermarkBytes,
    },
    streaming: {
      frameLimitBytes: integer("AI_SSE_TEXT_FRAME_LIMIT_KB", 1024) * KIB,
      retainedLimitBytes: integer("AI_SSE_CONVERSION_RETAINED_LIMIT_KB", 128) * KIB,
      maxBlocks: integer("AI_SSE_CONVERSION_MAX_BLOCKS", 128),
      outputLimitBytes: integer("AI_TEXT_OUTPUT_LIMIT_KB", 512) * KIB,
    },
    http,
  };
}

export function buildChatResourceConfig(source: EnvSnapshot) {
  return {
    resourceLimits: {
      inputLimitBytes: resourceInteger(source, "CHAT_INPUT_LIMIT_KB", 64) * KIB,
      outputLimitBytes: resourceInteger(source, "CHAT_OUTPUT_LIMIT_KB", 60) * KIB,
      contextMaxMessages: resourceInteger(source, "CHAT_CONTEXT_MAX_MESSAGES", 200, 0),
      contextLimitBytes: resourceInteger(source, "CHAT_CONTEXT_LIMIT_KB", 512) * KIB,
    },
  };
}

export function buildAiRequestLogConfig(source: EnvSnapshot) {
  return {
    requestBodyBytes: resourceInteger(source, "AI_REQUEST_LOG_REQUEST_BODY_LIMIT_KB", 64) * KIB,
    responseBodyBytes: resourceInteger(source, "AI_REQUEST_LOG_RESPONSE_BODY_LIMIT_KB", 256) * KIB,
    writeConcurrency: resourceInteger(source, "AI_REQUEST_LOG_WRITE_CONCURRENCY", 2),
    queueMaxItems: resourceInteger(source, "AI_REQUEST_LOG_QUEUE_MAX_ITEMS", 128),
    queueMaxBytes: resourceInteger(source, "AI_REQUEST_LOG_QUEUE_MAX_MB", 8) * MIB,
  };
}
