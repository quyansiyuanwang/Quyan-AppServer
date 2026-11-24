import { describe, expect, it, vi } from "vitest";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { getCompositeContext } from "@/services/relay/relay-composite-executor.service";
import { ContentSafetyBlockedError } from "@/util/errors";
import type { RelayTokenModelMappingRule } from "@quyan/shared";

const mapping = (source: string, target: string, channelIds?: string[]): RelayTokenModelMappingRule => ({
  source,
  target,
  preference: "mapping-first",
  ...(channelIds ? { channelIds } : {}),
});

function setup() {
  // No constructor: all persistence, capacity, safety and upstream boundaries are
  // explicit fixtures. Composite traversal and proxy route/forwarding code are real.
  const proxy = Object.create(RelayProxyService.prototype) as any;
  const node = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    userId: "fixture-owner",
    status: 1,
    routingMode: "ordered",
    expiresAt: null,
    ipWhitelist: null,
    allowedModels: null as string | null,
    memberTokenConfigs: [],
    failoverConfig: null,
    modelMappingRules: [],
    ...overrides,
  });
  const outer = node("outer", {
    routingMode: "composite",
    modelMappingRules: [mapping("B", "A", ["left-pool"])],
    failoverConfig: { enabled: true, maxRetries: 1, failoverThreshold: 0, retryStatusCodes: ["503"] },
    memberTokenConfigs: [
      { tokenId: "left", priority: 0, enabled: true },
      { tokenId: "right", priority: 1, enabled: true },
    ],
  });
  const left = node("left", { allowedModels: "C", modelMappingRules: [mapping("A", "C")] });
  const right = node("right", { allowedModels: "B" });
  const physical = (id: string, allowedModels: string) => ({
    id,
    name: id,
    channelType: "standalone",
    status: 1,
    multiplier: 1,
    allowedFormats: "openai-chat-completions",
    allowedModels: JSON.stringify([allowedModels]),
    openaiUpstreamUrl: "https://upstream.example.invalid",
    openaiUpstreamApiKey: "fixture-upstream-key",
  });
  const leftChannel = physical("left-channel", "C");
  const rightChannel = physical("right-channel", "B");
  const pricing = ["A", "B", "C"].map((provider) => ({
    provider,
    model: `Display ${provider}`,
    supportedFormats: "openai-chat-completions",
    pricingType: "token-based",
    inputPrice: 1000,
    outputPrice: 2000,
    cacheCreationMultiplier: 1,
    cacheReadMultiplier: 1,
  }));
  const failover = {
    enabled: false,
    maxRetries: 0,
    failoverThreshold: 1,
    retryStatusCodes: ["503"],
    failbackCooldownMinutes: 0,
    cacheHitRateMinSamples: 0,
    cacheHitRateWindowHours: 0,
  };
  proxy.logicalRequestIds = new WeakMap();
  proxy.relayTokenRepo = {
    loadCompositionSnapshot: vi.fn(
      async () =>
        new Map([
          ["outer", outer],
          ["left", left],
          ["right", right],
        ]),
    ),
  };
  proxy.modelPricingService = { getModelPricing: vi.fn(async () => pricing) };
  proxy.buildAttemptPlan = vi.fn(async (token: { id: string }) => ({
    channels: [
      {
        resolvedChannel: token.id === "left" ? leftChannel : rightChannel,
        displayChannel: token.id === "left" ? leftChannel : rightChannel,
        routingChannelIds: token.id === "left" ? ["left-pool", "left-channel"] : ["right-pool", "right-channel"],
      },
    ],
    failoverConfig: failover,
    allowStickyFailover: false,
  }));
  proxy.relayConfigService = {
    getRelayConfig: vi.fn(async () => ({ globalMultiplier: 1, upstreamStreamTimeout: 30000 })),
  };
  proxy.configService = {
    getRelayRequestHeaderPolicy: vi.fn(async () => ({ mode: "whitelist", allowlist: [], blocklist: [] })),
  };
  proxy.usageChargeService = { hasCoverageOrPositiveBalance: vi.fn(async () => true) };
  const policy = { requestEnabled: false, responseEnabled: false, responseAiEnabled: false };
  proxy.contentSafetyService = {
    prepareAttempt: vi.fn(async () => policy),
    getEffectivePolicy: vi.fn(async () => policy),
    getPublicConfig: vi.fn(async () => policy),
    evaluate: vi.fn(async (_direction, text) => ({
      text,
      matched: false,
      action: "allow",
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditCost: 0,
      auditDurationMs: 0,
    })),
    recordIncident: vi.fn(async () => {}),
  };
  proxy.assertRelayTokenQuotaAvailable = vi.fn(async () => {});
  proxy.getCapacityPolicy = vi.fn(() => ({ maxConcurrency: 1, queueTimeout: 0, enableQueue: false }));
  proxy.acquireNamedCapacityLease = vi.fn(async () => ({ fixture: true }));
  proxy.startConcurrencyLeaseHeartbeat = vi.fn(() => () => {});
  proxy.releaseConcurrencySlot = vi.fn(async () => {});
  proxy.relayChannelProbeLockService = { withRead: vi.fn(async (_id, callback) => callback()) };
  proxy.recordChannelAttempt = vi.fn(async () => {});
  proxy.forwardStreamRequest = vi.fn(async () => ({ handled: true, success: true, statusCode: 200 }));
  const request = {
    path: "/relay/proxy/v1/chat/completions",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { model: "B", stream: true, messages: [{ role: "user", content: "fixture" }] },
  };
  const response = { headersSent: false, writableEnded: false };
  return { proxy, outer, left, right, leftChannel, rightChannel, pricing, request, response };
}

function setupAnthropic() {
  const fixture = setup();
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "Zml4dHVyZQ==" },
  };
  Object.assign(fixture.request, {
    path: "/relay/proxy/v1/messages",
    body: {
      model: "B",
      max_tokens: 32,
      stream: true,
      messages: [{ role: "user", content: [image, { type: "text", text: "fixture" }] }],
    },
  });
  for (const channel of [fixture.leftChannel, fixture.rightChannel])
    Object.assign(channel, {
      allowedFormats: "anthropic",
      anthropicUpstreamUrl: "https://upstream.example.invalid",
      anthropicUpstreamApiKey: "fixture-upstream-key",
    });
  for (const row of fixture.pricing) row.supportedFormats = "anthropic";
  return { ...fixture, image };
}

const textOnly = (model: string) => ({ enabled: true, unsupportedImage: true, textOnlyModelIds: [model] });

describe("composite model route through actual proxy execution", () => {
  it.each(["deepseek-flash", "deepseek-v4.1-flash", "deepseek-ai/DeepSeek-V4.1-Flash"])(
    "forwards %s through a single token without hiding the original model identity",
    async (requestedModel) => {
      const { proxy, left, leftChannel, pricing, request, response } = setup();
      Object.assign(left, {
        allowedModels: null,
        modelMappingRules: [],
        modelMapping: null,
        normalizerConfig: { enabled: false },
      });
      const upstreamModel = "deepseek-ai/DeepSeek-V4.1-Flash";
      leftChannel.allowedModels = JSON.stringify([upstreamModel]);
      Object.assign(leftChannel, {
        modelMapping: { "deepseek-flash": upstreamModel, "deepseek-v4.1-flash": upstreamModel },
      });
      Object.assign(pricing[0], { provider: upstreamModel, model: "DeepSeek Flash" });
      request.body.model = requestedModel;

      expect((await proxy.forwardRequest(left, request, response)).status).toBe(200);
      expect(proxy.forwardStreamRequest).toHaveBeenCalledOnce();
      const forwarded = proxy.forwardStreamRequest.mock.calls[0][0];
      expect(forwarded.selectedModelId).toBe(upstreamModel);
      expect(forwarded.convertedBody.model).toBe(upstreamModel);
      expect(forwarded.selectedModelName).toBe("DeepSeek Flash");
      expect(request.body.model).toBe(requestedModel);
    },
  );

  it("forwards outer scoped B -> A then member A -> C with the original attribution path", async () => {
    const { proxy, outer, left, right, leftChannel, rightChannel, request, response } = setup();
    const before = structuredClone(request);
    const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel });
    const result = await proxy.forwardRequest(outer, request, response);
    expect(result.status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledOnce();
    const forwarded = proxy.forwardStreamRequest.mock.calls[0][0];
    expect(forwarded.selectedModelId).toBe("C");
    expect(forwarded.convertedBody.model).toBe("C");
    expect(forwarded.originalRequestedModel).toBe("B");
    expect(getCompositeContext(forwarded.req)?.path.map((item) => item.id)).toEqual(["outer", "left"]);
    expect(request).toEqual(before);
    expect({ outer, left, right, leftChannel, rightChannel }).toEqual(snapshots);
    expect(proxy.releaseConcurrencySlot).toHaveBeenCalledOnce();
  });

  it("re-resolves the original B on the sibling after a mapped upstream fails", async () => {
    const { proxy, outer, left, right, leftChannel, rightChannel, request, response } = setup();
    const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel });
    proxy.forwardStreamRequest
      .mockResolvedValueOnce({ handled: false, success: false, statusCode: 503, retryable: true })
      .mockResolvedValueOnce({ handled: true, success: true, statusCode: 200 });
    expect((await proxy.forwardRequest(outer, request, response)).status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledTimes(2);
    const attempts = proxy.forwardStreamRequest.mock.calls.map(([attempt]: any[]) => attempt);
    expect(attempts.map((attempt: any) => attempt.selectedModelId)).toEqual(["C", "B"]);
    expect(attempts.map((attempt: any) => attempt.convertedBody.model)).toEqual(["C", "B"]);
    expect(attempts.map((attempt: any) => getCompositeContext(attempt.req)?.path.map((item) => item.id))).toEqual([
      ["outer", "left"],
      ["outer", "right"],
    ]);
    expect(request.body.model).toBe("B");
    expect(proxy.acquireNamedCapacityLease).toHaveBeenCalledOnce();
    expect(proxy.releaseConcurrencySlot).toHaveBeenCalledOnce();
    expect({ outer, left, right, leftChannel, rightChannel }).toEqual(snapshots);

    const independentRequest = structuredClone(request);
    expect((await proxy.forwardRequest(outer, independentRequest, { ...response })).status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledTimes(3);
    const independentAttempt = proxy.forwardStreamRequest.mock.calls[2][0];
    expect(independentAttempt.selectedModelId).toBe("C");
    expect(independentAttempt.convertedBody.model).toBe("C");
    expect(getCompositeContext(independentAttempt.req)?.path.map((item) => item.id)).toEqual(["outer", "left"]);
    expect(getCompositeContext(independentAttempt.req)?.requestId).not.toBe(
      getCompositeContext(attempts[0].req)?.requestId,
    );
    expect(independentRequest.body.model).toBe("B");
    expect({ outer, left, right, leftChannel, rightChannel }).toEqual(snapshots);
    expect(proxy.acquireNamedCapacityLease).toHaveBeenCalledTimes(2);
    expect(proxy.releaseConcurrencySlot).toHaveBeenCalledTimes(2);
  });

  it("skips a member denied by its own whitelist before spending an upstream attempt", async () => {
    const { proxy, outer, left, request, response } = setup();
    left.allowedModels = "B";
    expect((await proxy.forwardRequest(outer, request, response)).status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledOnce();
    expect(proxy.forwardStreamRequest.mock.calls[0][0].selectedModelId).toBe("B");
    expect(request.body.model).toBe("B");
  });

  it("blocks final C at the ancestor policy before upstream or sibling bypass", async () => {
    const { proxy, outer, left, right, leftChannel, rightChannel, request, response } = setup();
    const rootPolicy = { fixturePolicy: "root-deny-final-C" };
    const leafPolicy = { fixturePolicy: "leaf-allow" };
    Object.assign(outer, { contentSafetyConfig: rootPolicy });
    Object.assign(left, { contentSafetyConfig: leafPolicy });
    const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel, request });
    proxy.contentSafetyService.evaluate = vi.fn(
      async (direction: string, text: string, options?: { tokenConfig?: unknown }) => {
        const blocked =
          direction === "request" && options?.tokenConfig === rootPolicy && JSON.parse(text).model === "C";
        return {
          text,
          matched: blocked,
          action: blocked ? "unreachable" : "allow",
          auditInputTokens: 0,
          auditOutputTokens: 0,
          auditCost: 0,
          auditDurationMs: 0,
        };
      },
    );

    await expect(proxy.forwardRequest(outer, request, response)).rejects.toBeInstanceOf(ContentSafetyBlockedError);
    const checks = proxy.contentSafetyService.evaluate.mock.calls.map(
      ([direction, text, options]: [string, string, { tokenConfig?: unknown }]) => ({
        direction,
        model: JSON.parse(text).model,
        policy: options.tokenConfig,
      }),
    );
    expect(checks).toContainEqual({ direction: "request", model: "C", policy: rootPolicy });
    expect(proxy.contentSafetyService.getEffectivePolicy).toHaveBeenCalledWith("fixture-owner", leafPolicy);
    expect(checks.filter((check: any) => check.model === "C")).toEqual([
      { direction: "request", model: "C", policy: rootPolicy },
    ]);
    expect(proxy.contentSafetyService.recordIncident).toHaveBeenCalled();
    expect(proxy.forwardStreamRequest).not.toHaveBeenCalled();
    expect(proxy.buildAttemptPlan.mock.calls.some(([token]: [{ id: string }]) => token.id === "right")).toBe(false);
    expect(
      proxy.assertRelayTokenQuotaAvailable.mock.calls.some(([token]: [{ id: string }]) => token.id === "right"),
    ).toBe(false);
    expect(proxy.releaseConcurrencySlot).toHaveBeenCalledOnce();
    expect({ outer, left, right, leftChannel, rightChannel, request }).toEqual(snapshots);
  });

  it.each(["unreachable", "blackhole"] as const)(
    "blocks final multipart C at the ancestor policy with %s before upstream or sibling bypass",
    async (action) => {
      const { proxy, outer, left, right, leftChannel, rightChannel, request, response } = setup();
      const rootPolicy = { fixturePolicy: "root-deny-multipart-C" };
      const leafPolicy = { fixturePolicy: "leaf-allow" };
      Object.assign(outer, { contentSafetyConfig: rootPolicy });
      Object.assign(left, { contentSafetyConfig: leafPolicy });
      const multipartBody = Buffer.from(
        [
          "--fixture-boundary",
          'Content-Disposition: form-data; name="model"',
          "",
          "B",
          "--fixture-boundary",
          'Content-Disposition: form-data; name="image"; filename="fixture.png"',
          "Content-Type: image/png",
          "",
          "fixture-image",
          "--fixture-boundary--",
          "",
        ].join("\r\n"),
      );
      Object.assign(request, {
        path: "/relay/proxy/v1/images/edits",
        headers: { "content-type": "multipart/form-data; boundary=fixture-boundary" },
        body: multipartBody,
      });
      const beforeBody = Buffer.from(multipartBody);
      const beforeHeaders = { ...request.headers };
      const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel });
      const finalModelField = 'name="model"\r\n\r\nC\r\n';
      proxy.contentSafetyService.evaluate = vi.fn(
        async (direction: string, text: string, options?: { tokenConfig?: unknown }) => {
          const blocked =
            direction === "request" && options?.tokenConfig === rootPolicy && text.includes(finalModelField);
          return {
            // A non-JSON multipart replacement must fail closed rather than forward.
            text: blocked && action === "blackhole" ? "[blocked multipart]" : text,
            matched: blocked,
            action: blocked ? action : "allow",
            auditInputTokens: 0,
            auditOutputTokens: 0,
            auditCost: 0,
            auditDurationMs: 0,
          };
        },
      );

      await expect(proxy.forwardRequest(outer, request, response)).rejects.toBeInstanceOf(ContentSafetyBlockedError);
      const finalChecks = proxy.contentSafetyService.evaluate.mock.calls.filter(
        ([direction, text]: [string, string]) => direction === "request" && text.includes(finalModelField),
      );
      expect(finalChecks).toHaveLength(1);
      expect(finalChecks[0][1]).toContain("fixture-image");
      expect(finalChecks[0][2]).toEqual({ userId: "fixture-owner", tokenConfig: rootPolicy });
      expect(proxy.contentSafetyService.getEffectivePolicy).toHaveBeenCalledWith("fixture-owner", leafPolicy);
      expect(proxy.contentSafetyService.recordIncident).toHaveBeenCalled();
      expect(proxy.forwardStreamRequest).not.toHaveBeenCalled();
      expect(proxy.relayChannelProbeLockService.withRead).not.toHaveBeenCalled();
      expect(proxy.buildAttemptPlan.mock.calls.some(([token]: [{ id: string }]) => token.id === "right")).toBe(false);
      expect(
        proxy.assertRelayTokenQuotaAvailable.mock.calls.some(([token]: [{ id: string }]) => token.id === "right"),
      ).toBe(false);
      expect(proxy.releaseConcurrencySlot).toHaveBeenCalledOnce();
      expect(Buffer.isBuffer(request.body)).toBe(true);
      expect(request.body).toEqual(beforeBody);
      expect(request.headers).toEqual(beforeHeaders);
      expect(request.path).toBe("/relay/proxy/v1/images/edits");
      expect({ outer, left, right, leftChannel, rightChannel }).toEqual(snapshots);
    },
  );

  it("preserves images when text-only alias B maps to vision A", async () => {
    const { proxy, outer, left, right, leftChannel, rightChannel, request, response, image } = setupAnthropic();
    Object.assign(outer, { normalizerConfig: textOnly("B") });
    Object.assign(left, { allowedModels: "A", modelMappingRules: [], normalizerConfig: textOnly("B") });
    leftChannel.allowedModels = '["A"]';
    const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel, request });

    expect((await proxy.forwardRequest(outer, request, response)).status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledOnce();
    const attempt = proxy.forwardStreamRequest.mock.calls[0][0];
    expect(attempt.selectedModelId).toBe("A");
    expect(attempt.convertedBody.messages[0].content).toEqual([image, { type: "text", text: "fixture" }]);
    expect({ outer, left, right, leftChannel, rightChannel, request }).toEqual(snapshots);
  });

  it("replaces images for parent text-only A before member maps A to vision C", async () => {
    const { proxy, outer, left, right, leftChannel, rightChannel, request, response } = setupAnthropic();
    Object.assign(outer, { normalizerConfig: textOnly("A") });
    Object.assign(left, { normalizerConfig: textOnly("unrelated-model") });
    const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel, request });

    expect((await proxy.forwardRequest(outer, request, response)).status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledOnce();
    const attempt = proxy.forwardStreamRequest.mock.calls[0][0];
    expect(attempt.selectedModelId).toBe("C");
    expect(attempt.convertedBody.messages[0].content).toEqual([
      { type: "text", text: "[Unsupported Image]" },
      { type: "text", text: "fixture" },
    ]);
    expect({ outer, left, right, leftChannel, rightChannel, request }).toEqual(snapshots);
  });

  it("preserves images when the parent transforms Anthropic to chat before its own normalizer", async () => {
    const { proxy, outer, left, right, leftChannel, rightChannel, pricing, request, response } = setupAnthropic();
    Object.assign(outer, {
      requestFormatTransforms: [{ sourceFormat: "anthropic", targetFormat: "openai-chat-completions" }],
      normalizerConfig: textOnly("A"),
    });
    Object.assign(left, { normalizerConfig: textOnly("C") });
    for (const channel of [leftChannel, rightChannel]) channel.allowedFormats = "openai-chat-completions";
    for (const row of pricing) row.supportedFormats = "openai-chat-completions";
    const snapshots = structuredClone({ outer, left, right, leftChannel, rightChannel, request });

    expect((await proxy.forwardRequest(outer, request, response)).status).toBe(200);
    expect(proxy.forwardStreamRequest).toHaveBeenCalledOnce();
    const attempt = proxy.forwardStreamRequest.mock.calls[0][0];
    expect(attempt.selectedModelId).toBe("C");
    expect(attempt.upstreamUrl).toBe("https://upstream.example.invalid/v1/chat/completions");
    expect(attempt.convertedBody.messages[0].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,Zml4dHVyZQ==" } },
      { type: "text", text: "fixture" },
    ]);
    expect({ outer, left, right, leftChannel, rightChannel, request }).toEqual(snapshots);
  });
});
