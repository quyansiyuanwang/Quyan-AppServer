import { describe, expect, it } from "vitest";
import {
  assertProbeUsage,
  buildProbeUpstreamEndpoint,
  calculateSuggestedProbeMultiplier,
  formatProbeUpstreamError,
  interpolateProbeVariables,
  readProbeJsonPath,
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
