import { buildAiResourcesConfig, buildChatResourceConfig, buildAiRequestLogConfig } from "./ai-resources";
import { buildAuthConfig } from "./auth";
import { deepFreeze } from "./common";
import { buildDatabaseConfig } from "./database";
import { buildDiagnostics } from "./diagnostics";
import { buildIntegrationsConfig, buildRateLimitConfig, buildRedisConfig, buildRelayConfig } from "./infrastructure";
import { buildRuntimeConfig } from "./runtime";
import { buildSecurityConfig } from "./security";
import { assertNotRunningFromDist, EnvironmentSource, type EnvSnapshot } from "./source";
import { assertEnvironment } from "./validators";

assertNotRunningFromDist();

const environmentSource = new EnvironmentSource();
let envSnapshot: EnvSnapshot = new Proxy({} as EnvSnapshot, {
  get: (_target, key) => (typeof key === "string" ? environmentSource.read(key) : undefined),
});

assertEnvironment(envSnapshot);

const runtime = buildRuntimeConfig(envSnapshot);
const resolvedEnvironment = {
  runtime,
  // Compatibility fallback only; runtime consumers use AIResourceConfigService.
  legacyAIResourceEnvironmentPresent: [
    "AI_MAX_ACTIVE_REQUESTS",
    "AI_MAX_QUEUED_REQUESTS",
    "AI_QUEUE_TIMEOUT_MS",
    "AI_MEMORY_SAMPLE_INTERVAL_MS",
    "AI_RSS_HIGH_WATERMARK_MB",
    "AI_RSS_RESUME_WATERMARK_MB",
    "AI_SSE_TEXT_FRAME_LIMIT_KB",
    "AI_SSE_CONVERSION_RETAINED_LIMIT_KB",
    "AI_SSE_CONVERSION_MAX_BLOCKS",
    "AI_TEXT_OUTPUT_LIMIT_KB",
    "CHAT_INPUT_LIMIT_KB",
    "CHAT_OUTPUT_LIMIT_KB",
    "CHAT_CONTEXT_MAX_MESSAGES",
    "CHAT_CONTEXT_LIMIT_KB",
    "AI_REQUEST_LOG_REQUEST_BODY_LIMIT_KB",
    "AI_REQUEST_LOG_RESPONSE_BODY_LIMIT_KB",
    "AI_REQUEST_LOG_WRITE_CONCURRENCY",
    "AI_REQUEST_LOG_QUEUE_MAX_ITEMS",
    "AI_REQUEST_LOG_QUEUE_MAX_MB",
    "AI_HTTP_MAX_SOCKETS",
    "AI_HTTP_MAX_TOTAL_SOCKETS",
    "AI_HTTP_MAX_FREE_SOCKETS",
    "RELAY_CHANNEL_PROBE_MAX_CONCURRENCY",
    "RELAY_MULTIPART_BODY_LIMIT_MB",
    "RELAY_IMAGE_MAX_CONCURRENCY",
    "RELAY_IMAGE_QUEUE_TIMEOUT_MS",
    "RELAY_NON_STREAM_UPSTREAM_TIMEOUT_MS",
    "RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB",
    "RELAY_IMAGE_RESPONSE_BODY_LIMIT_MB",
  ].some((key) => envSnapshot[key] !== undefined),
  aiResources: buildAiResourcesConfig(envSnapshot),
  chat: buildChatResourceConfig(envSnapshot),
  aiRequestLog: buildAiRequestLogConfig(envSnapshot),
  database: buildDatabaseConfig(envSnapshot),
  auth: buildAuthConfig(envSnapshot, runtime),
  security: buildSecurityConfig(envSnapshot),
  redis: buildRedisConfig(envSnapshot),
  rateLimit: buildRateLimitConfig(envSnapshot),
  relay: buildRelayConfig(envSnapshot),
  integrations: buildIntegrationsConfig(envSnapshot),
  diagnostics: buildDiagnostics(envSnapshot),
};

// Runtime configuration is immutable. The test runner uses a private process
// and intentionally adjusts the resolved object to model individual settings.
export const env = (runtime.isTest ? resolvedEnvironment : deepFreeze(resolvedEnvironment)) as Readonly<
  typeof resolvedEnvironment
>;

export type Environment = typeof env;

export function createEnvironmentForTests(overrides: Partial<Environment>): Environment {
  return deepFreeze({ ...structuredClone(env), ...overrides }) as Environment;
}

environmentSource.dispose();
envSnapshot = Object.freeze({});
