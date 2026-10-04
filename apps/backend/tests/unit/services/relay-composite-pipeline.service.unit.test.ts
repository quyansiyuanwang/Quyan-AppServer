import { compositeIngressRequest } from "@/services/relay/relay-composite-transport.util";
import { describe, it, expect, vi } from "vitest";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { getCompositeContext } from "@/services/relay/relay-composite-executor.service";
const node = (id: string, members: string[], mapping: Record<string, string> = {}) => ({
  id,
  userId: "owner",
  status: 1,
  routingMode: members.length ? "composite" : "ordered",
  modelMapping: mapping,
  memberTokenConfigs: members.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
  expiresAt: null,
  ipWhitelist: null,
  failoverConfig: null,
});
describe("composite request pipeline", () => {
  it("preserves internal endpoint prefixes and applies mappings outside-in before leaf execution", async () => {
    const proxy = Object.create(RelayProxyService.prototype) as any;
    const a = {
      ...node("a", ["b"], { alias: "inner" }),
      requestFormatTransforms: [{ sourceFormat: "anthropic", targetFormat: "openai-chat-completions" }],
    };
    const b = node("b", ["c"], { inner: "priced" });
    const c = node("c", []);
    proxy.logicalRequestIds = new WeakMap();
    proxy.relayTokenRepo = {
      loadCompositionSnapshot: vi.fn(
        async () =>
          new Map([
            ["a", a],
            ["b", b],
            ["c", c],
          ]),
      ),
    };
    proxy.contentSafetyService = { evaluate: vi.fn(async () => ({ matched: false, action: "allow" })) };
    proxy.assertRelayTokenQuotaAvailable = vi.fn(async () => {});
    proxy.compositeLeafCanServe = vi.fn(async () => true);
    proxy.getAvailableModelMapForToken = vi.fn(async () => ({ openai: ["priced"], anthropic: [], gemini: [] }));
    proxy.getAvailableModelsForToken = vi.fn(async () => ["priced"]);
    proxy.forwardRequestInternal = vi.fn(async (_token, req) => {
      expect(req.path).toBe("/relay/proxy/v1/chat/completions");
      expect(req.body.model).toBe("priced");
      expect(getCompositeContext(req)!.path.map((token) => token.id)).toEqual(["a", "b", "c"]);
      return {
        status: 200,
        headers: {},
        data: { choices: [{ message: { content: "answer" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      };
    });
    const result = await proxy.forwardRequest(a, {
      path: "/relay/proxy/v1/messages",
      headers: {},
      body: { model: "alias", max_tokens: 16, messages: [{ role: "user", content: "fixture" }] },
    });
    expect(result.data.type).toBe("message");
    expect(proxy.forwardRequestInternal).toHaveBeenCalledTimes(1);
  });
  it("strips caller credentials and preserves protocol headers and Gemini stream parameters", () => {
    const source = {
      headers: {
        authorization: "fixture bearer",
        "x-api-key": "fixture relay key",
        "x-goog-api-key": "fixture gemini key",
        cookie: "fixture session",
        "anthropic-version": "fixture version",
      },
      query: { key: "fixture credential", token: "fixture token", alt: "sse" },
      body: {},
    };
    const cleaned = compositeIngressRequest(source, {});
    expect(cleaned.headers).toEqual({ "anthropic-version": "fixture version" });
    expect(cleaned.query).toEqual({ alt: "sse" });
    expect(source.headers).toHaveProperty("authorization");
    expect(source.query).toHaveProperty("key");
  });
});
