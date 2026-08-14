import { describe, expect, it, vi } from "vitest";
import {
  assertProbeUsage,
  buildProbeUpstreamEndpoint,
  calculateSuggestedProbeMultiplier,
  createDefaultProbePayload,
  defaultProbeEndpoint,
  finalizeProbeCalibration,
  findProbeOutlierIndexes,
  formatProbeUpstreamError,
  getProbeSchedulingScope,
  getProbeWorkflowHeaders,
  getProbeWorkflowRequestBody,
  injectProbeCacheBuster,
  injectProbeMeasurementInput,
  interpolateRequiredProbeVariables,
  interpolateProbeVariables,
  normalizeProbeNetworkError,
  normalizeProbeEndpoint,
  readProbeJsonPath,
  requiresLargeMultiplierConfirmation,
  resolveProbeModelPricing,
  resolveProbeCustomerFacingTargets,
  resolveAllowedProbeFormats,
  waitForProbeSettlement,
} from "../../src/services/relay/relay-channel-probe.service";
import type { RelayChannelProbeTopologyItem } from "../../src/services/relay/relay-channel-probe.service";
import type { RelayChannelProbeSampleDto } from "../../src/api/dto/relay/relay-channel-probe.dto";

describe("relay channel probe helpers", () => {
  it("requires an independent stable result only for unconfirmed large multiplier changes", () => {
    expect(requiresLargeMultiplierConfirmation(1, 1.1)).toBe(false);
    expect(requiresLargeMultiplierConfirmation(1, 1.5)).toBe(true);
    expect(requiresLargeMultiplierConfirmation(1, 1.5, 1.52)).toBe(false);
    expect(requiresLargeMultiplierConfirmation(1, 1.5, 1.2)).toBe(true);
  });

  it("uses the shared channel format parser for probe endpoint availability", () => {
    expect(resolveAllowedProbeFormats("anthropic")).toEqual(["anthropic"]);
    expect(resolveAllowedProbeFormats("openai, anthropic")).toEqual(["openai-chat-completions", "anthropic"]);
    expect(resolveAllowedProbeFormats("OpenAI, Anthropic")).toEqual(["openai-chat-completions", "anthropic"]);
    expect(resolveAllowedProbeFormats("all")).toEqual([]);
    expect(resolveAllowedProbeFormats("openai-responses")).toEqual(["openai-responses"]);
  });

  it("uses public pooled channel names instead of their standalone upstream members", () => {
    const channels = [
      {
        id: "upstream-account",
        name: "Internal account A",
        enabled: true,
        channelType: "standalone",
      },
      {
        id: "customer-pool",
        name: "Claude Standard",
        enabled: true,
        channelType: "pooled",
        poolMembers: [
          {
            memberChannelId: "upstream-account",
            priority: 0,
            enabled: true,
            memberChannelEnabled: true,
          },
        ],
      },
    ] as RelayChannelProbeTopologyItem[];

    expect(resolveProbeCustomerFacingTargets(channels, "upstream-account")).toEqual([
      { channelId: "customer-pool", channelName: "Claude Standard" },
    ]);
  });

  it("uses the standalone name only when no pooled route represents it", () => {
    const channels = [
      {
        id: "direct-channel",
        name: "Direct API",
        enabled: true,
        channelType: "standalone",
      },
    ] as RelayChannelProbeTopologyItem[];

    expect(resolveProbeCustomerFacingTargets(channels, "direct-channel")).toEqual([
      { channelId: "direct-channel", channelName: "Direct API" },
    ]);
  });

  it("interpolates nested request values without changing other primitives", () => {
    expect(
      interpolateProbeVariables(
        { headers: { Authorization: "Bearer {{token}}" }, items: ["{{user}}", 1] },
        { token: "secret", user: "alice" },
      ),
    ).toEqual({ headers: { Authorization: "Bearer secret" }, items: ["alice", 1] });
  });

  it("inserts a unique cache-buster at the highest prompt level without mutating the configured payload", () => {
    const openai = { messages: [{ role: "user", content: "ping" }] };
    const anthropic = { system: [{ type: "text", text: "existing" }], messages: [] };
    const gemini = { systemInstruction: { parts: [{ text: "existing" }] }, contents: [] };

    expect(injectProbeCacheBuster(openai, "openai", "uuid-openai")).toMatchObject({
      messages: [
        { role: "system", content: "[probe-cache-buster:uuid-openai]" },
        { role: "user", content: "ping" },
      ],
    });
    expect(injectProbeCacheBuster(anthropic, "anthropic", "uuid-anthropic")).toMatchObject({
      system: [
        { type: "text", text: "[probe-cache-buster:uuid-anthropic]" },
        { type: "text", text: "existing" },
      ],
    });
    expect(injectProbeCacheBuster(gemini, "gemini", "uuid-gemini")).toMatchObject({
      systemInstruction: { parts: [{ text: "[probe-cache-buster:uuid-gemini]" }, { text: "existing" }] },
    });
    expect(openai).toEqual({ messages: [{ role: "user", content: "ping" }] });
    expect(anthropic.system).toEqual([{ type: "text", text: "existing" }]);
    expect(gemini.systemInstruction.parts).toEqual([{ text: "existing" }]);
  });

  it("refuses cache busting when the payload has no safe prompt insertion point", () => {
    expect(injectProbeCacheBuster({ input: 1 }, "openai", "uuid", "openai-responses")).toBeUndefined();
    expect(injectProbeCacheBuster({ systemInstruction: "invalid" }, "gemini", "uuid")).toBeUndefined();
  });

  it("creates cache-buster-compatible minimal payloads for every supported endpoint", () => {
    const cases = [
      ["openai", "openai-chat-completions"],
      ["openai", "openai-responses"],
      ["anthropic", "anthropic-messages"],
      ["gemini", "gemini-generate-content"],
    ] as const;

    for (const [format, endpoint] of cases) {
      const payload = createDefaultProbePayload(format, endpoint);
      expect(injectProbeCacheBuster(payload, format, "default-payload", endpoint)).toBeDefined();
    }
  });

  it("rejects an unresolved workflow variable before an upstream request is sent", () => {
    expect(() => interpolateRequiredProbeVariables({ headers: { Authorization: "Bearer {{API_TOKEN}}" } }, {})).toThrow(
      "PROBE_VARIABLE_MISSING:API_TOKEN",
    );
  });

  it("omits an empty balance workflow body for GET requests", () => {
    expect(getProbeWorkflowRequestBody("GET", {})).toBeUndefined();
    expect(getProbeWorkflowRequestBody("HEAD", { ignored: true })).toBeUndefined();
    expect(getProbeWorkflowRequestBody("POST", {})).toBeUndefined();
    expect(getProbeWorkflowRequestBody("POST", { grant_type: "password" })).toEqual({ grant_type: "password" });
  });

  it("removes stale body transport headers from GET balance workflow steps", () => {
    expect(
      getProbeWorkflowHeaders("GET", {
        Authorization: "Bearer token",
        "Content-Length": "2",
        "transfer-encoding": "chunked",
      }),
    ).toEqual({ Authorization: "Bearer token" });
    expect(getProbeWorkflowHeaders("POST", { "Content-Length": "2" })).toEqual({ "Content-Length": "2" });
  });

  it("uses the group as the scheduling scope while leaving ungrouped channels independent", () => {
    expect(getProbeSchedulingScope("channel-a", "Provider-A")).toBe("group:provider-a");
    expect(getProbeSchedulingScope("channel-b", "provider-a")).toBe("group:provider-a");
    expect(getProbeSchedulingScope("channel-a", undefined)).toBe("channel:channel-a");
    expect(getProbeSchedulingScope("channel-b", "")).toBe("channel:channel-b");
  });

  it("uses a mapped model's upstream model ID for the probe request and pricing", () => {
    expect(
      resolveProbeModelPricing("public-model", { "public-*": "billing-model" }, [
        {
          model: "billing-model",
          modelId: "provider-model-id",
          inputPrice: 1,
          outputPrice: 1,
          cacheCreationMultiplier: 1,
          cacheReadMultiplier: 1,
        },
      ]),
    ).toMatchObject({ upstreamModelId: "provider-model-id", rate: { model: "billing-model" } });
  });

  it("normalizes a malformed deployment proxy address without exposing its raw error", () => {
    expect(normalizeProbeNetworkError("Invalid IP address: undefined")).toBe("PROBE_NETWORK_CONFIGURATION_INVALID");
  });

  it("waits for the configured upstream settlement window", async () => {
    vi.useFakeTimers();
    try {
      let completed = false;
      const waiting = waitForProbeSettlement(1_000).then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads common JSONPath forms", () => {
    const source = { data: { balances: [{ amount: 12.5 }] } };
    expect(readProbeJsonPath(source, "$.data.balances[0].amount")).toBe(12.5);
    expect(readProbeJsonPath(source, "data['balances'][0].amount")).toBe(12.5);
  });

  it("rounds valid suggestions and rejects non-comparable values", () => {
    expect(calculateSuggestedProbeMultiplier(0.5, 1.5, 2, 0.3)).toBe(5);
    expect(calculateSuggestedProbeMultiplier(1, 1, 1, 3)).toBe(0.333334);
    expect(calculateSuggestedProbeMultiplier(0, 1.5, 2, 0.3)).toBeUndefined();
    expect(calculateSuggestedProbeMultiplier(1, 0, 1, 0.3)).toBeUndefined();
    expect(calculateSuggestedProbeMultiplier(1, 1, 1, 0)).toBeUndefined();
  });

  it("builds the expected model endpoint from root and versioned upstream base URLs", () => {
    expect(buildProbeUpstreamEndpoint("https://api.example.com", "openai-chat-completions", "gpt-test")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(buildProbeUpstreamEndpoint("https://api.example.com/v1", "openai-chat-completions", "gpt-test")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(buildProbeUpstreamEndpoint("https://generativelanguage.example.com/v1beta", "gemini", "gemini-test")).toBe(
      "https://generativelanguage.example.com/v1beta/models/gemini-test:generateContent",
    );
    expect(
      buildProbeUpstreamEndpoint("https://api.example.com/v1", "openai-responses", "gpt-test", "openai-responses"),
    ).toBe("https://api.example.com/v1/responses");
    expect(defaultProbeEndpoint("anthropic")).toBe("anthropic-messages");
    expect(normalizeProbeEndpoint("openai-chat-completions", "anthropic")).toBe("anthropic-messages");
  });

  it("injects a stable marker into OpenAI Responses input without mutating the payload", () => {
    const payload = { input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }] };
    const injected = injectProbeCacheBuster(payload, "openai", "same-key", "openai-responses");
    expect((injected?.input as unknown[])?.[0]).toEqual({
      role: "developer",
      content: [{ type: "input_text", text: "[probe-cache-buster:same-key]" }],
    });
    expect(payload.input).toHaveLength(1);
  });

  it("adds a measurable text window to every supported default request format", () => {
    const cases = [
      ["openai", "openai-chat-completions"],
      ["openai", "openai-responses"],
      ["anthropic", "anthropic-messages"],
      ["gemini", "gemini-generate-content"],
    ] as const;
    for (const [format, endpoint] of cases) {
      const payload = createDefaultProbePayload(format, endpoint);
      const injected = injectProbeMeasurementInput(payload, format, 128, endpoint);
      expect(injected).toBeDefined();
      expect(JSON.stringify(injected)).toContain("probe-measurement");
      expect(JSON.stringify(payload)).not.toContain("probe-measurement");
    }
  });

  it("keeps opaque custom payloads diagnostic-only instead of rewriting their structure", () => {
    expect(injectProbeMeasurementInput({ tools: [{ type: "function" }] }, "openai", 1024)).toBeUndefined();
  });

  it("discards only statistically large probe multiplier deviations", () => {
    expect([...findProbeOutlierIndexes([1, 1.01, 0.99, 7])]).toEqual([3]);
    expect([...findProbeOutlierIndexes([1, 1.01])]).toEqual([]);
    expect([...findProbeOutlierIndexes([1, 1, 1, 1])]).toEqual([]);
  });

  it("keeps a single comparable sample when strict calibration validation is disabled", () => {
    const samples: RelayChannelProbeSampleDto[] = [
      { index: 1, status: "succeeded", accepted: true, suggestedMultiplier: 1.25 },
    ];

    const result = finalizeProbeCalibration(samples, false);

    expect(result.calibrationStatus).toBe("verified");
    expect(result.accepted).toHaveLength(1);
    expect(result.discardedCount).toBe(0);
  });

  it("uses the established sample count and MAD checks only in strict calibration mode", () => {
    const samples: RelayChannelProbeSampleDto[] = [
      { index: 1, status: "succeeded", accepted: true, suggestedMultiplier: 1 },
      { index: 2, status: "succeeded", accepted: true, suggestedMultiplier: 1.01 },
      { index: 3, status: "succeeded", accepted: true, suggestedMultiplier: 0.99 },
      { index: 4, status: "succeeded", accepted: true, suggestedMultiplier: 7 },
    ];

    const result = finalizeProbeCalibration(samples, true);

    expect(result.calibrationStatus).toBe("verified");
    expect(result.accepted).toHaveLength(3);
    expect(result.discardedCount).toBe(1);
    expect(samples[3]).toMatchObject({ status: "discarded", accepted: false });
  });

  it("rejects a 2xx upstream response that does not contain billable usage", () => {
    expect(() =>
      assertProbeUsage({
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toThrow("最小模型请求未返回可计费用量");
    expect(() =>
      assertProbeUsage({
        requestTokens: 3,
        responseTokens: 1,
        totalTokens: 4,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).not.toThrow();
  });

  it("returns useful but redacted upstream authorization diagnostics", () => {
    const message = formatProbeUpstreamError(403, "https://api.example.com/v1/chat/completions?key=secret-value", {
      error: { message: "Invalid API key: sk_secret-value" },
    });
    expect(message).toContain("HTTP 403（/v1/chat/completions）");
    expect(message).toContain("Invalid API key: [REDACTED]");
    expect(message).toContain("余额工作流凭据不会替代渠道上游 Key");
    expect(message).not.toContain("secret-value");
  });

  it("identifies an upstream IP allow-list rejection", () => {
    const message = formatProbeUpstreamError(403, "https://api.example.com/v1/chat/completions", {
      message: "您的 IP 不在令牌允许访问的列表中",
    });
    expect(message).toContain("上游令牌 IP 白名单拒绝");
    expect(message).toContain("本服务端的公网出口 IP");
    expect(message).not.toContain("余额工作流凭据不会替代");
  });
});
