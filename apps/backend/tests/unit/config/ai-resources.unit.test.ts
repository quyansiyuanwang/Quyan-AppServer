import fs from "node:fs";
import path from "node:path";
import { EnvironmentSource } from "@/config/env/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiResourcesConfig, buildChatResourceConfig, buildAiRequestLogConfig } from "@/config/env/ai-resources";
import { buildRuntimeConfig } from "@/config/env/runtime";
import { buildRelayConfig } from "@/config/env/infrastructure";

describe("AI deployment budgets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses existing environment-file priority and snapshots each budget", () => {
    vi.stubEnv("AI_MAX_ACTIVE_REQUESTS", "9");
    vi.stubEnv("ENV_FILE_PATH", "");
    vi.spyOn(fs, "existsSync").mockImplementation((file) =>
      [".env", ".env.test"].includes(path.basename(String(file))),
    );
    vi.spyOn(fs, "readFileSync").mockImplementation((file) =>
      Buffer.from(
        path.basename(String(file)) === ".env.test"
          ? "AI_MAX_ACTIVE_REQUESTS=7"
          : "AI_MAX_ACTIVE_REQUESTS=5\nAI_MAX_QUEUED_REQUESTS=2",
      ),
    );
    vi.stubEnv("NODE_ENV", "production");
    const production = new EnvironmentSource();
    const snapshot = new Proxy({}, { get: (_, key) => production.read(String(key)) });
    expect(buildAiResourcesConfig(snapshot).maxActiveRequests).toBe(9);
    expect(buildAiResourcesConfig(snapshot).maxQueuedRequests).toBe(2);
    vi.stubEnv("AI_MAX_ACTIVE_REQUESTS", "11");
    expect(buildAiResourcesConfig(snapshot).maxActiveRequests).toBe(9);
    production.dispose();
    vi.stubEnv("NODE_ENV", "test");
    const test = new EnvironmentSource();
    expect(buildAiResourcesConfig(new Proxy({}, { get: (_, key) => test.read(String(key)) })).maxActiveRequests).toBe(
      7,
    );
    test.dispose();
  });

  it("supplies the documented low-memory defaults", () => {
    const config = buildAiResourcesConfig({});
    expect(config.maxActiveRequests).toBe(3);
    expect(config.maxQueuedRequests).toBe(4);
    expect(config.memory.highWatermarkBytes).toBe(512 * 1024 * 1024);
    expect(buildChatResourceConfig({}).resourceLimits.outputLimitBytes).toBe(60 * 1024);
    expect(buildAiRequestLogConfig({}).responseBodyBytes).toBe(256 * 1024);
    expect(buildRelayConfig({}).resourceGuard.maxUpstreamResponseBodyMb).toBe(16);
  });
  it("honors larger explicit budgets without hidden clamps and supports no queue", () => {
    const config = buildAiResourcesConfig({
      AI_MAX_ACTIVE_REQUESTS: "20",
      AI_MAX_QUEUED_REQUESTS: "0",
      AI_SSE_TEXT_FRAME_LIMIT_KB: "4096",
    });
    expect(config.maxActiveRequests).toBe(20);
    expect(config.maxQueuedRequests).toBe(0);
    expect(config.streaming.frameLimitBytes).toBe(4096 * 1024);
    expect(buildAiRequestLogConfig({ AI_REQUEST_LOG_RESPONSE_BODY_LIMIT_KB: "4096" }).responseBodyBytes).toBe(
      4096 * 1024,
    );
    expect(
      buildRelayConfig({ RELAY_MAX_UPSTREAM_RESPONSE_BODY_MB: "128" }).resourceGuard.maxUpstreamResponseBodyMb,
    ).toBe(128);
  });
  it.each(["", "3.5", "-1", "12oops", "Infinity", "0"])("rejects invalid active budget %s", (value) => {
    expect(() => buildAiResourcesConfig({ AI_MAX_ACTIVE_REQUESTS: value })).toThrow("AI_MAX_ACTIVE_REQUESTS");
  });
  it("validates related thresholds and pool settings", () => {
    expect(() => buildAiResourcesConfig({ AI_RSS_RESUME_WATERMARK_MB: "512" })).toThrow("AI_RSS_RESUME");
    expect(() => buildAiResourcesConfig({ AI_HTTP_MAX_SOCKETS: "20" })).toThrow("AI HTTP");
    expect(() => buildAiResourcesConfig({ AI_HTTP_MAX_FREE_SOCKETS: "5" })).toThrow("AI HTTP");
    expect(() => buildRuntimeConfig({ PORT: "10001", NODE_ENV: "test", REQUEST_JSON_BODY_LIMIT_MB: "bad" })).toThrow(
      "REQUEST_JSON_BODY_LIMIT_MB",
    );
    expect(
      buildRuntimeConfig({ PORT: "10001", NODE_ENV: "test", REQUEST_JSON_BODY_LIMIT_MB: "20" }).requestSizeLimits
        .jsonBodyLimitMb,
    ).toBe(20);
    expect(() => buildRelayConfig({ RELAY_IMAGE_MAX_CONCURRENCY: "bad" })).toThrow("RELAY_IMAGE_MAX_CONCURRENCY");
  });
});
