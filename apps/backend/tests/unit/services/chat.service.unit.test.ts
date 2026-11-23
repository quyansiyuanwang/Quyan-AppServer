import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AIResourceConfigService } from "../../../src/services/infrastructure/ai-resource-config.service";
import { AIResourceService, aiResourceContext } from "../../../src/services/infrastructure/ai-resource.service";
import { contentSafetyAttemptContext } from "../../../src/services/system/content-safety-attempt";
import { ChatService } from "../../../src/services/chat/chat.service";
import { BadRequestError, ForbiddenError, NotFoundError, PayloadTooLargeError } from "../../../src/util/errors";
import { getAIRequestLogContext } from "../../../src/util/ai-request-log-context";
import { RelayProxyService } from "../../../src/services/relay/relay-proxy.service";
import { getCompositeContext } from "../../../src/services/relay/relay-composite-executor.service";
import type { ChatStreamEvent } from "@quyan/shared";
import { CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS } from "../../../src/constant/chat";

async function* createChatStream() {
  yield { content: "hello", done: false };
  yield {
    done: true,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 1,
    cacheReadTokens: 2,
    totalOutputTime: 100,
    timeToFirstByte: 30,
    isStreaming: true,
  };
}

async function* createPartialFailingStream(error: Error) {
  yield { content: "partial", done: false };
  throw error;
}

async function* createEmptyChatStream() {
  yield {
    done: true,
    inputTokens: 8,
    outputTokens: 0,
    totalOutputTime: 100,
    timeToFirstByte: 100,
    isStreaming: true,
  };
}

const createFailingStream = (error: Error) => ({
  [Symbol.asyncIterator]() {
    return {
      next: async () => Promise.reject(error),
    };
  },
});

const createPersistedMessage = (
  overrides: Partial<{
    id: string;
    conversationId: string;
    role: string;
    content: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cost: number | null;
    completionStatus: string;
    createTime: Date;
  }> = {},
) => ({
  id: "assistant-msg-1",
  conversationId: "conv-1",
  role: "assistant",
  content: "hello",
  model: "gpt-4o-mini",
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  cost: null,
  completionStatus: "completed",
  createTime: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("ChatService", () => {
  const conversationRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    replaceFrom: vi.fn(),
    findByUserId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const messageRepo = {
    create: vi.fn(),
    findByConversationId: vi.fn(),
    getContextSize: vi.fn(),
    findContext: vi.fn(),
    findById: vi.fn(),
    replaceFrom: vi.fn(),
    delete: vi.fn(),
  };

  const aiProvider = {
    getProvider: vi.fn((model: string) => {
      if (model.startsWith("claude-") || model.includes("claude")) return "anthropic";
      if (model.startsWith("gemini-") || model.includes("gemini")) return "gemini";
      return "openai";
    }),
    streamChat: vi.fn(),
  };

  const relayTokenRepository = {
    findById: vi.fn(),
    replaceFrom: vi.fn(),
    findByIdWithChannel: vi.fn(),
    findByUserIdWithChannel: vi.fn(),
    findByUserIdWithRelations: vi.fn(),
  };

  const relayUsageRepository = {
    create: vi.fn(),
  };

  const modelPricingRepository = {
    listActiveOrderedByModel: vi.fn(),
  };

  const relayConfigRepository = {
    findLatestActive: vi.fn(),
  };

  const usageChargeService = {
    hasCoverageOrPositiveBalance: vi.fn(),
    chargeUsage: vi.fn(),
  };

  const relayPoolResolver = {
    resolveActiveLeafCandidates: vi.fn(async (roots: any[]) =>
      roots.filter(Boolean).map((channel: any) => ({ resolvedChannel: channel, displayChannel: channel })),
    ),
  };

  const relayProxyService = {
    getCompositeCatalog: vi.fn(),
    forwardRequest: vi.fn(),
    getAvailableModelMapForToken: vi.fn(),
    assertRelayChannelMultiplierAccepted: vi.fn(),
    getChatAttemptPlan: vi.fn(
      async (token: any) =>
        ({
          channels: token.channel ? [{ resolvedChannel: token.channel, displayChannel: token.channel }] : [],
          failoverConfig: {
            enabled: false,
            maxRetries: 0,
            retryStatusCodes: [] as string[],
            failoverThreshold: 1,
            failbackCooldownMinutes: 0,
            maxAcceptedChannelMultiplier: undefined,
          },
          allowStickyFailover: true,
        }) as any,
    ),
  };
  const contentSafetyService = {
    getPublicConfig: vi.fn().mockResolvedValue({
      requestEnabled: true,
      requestAction: "unreachable",
      requestAiEnabled: false,
      responseEnabled: true,
      responseAction: "unreachable",
      responseAiEnabled: false,
    }),
    evaluate: vi.fn().mockResolvedValue({
      text: "",
      action: "allow",
      matched: false,
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
    }),
    evaluateLocal: vi.fn().mockResolvedValue({
      text: "",
      action: "allow",
      matched: false,
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
    }),
    recordIncident: vi.fn().mockResolvedValue(undefined),
  };

  const ChatServiceCtor = ChatService as unknown as new (...args: any[]) => ChatService;

  const service = new ChatServiceCtor(
    conversationRepo,
    messageRepo,
    aiProvider,
    relayTokenRepository,
    relayUsageRepository,
    modelPricingRepository,
    relayConfigRepository,
    usageChargeService,
    relayPoolResolver,
    relayProxyService,
    contentSafetyService,
  );

  const resourceConfig = AIResourceConfigService.getInstance();
  let originalResources = resourceConfig.current;
  afterEach(() => resourceConfig.apply(originalResources));

  beforeEach(() => {
    originalResources = resourceConfig.current;
    vi.clearAllMocks();
    relayUsageRepository.create.mockResolvedValue(undefined);
    contentSafetyService.getPublicConfig.mockResolvedValue({
      requestEnabled: true,
      requestAction: "unreachable",
      requestAiEnabled: false,
      responseEnabled: true,
      responseAction: "unreachable",
      responseAiEnabled: false,
    });
    contentSafetyService.evaluate.mockResolvedValue({
      text: "",
      action: "allow",
      matched: false,
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
    });
    contentSafetyService.evaluateLocal.mockResolvedValue({
      text: "",
      action: "allow",
      matched: false,
      auditInputTokens: 0,
      auditOutputTokens: 0,
      auditDurationMs: 0,
      auditCost: 0,
    });
    contentSafetyService.recordIncident.mockResolvedValue(undefined);
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([]);
    relayProxyService.getCompositeCatalog.mockReset();
    relayProxyService.forwardRequest.mockReset();
    relayProxyService.getChatAttemptPlan.mockImplementation(
      async (token: any) =>
        ({
          channels: token.channel ? [{ resolvedChannel: token.channel, displayChannel: token.channel }] : [],
          failoverConfig: {
            enabled: false,
            maxRetries: 0,
            retryStatusCodes: [] as string[],
            failoverThreshold: 1,
            failbackCooldownMinutes: 0,
            maxAcceptedChannelMultiplier: undefined,
          },
          allowStickyFailover: true,
        }) as any,
    );
    messageRepo.getContextSize.mockResolvedValue({ count: 0, bytes: 0 });
    messageRepo.findContext.mockImplementation((...args: any[]) => messageRepo.findByConversationId(...args));
  });

  it("rejects oversized context before reading history or modifying messages", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1" });
    messageRepo.getContextSize.mockResolvedValue({ count: 200, bytes: 10 });
    await expect(service.assertContextBudget("conv-1", "user-1", "hello")).rejects.toMatchObject({ statusCode: 413 });
    expect(messageRepo.findContext).not.toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
  });

  it("calculates replacement budgets from the history before the replaced message", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1" });
    const target = createPersistedMessage({ id: "replace", conversationId: "conv-1", role: "user" });
    messageRepo.findById.mockResolvedValue(target);
    messageRepo.getContextSize.mockResolvedValue({ count: 2, bytes: 100 });
    await service.assertContextBudget("conv-1", "user-1", "replacement", "replace");
    expect(messageRepo.getContextSize).toHaveBeenCalledWith("conv-1", target);
    expect(messageRepo.replaceFrom).not.toHaveBeenCalled();
  });

  function configureStatelessGeneration(tokenOverrides: Record<string, unknown> = {}) {
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      status: 1,
      channelId: "channel-1",
      allowedModels: null,
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "fixture-only",
      channel: { id: "channel-1", name: "main", multiplier: 1, allowedFormats: null },
      ...tokenOverrides,
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "gpt-4o-mini",
        provider: null,
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "openai",
      },
    ]);
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    aiProvider.streamChat.mockReturnValue(createChatStream());
  }

  const compositeFrame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  function configureCompositeChat(format = "openai-chat-completions") {
    configureStatelessGeneration({ routingMode: "composite", channel: null });
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    messageRepo.findContext.mockResolvedValue([{ role: "user", content: "hello" }]);
    messageRepo.create.mockImplementation(async (data) => createPersistedMessage({ ...data, cost: data.cost ?? null }));
    relayProxyService.getCompositeCatalog.mockImplementation(async (_id, candidate) =>
      candidate === format ? [{ model: "customer-model", tokenPathIds: ["token-1", "inner", "leaf"] }] : [],
    );
    relayProxyService.forwardRequest.mockImplementation(async (_token, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        compositeFrame({
          choices: [{ delta: { content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }) + "data: [DONE]\n\n",
      );
      return { status: 200, headers: {}, data: {} };
    });
  }

  it("executes composite aliases through the full proxy pipeline and persists without a second settlement", async () => {
    configureCompositeChat();
    const events: ChatStreamEvent[] = [];
    for await (const event of service.sendMessage("conv-1", "user-1", "hello", "customer-model", undefined, {
      requestId: "composite-chat-fixture",
      ipAddress: "192.0.2.10",
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(["delta", "complete"]);
    expect(events[1]).toMatchObject({
      message: {
        content: "hello",
        model: "customer-model",
        inputTokens: 10,
        outputTokens: 20,
        cost: null,
        completionStatus: "completed",
      },
    });
    expect(relayProxyService.forwardRequest).toHaveBeenCalledTimes(1);
    const [token, request, response] = relayProxyService.forwardRequest.mock.calls[0]!;
    expect(token).toMatchObject({ id: "token-1", routingMode: "composite" });
    expect(request).toMatchObject({
      method: "POST",
      path: "/relay/proxy/v1/chat/completions",
      ip: "192.0.2.10",
      body: { model: "customer-model", messages: [{ role: "user", content: "hello" }], stream: true },
    });
    expect(request.headers).toEqual({ "content-type": "application/json" });
    expect(getAIRequestLogContext(response)?.requestId).toBe("composite-chat-fixture");
    expect(relayProxyService.getCompositeCatalog).toHaveBeenCalledWith(
      "token-1",
      "openai-chat-completions",
      undefined,
      ["customer-model"],
    );
    expect(messageRepo.create).toHaveBeenCalledTimes(2);
    expect(messageRepo.create).toHaveBeenNthCalledWith(1, { conversationId: "conv-1", role: "user", content: "hello" });
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
    expect(usageChargeService.hasCoverageOrPositiveBalance).not.toHaveBeenCalled();
    expect(relayUsageRepository.create).not.toHaveBeenCalled();
    expect(aiProvider.streamChat).not.toHaveBeenCalled();
    expect(relayProxyService.getChatAttemptPlan).not.toHaveBeenCalled();
    expect(contentSafetyService.evaluate).not.toHaveBeenCalled();
    expect(modelPricingRepository.listActiveOrderedByModel).not.toHaveBeenCalled();
  });

  it.each([
    [
      "anthropic",
      "/relay/proxy/v1/messages",
      [
        { type: "message_start", message: { usage: { input_tokens: 7 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
        { type: "message_delta", usage: { output_tokens: 3 } },
      ],
    ],
    [
      "openai-responses",
      "/relay/proxy/v1/responses",
      [
        { type: "response.output_text.delta", delta: "hello" },
        {
          type: "response.completed",
          response: { output: [{ content: [{ text: "hello" }] }], usage: { input_tokens: 7, output_tokens: 3 } },
        },
      ],
    ],
    [
      "gemini",
      "/relay/proxy/v1beta/models/customer-model:streamGenerateContent",
      [
        {
          candidates: [{ content: { parts: [{ text: "hello" }] } }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
        },
      ],
    ],
  ])("bridges a composite alias available only in %s", async (format, path, frames) => {
    configureCompositeChat(format);
    relayProxyService.forwardRequest.mockImplementation(async (_token, request, response) => {
      expect(request.path).toBe(path);
      if (format === "anthropic")
        expect(request.body).toMatchObject({
          model: "customer-model",
          max_tokens: CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
          stream: true,
        });
      if (format === "openai-responses")
        expect(request.body).toMatchObject({ model: "customer-model", stream: true, input: expect.any(Array) });
      if (format === "gemini")
        expect(request).toMatchObject({
          query: { alt: "sse" },
          body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
        });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(frames.map(compositeFrame).join(""));
      return { status: 200, headers: {}, data: {} };
    });
    const events: ChatStreamEvent[] = [];
    for await (const event of service.sendMessage("conv-1", "user-1", "hello", "customer-model")) events.push(event);
    expect(events.filter((event) => event.type === "delta")).toEqual([
      { type: "delta", content: "hello", done: false },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "complete", message: { inputTokens: 7, outputTokens: 3 } });
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("bridges the real composite executor's nested protocol transform and member failover", async () => {
    configureCompositeChat();
    const node = (id: string, members: string[] = []) => ({
      id,
      userId: "user-1",
      status: 1,
      routingMode: members.length ? "composite" : "ordered",
      memberTokenConfigs: members.map((tokenId, priority) => ({ tokenId, priority, enabled: true })),
      expiresAt: null,
      ipWhitelist: null,
      failoverConfig: null,
    });
    const root = {
      ...node("token-1", ["unavailable", "inner"]),
      requestFormatTransforms: [{ sourceFormat: "openai-chat-completions", targetFormat: "anthropic" }],
    };
    const inner = node("inner", ["leaf"]);
    const unavailable = node("unavailable");
    const leaf = node("leaf");
    // Exercise actual proxy/composite/transport code, mocking persistence and physical upstream I/O.
    const proxy = Object.create(RelayProxyService.prototype) as any;
    proxy.logicalRequestIds = new WeakMap();
    proxy.relayTokenRepo = {
      loadCompositionSnapshot: vi.fn(
        async () =>
          new Map([
            [root.id, root],
            [inner.id, inner],
            [unavailable.id, unavailable],
            [leaf.id, leaf],
          ]),
      ),
    };
    proxy.assertRelayTokenQuotaAvailable = vi.fn(async () => {});
    proxy.compositeLeafCanServe = vi.fn(async () => true);
    proxy.contentSafetyService = { evaluate: vi.fn(async () => ({ matched: false, action: "allow" })) };
    proxy.forwardRequestInternal = vi.fn(async (token: { id: string }, request: any, response: any) => {
      expect(request.path).toBe("/relay/proxy/v1/messages");
      expect(request.body).toMatchObject({
        model: "customer-model",
        stream: true,
        max_tokens: CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
      });
      if (token.id === "unavailable") return { status: 503, headers: {}, data: { error: {} } };
      expect(getCompositeContext(request)?.path.map((token) => token.id)).toEqual(["token-1", "inner", "leaf"]);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        [
          { type: "message_start", message: { id: "fixture", model: "physical-model", usage: { input_tokens: 7 } } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "nested answer" } },
          { type: "message_delta", usage: { output_tokens: 3 } },
          { type: "message_stop" },
        ]
          .map(compositeFrame)
          .join(""),
      );
      return { status: 200, headers: {}, data: {} };
    });
    relayProxyService.forwardRequest.mockImplementation((token, request, response) =>
      proxy.forwardRequest(token, request, response),
    );
    const events: ChatStreamEvent[] = [];
    for await (const event of service.sendMessage("conv-1", "user-1", "hello", "customer-model")) events.push(event);
    expect(events.filter((event) => event.type === "delta")).toEqual([
      { type: "delta", content: "nested answer", done: false },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "complete", message: { inputTokens: 7, outputTokens: 3 } });
    expect(proxy.forwardRequestInternal).toHaveBeenCalledTimes(2);
    expect(proxy.assertRelayTokenQuotaAvailable.mock.calls.map(([token]: [{ id: string }]) => token.id)).toEqual([
      "token-1",
      "unavailable",
      "inner",
      "leaf",
    ]);
    expect(messageRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "nested answer", completionStatus: "completed" }),
    );
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("waits for proxy settlement after the response stream ends before confirming completion", async () => {
    configureCompositeChat();
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => {
      settle = resolve;
    });
    relayProxyService.forwardRequest.mockImplementation(async (_token, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(compositeFrame({ choices: [{ delta: { content: "hello" } }] }));
      await settlement;
      return { status: 200, headers: {}, data: {} };
    });
    const stream = service.sendMessage("conv-1", "user-1", "hello", "customer-model");
    expect(await stream.next()).toMatchObject({ value: { type: "delta" } });
    let completed = false;
    const next = stream.next().then((value) => {
      completed = true;
      return value;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(messageRepo.create).toHaveBeenCalledTimes(1);
    settle();
    expect(await next).toMatchObject({ value: { type: "complete" } });
    await stream.return(undefined);
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("persists partial composite output as failed when proxy settlement rejects after end", async () => {
    configureCompositeChat();
    relayProxyService.forwardRequest.mockImplementation(async (_token, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(compositeFrame({ choices: [{ delta: { content: "partial" } }] }));
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new Error("Fixture settlement rejected");
    });
    const events: ChatStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of service.sendMessage("conv-1", "user-1", "hello", "customer-model"))
          events.push(event);
      })(),
    ).rejects.toThrow("Fixture settlement rejected");
    expect(events).toEqual([{ type: "delta", content: "partial", done: false }]);
    expect(messageRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "assistant", content: "partial", completionStatus: "failed" }),
    );
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves partial composite output when cancelled (consumer return: %s)",
    async (consumerReturn) => {
      configureCompositeChat();
      let aborted = false;
      relayProxyService.forwardRequest.mockImplementation(async (_token, request, response) => {
        const cancellation = new Promise<void>((resolve) =>
          request.once("aborted", () => {
            aborted = true;
            resolve();
          }),
        );
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(compositeFrame({ choices: [{ delta: { content: "partial" } }] }));
        await cancellation;
        return { status: 200, headers: {}, data: {} };
      });
      const controller = new AbortController();
      const stream = service.sendMessage("conv-1", "user-1", "hello", "customer-model", undefined, {
        signal: controller.signal,
      });
      expect(await stream.next()).toMatchObject({ value: { type: "delta", content: "partial" } });
      if (consumerReturn) await stream.return(undefined);
      else {
        controller.abort();
        expect(await stream.next()).toEqual({ done: true, value: undefined });
      }
      expect(aborted).toBe(true);
      expect(messageRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "assistant", content: "partial", completionStatus: "stopped" }),
      );
      expect(AIResourceService.getInstance().snapshot().active).toBe(0);
      expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
    },
  );

  it("preserves a composite answer before an SSE failure and does not report completion", async () => {
    configureCompositeChat();
    relayProxyService.forwardRequest.mockImplementation(async (_token, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        compositeFrame({ choices: [{ delta: { content: "partial" } }] }) +
          compositeFrame({ error: { type: "upstream_error", code: 502 } }),
      );
      return { status: 200, headers: {}, data: {} };
    });
    const stream = service.sendMessage("conv-1", "user-1", "hello", "customer-model");
    expect(await stream.next()).toMatchObject({ value: { content: "partial" } });
    await expect(stream.next()).rejects.toThrow("Composite upstream stream failed");
    expect(messageRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ completionStatus: "failed", content: "partial" }),
    );
    expect(relayUsageRepository.create).not.toHaveBeenCalled();
  });

  it("applies composite output limits, preserves accepted text and aborts the proxy", async () => {
    configureCompositeChat();
    resourceConfig.apply({
      ...originalResources,
      chat: { resourceLimits: { ...originalResources.chat.resourceLimits, outputLimitBytes: 4 } },
    });
    let aborted = false;
    relayProxyService.forwardRequest.mockImplementation(async (_token, request, response) => {
      const cancellation = new Promise<void>((resolve) =>
        request.once("aborted", () => {
          aborted = true;
          resolve();
        }),
      );
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        compositeFrame({ choices: [{ delta: { content: "ok" } }] }) +
          compositeFrame({ choices: [{ delta: { content: "oversized" } }] }),
      );
      await cancellation;
      return { status: 200, headers: {}, data: {} };
    });
    const stream = service.sendMessage("conv-1", "user-1", "hello", "customer-model");
    expect(await stream.next()).toMatchObject({ value: { content: "ok" } });
    await expect(stream.next()).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(aborted).toBe(true);
    expect(messageRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "ok", completionStatus: "failed" }),
    );
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("supports composite stateless generation, split UTF-8 frames and character budgets", async () => {
    configureCompositeChat();
    relayProxyService.forwardRequest.mockImplementation(async (_token, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const bytes = Buffer.from(compositeFrame({ choices: [{ delta: { content: "你好" } }] }));
      for (const byte of bytes) response.write(Buffer.from([byte]));
      response.end();
      return { status: 200, headers: {}, data: {} };
    });
    await expect(
      service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 2 }),
    ).resolves.toBe("你好");
    await expect(
      service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 1 }),
    ).rejects.toThrow("Generation output exceeds the limit");
    expect(messageRepo.create).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it.each([undefined, "replace"])(
    "rechecks composite context before persisting the user message (replacement: %s)",
    async (replaceId) => {
      configureCompositeChat();
      messageRepo.findById.mockResolvedValue(createPersistedMessage({ id: "replace", role: "user" }));
      // The first check passes, but history grows while the route catalog is being read.
      messageRepo.getContextSize
        .mockResolvedValueOnce({ count: 0, bytes: 0 })
        .mockResolvedValueOnce({ count: 0, bytes: originalResources.chat.resourceLimits.contextLimitBytes });
      await expect(
        service.sendMessage("conv-1", "user-1", "hello", "customer-model", undefined, undefined, replaceId).next(),
      ).rejects.toBeInstanceOf(PayloadTooLargeError);
      expect(relayProxyService.getCompositeCatalog).toHaveBeenCalled();
      expect(messageRepo.create).not.toHaveBeenCalled();
      expect(messageRepo.replaceFrom).not.toHaveBeenCalled();
      expect(relayProxyService.forwardRequest).not.toHaveBeenCalled();
    },
  );

  it.each(["openai-chat-completions", "openai-responses", "anthropic", "gemini"])(
    "uses the existing Anthropic conversion cap independently of byte limits (%s)",
    async (format) => {
      configureCompositeChat(format);
      resourceConfig.apply({
        ...originalResources,
        chat: { resourceLimits: { ...originalResources.chat.resourceLimits, outputLimitBytes: 100 } },
      });
      relayProxyService.forwardRequest.mockImplementation(async (_token, request, response) => {
        if (format === "gemini") {
          expect(request.body).not.toHaveProperty("generationConfig");
          expect(request.body).not.toHaveProperty("max_tokens");
        } else if (format === "openai-responses")
          expect(request.body.max_output_tokens).toBe(CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS);
        else expect(request.body.max_tokens).toBe(CHAT_ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS);
        response.writeHead(200, { "content-type": "text/event-stream" });
        const payload =
          format === "gemini"
            ? { candidates: [{ content: { parts: [{ text: "hello" }] } }] }
            : format === "anthropic"
              ? { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } }
              : format === "openai-responses"
                ? { type: "response.output_text.delta", delta: "hello" }
                : { choices: [{ delta: { content: "hello" } }] };
        response.end(compositeFrame(payload));
        return { status: 200, headers: {}, data: {} };
      });
      await expect(
        service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 100 }),
      ).resolves.toBe("hello");
    },
  );

  it("persists Gemini usage from a final metadata-only frame without charging again", async () => {
    configureCompositeChat("gemini");
    relayProxyService.forwardRequest.mockImplementation(async (_token, _request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        compositeFrame({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }) +
          compositeFrame({
            usageMetadata: {
              promptTokenCount: "17",
              candidatesTokenCount: "9",
              totalTokenCount: "26",
              cachedContentTokenCount: "5",
            },
          }),
      );
      return { status: 200, headers: {}, data: {} };
    });
    const events: ChatStreamEvent[] = [];
    for await (const event of service.sendMessage("conv-1", "user-1", "hello", "customer-model")) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "complete", message: { inputTokens: 17, outputTokens: 9 } });
    expect(messageRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "assistant",
        inputTokens: 17,
        outputTokens: 9,
        totalTokens: 26,
      }),
    );
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
    expect(relayUsageRepository.create).not.toHaveBeenCalled();
  });

  it("surfaces a composite JSON error without an assistant message or duplicate usage record", async () => {
    configureCompositeChat();
    relayProxyService.forwardRequest.mockResolvedValue({
      status: 429,
      headers: {},
      data: { error: { type: "quota_exceeded" } },
    });
    await expect(service.sendMessage("conv-1", "user-1", "hello", "customer-model").next()).rejects.toThrow(
      "Composite upstream stream failed",
    );
    expect(messageRepo.create).toHaveBeenCalledTimes(1);
    expect(messageRepo.create).toHaveBeenCalledWith({ conversationId: "conv-1", role: "user", content: "hello" });
    expect(relayUsageRepository.create).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
  });

  it("replaces the selected composite user message and rejects an unavailable alias before modifying history", async () => {
    configureCompositeChat();
    messageRepo.findById.mockResolvedValue(createPersistedMessage({ id: "replace", role: "user" }));
    for await (const _event of service.sendMessage(
      "conv-1",
      "user-1",
      "hello",
      "customer-model",
      undefined,
      undefined,
      "replace",
    )) {
      /* Drain */
    }
    expect(messageRepo.replaceFrom).toHaveBeenCalledWith("replace", "hello");
    expect(messageRepo.create).toHaveBeenCalledTimes(1);
    messageRepo.create.mockClear();
    relayProxyService.forwardRequest.mockClear();
    relayProxyService.getCompositeCatalog.mockResolvedValue([]);
    await expect(service.sendMessage("conv-1", "user-1", "hello", "missing-alias").next()).rejects.toThrow(
      "No compatible composite chat route",
    );
    expect(messageRepo.create).not.toHaveBeenCalled();
    expect(relayProxyService.forwardRequest).not.toHaveBeenCalled();
  });

  it.each([
    { modelMapping: { "customer-model": "gpt-4o-mini" } },
    {
      modelMappingRules: [
        { source: "customer-model", target: "gpt-4o-mini", preference: "mapping-first", channelIds: ["channel-1"] },
      ],
    },
    {
      channel: { id: "channel-1", modelMapping: { "customer-model": "gpt-4o-mini" } },
    },
  ])("routes an allowed alias without a base catalog record: %j", async (mapping) => {
    configureStatelessGeneration({ allowedModels: "customer-model", ...mapping });

    await expect(
      service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 100 }),
    ).resolves.toBe("hello");
    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      expect.any(Array),
      "gpt-4o-mini",
      "fixture-only",
      "https://upstream.example.com",
      "openai",
      expect.any(AbortSignal),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gpt-4o-mini", modelName: "gpt-4o-mini" }),
    );
  });

  it.each([
    ["mapping-first", "gpt-mapped", "gpt-mapped"],
    ["original-first", "gpt-mapped", "gpt-4o-mini"],
    ["mapping-first", "missing-target", "gpt-4o-mini"],
  ])("uses %s preference with target %s", async (preference, target, expectedModel) => {
    configureStatelessGeneration({
      allowedModels: "gpt-4o-mini",
      modelMappingRules: [{ source: "gpt-4o-mini", target, preference }],
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "gpt-4o-mini", provider: null, supportedFormats: "openai", inputPrice: 1, outputPrice: 1 },
      { model: "gpt-mapped", provider: null, supportedFormats: "openai", inputPrice: 2, outputPrice: 2 },
    ]);
    await service.generateTextForUser("user-1", "hello", "gpt-4o-mini", "token-1", { maxOutputCharacters: 100 });
    expect(aiProvider.streamChat.mock.calls[0]?.[1]).toBe(expectedModel);
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: expectedModel, modelName: expectedModel }),
    );
  });

  it("resolves the original alias independently on every failover path and bills the selected channel pricing", async () => {
    configureStatelessGeneration({
      allowedModels: "customer-model",
      modelMappingRules: [
        { source: "customer-model", target: "First pricing", preference: "mapping-first", channelIds: ["pool-first"] },
        {
          source: "customer-model",
          target: "Second pricing",
          preference: "mapping-first",
          channelIds: ["pool-second"],
        },
      ],
    });
    const channels = [
      {
        resolvedChannel: { id: "leaf-first", allowedModels: '["First pricing"]', allowedFormats: "openai" },
        displayChannel: { id: "pool-first", name: "First pool" },
        routingChannelIds: ["pool-first", "leaf-first"],
      },
      {
        resolvedChannel: { id: "leaf-second", allowedModels: '["Second pricing"]', allowedFormats: "anthropic" },
        displayChannel: { id: "pool-second", name: "Second pool" },
        routingChannelIds: ["pool-second", "leaf-second"],
      },
    ];
    relayProxyService.getChatAttemptPlan.mockResolvedValue({
      channels,
      failoverConfig: { enabled: true, maxRetries: 1, retryStatusCodes: ["5xx"] },
      allowStickyFailover: true,
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "First pricing", provider: "Upstream-A", supportedFormats: "openai", inputPrice: 1, outputPrice: 1 },
      { model: "Second pricing", provider: "Upstream-B", supportedFormats: "anthropic", inputPrice: 2, outputPrice: 2 },
    ]);
    aiProvider.streamChat
      .mockReturnValueOnce(createFailingStream(new Error("Fixture upstream unavailable")))
      .mockReturnValueOnce(createChatStream());

    await expect(
      service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 100 }),
    ).resolves.toBe("hello");
    expect(aiProvider.streamChat.mock.calls.map((args) => [args[1], args[4]])).toEqual([
      ["Upstream-A", "openai"],
      ["Upstream-B", "anthropic"],
    ]);
    expect(usageChargeService.hasCoverageOrPositiveBalance).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ modelName: "Second pricing", channelId: "leaf-second" }),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "Upstream-B",
        modelName: "Second pricing",
        executionChannelId: "leaf-second",
        displayChannelId: "pool-second",
      }),
    );
  });

  it("filters denied candidates before choosing a route and never retries an unauthorized mapping", async () => {
    configureStatelessGeneration({ allowedModels: "gpt-4o-mini" });
    relayProxyService.getChatAttemptPlan.mockResolvedValue({
      channels: [
        {
          resolvedChannel: { id: "denied", modelMapping: { "customer-model": "gpt-denied" } },
          displayChannel: { id: "denied" },
        },
        {
          resolvedChannel: { id: "allowed", modelMapping: { "customer-model": "gpt-4o-mini" } },
          displayChannel: { id: "allowed" },
        },
      ],
      failoverConfig: { enabled: true, maxRetries: 1, retryStatusCodes: ["5xx"] },
      allowStickyFailover: true,
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "gpt-denied", supportedFormats: "openai", inputPrice: 1, outputPrice: 1 },
      { model: "gpt-4o-mini", supportedFormats: "openai", inputPrice: 1, outputPrice: 1 },
    ]);

    await service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 100 });
    expect(aiProvider.streamChat).toHaveBeenCalledTimes(1);
    expect(aiProvider.streamChat.mock.calls[0]?.[1]).toBe("gpt-4o-mini");
    expect(usageChargeService.hasCoverageOrPositiveBalance).toHaveBeenCalledTimes(1);
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ executionChannelId: "allowed", modelId: "gpt-4o-mini" }),
    );
  });

  it("selects upstream credentials and protocol after the route format transform", async () => {
    configureStatelessGeneration({
      modelMapping: { "customer-model": "gpt-4o-mini" },
      requestFormatTransforms: [{ sourceFormat: "openai-chat-completions", targetFormat: "anthropic" }],
      channel: {
        id: "channel-1",
        allowedFormats: "anthropic",
        anthropicUpstreamUrl: "https://anthropic.example.test",
        anthropicUpstreamApiKey: "fixture-anthropic",
      },
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "gpt-4o-mini", supportedFormats: "anthropic", inputPrice: 1, outputPrice: 1 },
    ]);
    await service.generateTextForUser("user-1", "hello", "customer-model", "token-1", { maxOutputCharacters: 100 });
    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      expect.any(Array),
      "gpt-4o-mini",
      "fixture-anthropic",
      "https://anthropic.example.test",
      "anthropic",
      expect.any(AbortSignal),
    );
  });
  it("generates bounded text through user-owned model routing and billing without persisting prompts or messages", async () => {
    configureStatelessGeneration();
    expect(
      await service.generateTextForUser("user-1", "policy draft fixture", "gpt-4o-mini", "token-1", {
        maxOutputCharacters: 100,
        path: "/iam-fixture/draft",
        requestId: "draft-fixture",
      }),
    ).toBe("hello");
    expect(conversationRepo.findById).not.toHaveBeenCalled();
    expect(conversationRepo.create).not.toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
    expect(messageRepo.findByConversationId).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        relayTokenId: "token-1",
        requestId: "draft-fixture",
        path: "/iam-fixture/draft",
      }),
    );
  });
  it("refuses oversized stateless input before token lookup or upstream side effects", async () => {
    configureStatelessGeneration();
    resourceConfig.apply({
      ...originalResources,
      chat: { resourceLimits: { ...originalResources.chat.resourceLimits, inputLimitBytes: 4 } },
    });
    await expect(
      service.generateTextForUser("user-1", "五个字节", "gpt-4o-mini", "token-1", {
        maxOutputCharacters: 100,
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(relayTokenRepository.findByIdWithChannel).not.toHaveBeenCalled();
    expect(aiProvider.streamChat).not.toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
    expect(AIResourceService.getInstance().snapshot().active).toBe(0);
  });

  it("enforces byte output limits independently of the draft character limit and releases its lease", async () => {
    configureStatelessGeneration();
    resourceConfig.apply({
      ...originalResources,
      chat: { resourceLimits: { ...originalResources.chat.resourceLimits, outputLimitBytes: 4 } },
    });
    await expect(
      service.generateTextForUser("user-1", "x", "gpt-4o-mini", "token-1", {
        maxOutputCharacters: 100,
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(messageRepo.create).not.toHaveBeenCalled();
    expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
    expect(relayUsageRepository.create).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 413 }));
    expect(AIResourceService.getInstance().snapshot().active).toBe(0);
  });

  it("runs stateless upstream work inside the resource and safety scopes and cleans up on success", async () => {
    configureStatelessGeneration();
    aiProvider.streamChat.mockImplementationOnce(() => {
      expect(aiResourceContext.getStore()?.active).toBe(true);
      expect(contentSafetyAttemptContext.getStore()).toBeDefined();
      return createChatStream();
    });
    await expect(
      service.generateTextForUser("user-1", "x", "gpt-4o-mini", "token-1", {
        maxOutputCharacters: 100,
      }),
    ).resolves.toBe("hello");
    expect(AIResourceService.getInstance().snapshot().active).toBe(0);
    expect(aiResourceContext.getStore()).toBeUndefined();
    expect(contentSafetyAttemptContext.getStore()).toBeUndefined();
  });

  it("rejects an audit replacement that exceeds the draft character limit without returning a partial draft", async () => {
    configureStatelessGeneration();
    contentSafetyService.getPublicConfig.mockResolvedValueOnce({
      requestEnabled: true,
      requestAction: "unreachable",
      requestAiEnabled: false,
      responseEnabled: true,
      responseAction: "unreachable",
      responseAiEnabled: true,
    });
    contentSafetyService.evaluate
      .mockResolvedValueOnce({
        text: "x",
        action: "allow",
        matched: false,
        auditInputTokens: 0,
        auditOutputTokens: 0,
        auditDurationMs: 0,
        auditCost: 0,
      })
      .mockResolvedValueOnce({
        text: "replacement too long",
        action: "replace",
        matched: true,
        auditInputTokens: 0,
        auditOutputTokens: 0,
        auditDurationMs: 0,
        auditCost: 0,
      });
    await expect(
      service.generateTextForUser("user-1", "x", "gpt-4o-mini", "token-1", {
        maxOutputCharacters: 5,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(usageChargeService.chargeUsage).toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
    expect(AIResourceService.getInstance().snapshot().active).toBe(0);
  });

  it("preserves whitespace-only chunks in structured generation", async () => {
    configureStatelessGeneration();
    async function* structured() {
      yield { content: '{"value":"', done: false };
      yield { content: " ", done: false };
      yield { content: '"}', done: false };
      yield { done: true, inputTokens: 1, outputTokens: 1 };
    }
    aiProvider.streamChat.mockReturnValue(structured());
    expect(
      await service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", { maxOutputCharacters: 100 }),
    ).toBe('{"value":" "}');
  });
  it("refuses oversized or partial generations after finalizing usage and never returns a partial draft", async () => {
    configureStatelessGeneration();
    await expect(
      service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", { maxOutputCharacters: 4 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(usageChargeService.chargeUsage).toHaveBeenCalled();
    expect(messageRepo.create).not.toHaveBeenCalled();
    aiProvider.streamChat.mockReturnValue(createPartialFailingStream(new Error("fixture provider failure")));
    await expect(
      service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", { maxOutputCharacters: 100 }),
    ).rejects.toThrow("fixture provider failure");
  });
  it("refuses foreign relay tokens, invalid limits and cancellation before a model call", async () => {
    configureStatelessGeneration();
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({ id: "token-1", userId: "foreign" });
    await expect(
      service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", { maxOutputCharacters: 100 }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", { maxOutputCharacters: 0 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", {
        maxOutputCharacters: 100,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    for (const extra of [{ status: 0 }, { status: 1, expiresAt: new Date(0) }]) {
      relayTokenRepository.findByIdWithChannel.mockResolvedValue({ id: "token-1", userId: "user-1", ...extra });
      await expect(
        service.generateTextForUser("user-1", "fixture", "gpt-4o-mini", "token-1", { maxOutputCharacters: 100 }),
      ).rejects.toThrow(ForbiddenError);
    }
    expect(aiProvider.streamChat).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when creating conversation with invalid relay token", async () => {
    relayTokenRepository.findById.mockResolvedValue(null);

    await expect(service.createConversation("user-1", "t", "token-1")).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError when conversation does not exist", async () => {
    conversationRepo.findById.mockResolvedValue(null);

    await expect(service.getConversation("conv-1", "user-1")).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when sending message without relay token", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: null });

    const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini");

    await expect(iterator.next()).rejects.toThrow(BadRequestError);
  });

  it("throws BadRequestError when balance and monthly pass both unavailable", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      channelId: "channel-1",
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      channel: { id: "channel-1", name: "main" },
    });
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(false);

    const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini");

    await expect(iterator.next()).rejects.toThrow(BadRequestError);
  });

  it("checks the automatic-pool multiplier limit before streaming", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: null,
      routingMode: "automatic-pool",
      automaticProxyPoolChannel: { id: "pool-1", name: "Pool", channelType: "automatic-proxy-pool" },
      channel: null,
      allowedModels: null,
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "gpt-4o-mini", provider: "gpt-4o-mini", supportedFormats: "openai" },
    ]);
    relayProxyService.getChatAttemptPlan.mockResolvedValue({
      channels: [
        {
          resolvedChannel: {
            id: "member-expensive",
            name: "Expensive",
            multiplier: 2,
            allowedFormats: "openai",
            openaiUpstreamUrl: "https://expensive.example.com",
            openaiUpstreamApiKey: "expensive-key",
          },
          displayChannel: { id: "pool-1", name: "Pool" },
        },
      ],
      failoverConfig: {
        enabled: true,
        maxRetries: 0,
        retryStatusCodes: ["5xx"],
        failoverThreshold: 1,
        failbackCooldownMinutes: 0,
        maxAcceptedChannelMultiplier: 1,
      },
      allowStickyFailover: false,
    });
    relayProxyService.assertRelayChannelMultiplierAccepted.mockImplementation(() => {
      throw new BadRequestError("exceeding the token limit 1");
    });
    messageRepo.findByConversationId.mockResolvedValue([]);
    messageRepo.getContextSize.mockResolvedValue({ count: 0, bytes: 0 });

    const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini");

    await expect(iterator.next()).rejects.toThrow("exceeding the token limit 1");
    expect(relayProxyService.assertRelayChannelMultiplierAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ id: "member-expensive", multiplier: 2 }),
      expect.objectContaining({ maxAcceptedChannelMultiplier: 1 }),
    );
    expect(aiProvider.streamChat).not.toHaveBeenCalled();
  });

  it("streams response and charges usage through unified billing API", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: "channel-1",
      allowedModels: null,
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      channel: {
        id: "channel-1",
        name: "main",
        multiplier: 1,
        allowedModels: null,
        openaiUpstreamUrl: null,
        openaiUpstreamApiKey: null,
      },
    });
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);

    messageRepo.create
      .mockResolvedValueOnce(createPersistedMessage({ id: "user-msg-1", role: "user" }))
      .mockResolvedValueOnce(createPersistedMessage());

    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);

    aiProvider.streamChat.mockReturnValue(createChatStream());

    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "gpt-4o-mini",
        provider: null,
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "openai",
      },
    ]);

    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });

    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });

    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini")) chunks.push(chunk);

    expect(chunks[0]).toEqual({ type: "delta", content: "hello", done: false });
    expect(chunks.at(-1)?.done).toBe(true);

    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        channelId: "channel-1",
        modelName: "gpt-4o-mini",
        balanceChargeMode: "allow-negative",
      }),
    );
  });

  it("uses the next proxy-planned channel when the first channel completes without visible output", async () => {
    const firstChannel = {
      id: "channel-first",
      name: "first",
      multiplier: 1,
      allowedModels: JSON.stringify(["First-channel pricing"]),
      openaiUpstreamUrl: "https://first.example.com",
      openaiUpstreamApiKey: "first-key",
    };
    const secondChannel = {
      id: "channel-second",
      name: "second",
      multiplier: 1,
      allowedModels: JSON.stringify(["Second-channel pricing"]),
      openaiUpstreamUrl: "https://second.example.com",
      openaiUpstreamApiKey: "second-key",
    };
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: firstChannel.id,
      upstreamUrl: null,
      upstreamApiKey: null,
      allowedModels: null,
      channel: firstChannel,
    });
    relayProxyService.getChatAttemptPlan.mockResolvedValue({
      channels: [
        { resolvedChannel: firstChannel, displayChannel: firstChannel },
        { resolvedChannel: secondChannel, displayChannel: secondChannel },
      ],
      failoverConfig: {
        enabled: true,
        maxRetries: 1,
        retryStatusCodes: ["5xx"],
        failoverThreshold: 1,
        failbackCooldownMinutes: 0,
      },
      allowStickyFailover: true,
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "First-channel pricing",
        provider: "gpt-4o-mini",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1,
        cacheReadMultiplier: 1,
        supportedFormats: "openai",
      },
      {
        model: "Second-channel pricing",
        provider: "gpt-4o-mini",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 3000,
        outputPrice: 4000,
        cacheCreationMultiplier: 1,
        cacheReadMultiplier: 1,
        supportedFormats: "openai",
      },
    ]);
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    messageRepo.create.mockResolvedValue(createPersistedMessage());
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat.mockReturnValueOnce(createEmptyChatStream()).mockReturnValueOnce(createChatStream());

    for await (const _chunk of service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini")) {
      // Exhaust the stream.
    }

    expect(aiProvider.streamChat).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      "gpt-4o-mini",
      "first-key",
      "https://first.example.com",
      "openai",
      expect.any(AbortSignal),
    );
    expect(aiProvider.streamChat).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      "gpt-4o-mini",
      "second-key",
      "https://second.example.com",
      "openai",
      expect.any(AbortSignal),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        executionChannelId: "channel-second",
        modelId: "gpt-4o-mini",
        modelName: "Second-channel pricing",
        inputRate: 0.003,
        outputRate: 0.004,
      }),
    );
  });

  it("fails over after a selected-model capacity response even when 429 is not configured", async () => {
    const firstChannel = {
      id: "channel-first",
      name: "first",
      multiplier: 1,
      allowedModels: null,
      openaiUpstreamUrl: "https://first.example.com",
      openaiUpstreamApiKey: "first-key",
    };
    const secondChannel = {
      id: "channel-second",
      name: "second",
      multiplier: 1,
      allowedModels: null,
      openaiUpstreamUrl: "https://second.example.com",
      openaiUpstreamApiKey: "second-key",
    };
    const capacityError = Object.assign(new Error("Selected model is at capacity. Please try a different model."), {
      response: {
        status: 429,
        data: { error: { message: "Selected model is at capacity. Please try a different model." } },
      },
    });

    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: firstChannel.id,
      upstreamUrl: null,
      upstreamApiKey: null,
      allowedModels: null,
      channel: firstChannel,
    });
    relayProxyService.getChatAttemptPlan.mockResolvedValue({
      channels: [
        { resolvedChannel: firstChannel, displayChannel: firstChannel },
        { resolvedChannel: secondChannel, displayChannel: secondChannel },
      ],
      failoverConfig: {
        enabled: true,
        maxRetries: 1,
        retryStatusCodes: ["503"],
        failoverThreshold: 1,
        failbackCooldownMinutes: 0,
      },
      allowStickyFailover: true,
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "gpt-4o-mini",
        provider: null,
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1,
        cacheReadMultiplier: 1,
        supportedFormats: "openai",
      },
    ]);
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    messageRepo.create.mockResolvedValue(createPersistedMessage());
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat
      .mockReturnValueOnce(createFailingStream(capacityError))
      .mockReturnValueOnce(createChatStream());

    for await (const _chunk of service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini")) {
      // Exhaust the recovered stream.
    }

    expect(aiProvider.streamChat).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      "gpt-4o-mini",
      "second-key",
      "https://second.example.com",
      "openai",
      expect.any(AbortSignal),
    );
    expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ executionChannelId: "channel-second" }),
    );
  });

  it("persists a stopped assistant response when the client aborts", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: "channel-1",
      allowedModels: null,
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      channel: { id: "channel-1", name: "main", multiplier: 1, allowedModels: null },
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "gpt-4o-mini",
        provider: null,
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1,
        cacheReadMultiplier: 1,
        supportedFormats: "openai",
      },
    ]);
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    messageRepo.create.mockResolvedValue(createPersistedMessage());
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat.mockReturnValue(
      createFailingStream(Object.assign(new Error("cancelled"), { code: "ERR_CANCELED" })),
    );
    const controller = new AbortController();
    aiProvider.streamChat.mockImplementation(() => {
      controller.abort();
      return createFailingStream(Object.assign(new Error("cancelled"), { code: "ERR_CANCELED" }));
    });

    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini", undefined, {
      signal: controller.signal,
    }))
      chunks.push(chunk);

    expect(chunks).toEqual([]);
    expect(messageRepo.create).toHaveBeenLastCalledWith(expect.objectContaining({ completionStatus: "stopped" }));
  });

  it.each([new Error("upstream disconnected"), new PayloadTooLargeError()])(
    "persists a failed partial response without successful completion (%s)",
    async (failure) => {
      conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
      relayTokenRepository.findByIdWithChannel.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        token: "rlt_x",
        channelId: "channel-1",
        allowedModels: null,
        upstreamUrl: "https://upstream.example.com",
        upstreamApiKey: "upstream-key",
        channel: { id: "channel-1", name: "main", multiplier: 1, allowedModels: null },
      });
      modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
        {
          model: "gpt-4o-mini",
          provider: null,
          pricingType: "token-based",
          fixedPrice: null,
          inputPrice: 1000,
          outputPrice: 2000,
          cacheCreationMultiplier: 1,
          cacheReadMultiplier: 1,
          supportedFormats: "openai",
        },
      ]);
      usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
      usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
      relayUsageRepository.create.mockResolvedValue({});
      relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
      messageRepo.create.mockResolvedValue(createPersistedMessage());
      messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
      aiProvider.streamChat.mockReturnValue(createPartialFailingStream(failure));

      const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-4o-mini");

      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { type: "delta", content: "partial", done: false },
      });
      await expect(iterator.next()).rejects.toThrow(failure);
      if (failure instanceof PayloadTooLargeError) {
        expect(usageChargeService.chargeUsage).not.toHaveBeenCalled();
        expect(relayUsageRepository.create).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 413 }));
        expect(messageRepo.create.mock.calls.at(-1)?.[0].cost.toNumber()).toBe(0);
      } else expect(usageChargeService.chargeUsage).toHaveBeenCalledOnce();
      expect(messageRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          completionStatus: "failed",
          content: "partial",
        }),
      );
    },
  );

  it("filters available models by channel and token constraints", async () => {
    relayTokenRepository.findByUserIdWithRelations.mockResolvedValue([
      {
        id: "token-1",
        name: "token-name",
        token: "token-value",
        allowedModels: "model-a,model-c",
        channel: {
          allowedModels: JSON.stringify(["model-a", "model-b"]),
        },
      },
    ]);

    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "model-a", provider: null, supportedFormats: "openai" },
      { model: "model-b", provider: null, supportedFormats: "openai" },
      { model: "model-c", provider: null, supportedFormats: "openai" },
    ]);
    relayProxyService.getAvailableModelMapForToken.mockResolvedValue({
      openai: ["model-a"],
      anthropic: [],
      gemini: [],
    });

    const result = await service.getAvailableTokens("user-1");

    expect(result).toEqual([{ id: "token-1", name: "token-name", allowedModels: "model-a" }]);
    expect(result[0]).not.toHaveProperty("token");
  });

  it("returns empty available models when token channel does not support openai format", async () => {
    relayTokenRepository.findByUserIdWithRelations.mockResolvedValue([
      {
        id: "token-1",
        name: "token-name",
        token: "token-value",
        allowedModels: null,
        channel: {
          allowedFormats: "anthropic",
          allowedModels: null,
        },
      },
    ]);

    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      { model: "model-a", provider: null, supportedFormats: "openai" },
    ]);
    relayProxyService.getAvailableModelMapForToken.mockResolvedValue({
      openai: [],
      anthropic: [],
      gemini: [],
    });

    const result = await service.getAvailableTokens("user-1");

    expect(result).toHaveLength(1);
    expect(result[0].allowedModels).toBe("");
  });

  it("routes anthropic-compatible chat requests with anthropic format", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: "channel-1",
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      allowedModels: null,
      channel: {
        id: "channel-1",
        name: "main",
        allowedModels: null,
      },
    });

    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "claude-like-model",
        provider: "claude-3-5-sonnet",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "anthropic",
      },
    ]);

    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    messageRepo.create
      .mockResolvedValueOnce(createPersistedMessage({ id: "user-msg-1", role: "user" }))
      .mockResolvedValueOnce(createPersistedMessage());
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat.mockReturnValue(createChatStream());

    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of service.sendMessage("conv-1", "user-1", "hello", "claude-3-5-sonnet")) chunks.push(chunk);

    expect(chunks[0]).toEqual({ type: "delta", content: "hello", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      "claude-3-5-sonnet",
      "upstream-key",
      "https://upstream.example.com",
      "anthropic",
      expect.any(AbortSignal),
    );
  });

  it("accepts a model ID from the chat client and sends that ID upstream", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      token: "rlt_x",
      channelId: "channel-1",
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      allowedModels: null,
      channel: { id: "channel-1", name: "main", allowedModels: null },
    });
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "Claude Sonnet",
        provider: "claude-sonnet-4-20250514",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "anthropic",
      },
    ]);
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    messageRepo.create
      .mockResolvedValueOnce(createPersistedMessage({ id: "user-msg-1", role: "user" }))
      .mockResolvedValueOnce(createPersistedMessage());
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat.mockReturnValue(createChatStream());

    for await (const _chunk of service.sendMessage("conv-1", "user-1", "hello", "claude-sonnet-4-20250514")) {
      // Drain the stream.
    }

    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      "claude-sonnet-4-20250514",
      "upstream-key",
      "https://upstream.example.com",
      "anthropic",
      expect.any(AbortSignal),
    );
  });

  it.each(["gpt-5.4-a", "gpt-5.4"])(
    "selects channel pricing %s for a shared model ID and sends only the ID upstream",
    async (pricingName) => {
      conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
      relayTokenRepository.findByIdWithChannel.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        channelId: "channel-1",
        upstreamUrl: "https://upstream.example.com",
        upstreamApiKey: "upstream-key",
        allowedModels: null,
        channel: {
          id: "channel-1",
          name: "main",
          allowedModels: JSON.stringify([pricingName]),
        },
      });

      modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
        {
          model: "gpt-5.4-a",
          provider: "gpt-5.4",
          pricingType: "token-based",
          fixedPrice: null,
          inputPrice: 1000,
          outputPrice: 2000,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
          supportedFormats: "openai",
        },
        {
          model: "gpt-5.4",
          provider: "gpt-5.4",
          pricingType: "token-based",
          fixedPrice: null,
          inputPrice: 1000,
          outputPrice: 2000,
          cacheCreationMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
          supportedFormats: "openai",
        },
      ]);

      usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
      usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
      relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
      messageRepo.create.mockResolvedValue(createPersistedMessage());
      messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
      aiProvider.streamChat.mockReturnValue(createChatStream());

      for await (const _chunk of service.sendMessage("conv-1", "user-1", "hello", "gpt-5.4")) {
        // Drain the stream.
      }

      expect(aiProvider.streamChat).toHaveBeenCalledWith(
        expect.any(Array),
        "gpt-5.4",
        "upstream-key",
        "https://upstream.example.com",
        "openai",
        expect.any(AbortSignal),
      );
      expect(usageChargeService.chargeUsage).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "gpt-5.4", modelName: pricingName, executionChannelId: "channel-1" }),
      );
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: "assistant", model: pricingName }),
      );
    },
  );

  it.each(["Claude Sonnet", "claude-sonnet-4-20250514"])(
    "rejects a display name or differently cased model ID: %s",
    async (requestedModel) => {
      conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
      relayTokenRepository.findByIdWithChannel.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        channel: { id: "channel-1" },
      });
      modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
        { model: "Claude Sonnet", provider: "Claude-Sonnet-4-20250514" },
      ]);
      await expect(service.sendMessage("conv-1", "user-1", "hello", requestedModel).next()).rejects.toThrow(
        "is not configured",
      );
      expect(aiProvider.streamChat).not.toHaveBeenCalled();
      expect(messageRepo.create).not.toHaveBeenCalled();
    },
  );

  it("accepts a unique provider value as the canonical model ID", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      channelId: "channel-1",
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      allowedModels: null,
      channel: {
        name: "main",
        allowedModels: null,
      },
    });

    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "gpt-5.4-.1C",
        provider: "gpt-5.4",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "openai",
      },
    ]);

    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    relayConfigRepository.findLatestActive.mockResolvedValue({ globalMultiplier: 1 });
    usageChargeService.chargeUsage.mockResolvedValue({ applied: true });
    messageRepo.create
      .mockResolvedValueOnce(createPersistedMessage({ id: "user-msg-1", role: "user" }))
      .mockResolvedValueOnce(createPersistedMessage());
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat.mockReturnValue(createChatStream());

    for await (const _chunk of service.sendMessage("conv-1", "user-1", "hello", "gpt-5.4")) {
      // Drain the stream.
    }

    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      "gpt-5.4",
      "upstream-key",
      "https://upstream.example.com",
      "openai",
      expect.any(AbortSignal),
    );
  });

  it("rejects model when relay token allow-list does not include requested model ID", async () => {
    conversationRepo.findById.mockResolvedValue({ id: "conv-1", userId: "user-1", relayTokenId: "token-1" });
    relayTokenRepository.findByIdWithChannel.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      channelId: "channel-1",
      upstreamUrl: "https://upstream.example.com",
      upstreamApiKey: "upstream-key",
      allowedModels: "gpt-4o-mini",
      channel: {
        id: "channel-1",
        name: "main",
        allowedModels: null,
      },
    });
    usageChargeService.hasCoverageOrPositiveBalance.mockResolvedValue(true);
    messageRepo.create.mockResolvedValue(createPersistedMessage({ id: "user-msg-1", role: "user" }));
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);

    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([
      {
        model: "gpt-4o-mini",
        provider: "gpt-4o-mini",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "openai",
      },
      {
        model: "gpt-5.4-.1C",
        provider: "gpt-5.4",
        pricingType: "token-based",
        fixedPrice: null,
        inputPrice: 1000,
        outputPrice: 2000,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
        supportedFormats: "openai",
      },
    ]);

    const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-5.4");

    await expect(iterator.next()).rejects.toThrow("does not allow model");
  });
});
