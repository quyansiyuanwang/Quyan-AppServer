import { describe, expect, it, vi } from "vitest";
import {
  assertProbeUsage,
  buildProbeUpstreamEndpoint,
  calculateSuggestedProbeMultiplier,
  formatProbeUpstreamError,
  getProbeSchedulingScope,
  getProbeWorkflowRequestBody,
  interpolateRequiredProbeVariables,
  interpolateProbeVariables,
  normalizeProbeNetworkError,
  readProbeJsonPath,
  waitForProbeSettlement,
} from "../../src/services/relay/relay-channel-probe.service";

describe("relay channel probe helpers", () => {
  it("interpolates nested request values without changing other primitives", () => {
    expect(
      interpolateProbeVariables(
        { headers: { Authorization: "Bearer {{token}}" }, items: ["{{user}}", 1] },
        { token: "secret", user: "alice" },
      ),
    ).toEqual({ headers: { Authorization: "Bearer secret" }, items: ["alice", 1] });
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

  it("uses the group as the scheduling scope while leaving ungrouped channels independent", () => {
    expect(getProbeSchedulingScope("channel-a", "provider-a")).toBe("group:provider-a");
    expect(getProbeSchedulingScope("channel-b", "provider-a")).toBe("group:provider-a");
    expect(getProbeSchedulingScope("channel-a", undefined)).toBe("channel:channel-a");
    expect(getProbeSchedulingScope("channel-b", "")).toBe("channel:channel-b");
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
    expect(buildProbeUpstreamEndpoint("https://api.example.com", "openai", "gpt-test")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(buildProbeUpstreamEndpoint("https://api.example.com/v1", "openai", "gpt-test")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(buildProbeUpstreamEndpoint("https://generativelanguage.example.com/v1beta", "gemini", "gemini-test")).toBe(
      "https://generativelanguage.example.com/v1beta/models/gemini-test:generateContent",
    );
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
