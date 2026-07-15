import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatService } from "../../../src/services/chat/chat.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../src/util/errors";

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

describe("ChatService", () => {
  const conversationRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const messageRepo = {
    create: vi.fn(),
    findByConversationId: vi.fn(),
    findById: vi.fn(),
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
    getAvailableModelMapForToken: vi.fn(),
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
  );

  beforeEach(() => {
    vi.clearAllMocks();
    modelPricingRepository.listActiveOrderedByModel.mockResolvedValue([]);
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
      .mockResolvedValueOnce({ id: "user-msg-1", conversationId: "conv-1", role: "user", content: "hello" })
      .mockResolvedValueOnce({ id: "assistant-msg-1", conversationId: "conv-1", role: "assistant", content: "hello" });

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

    expect(chunks[0]).toEqual({ content: "hello", done: false });
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

    expect(result).toHaveLength(1);
    expect(result[0].allowedModels).toBe("model-a");
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
      .mockResolvedValueOnce({ id: "user-msg-1", conversationId: "conv-1", role: "user", content: "hello" })
      .mockResolvedValueOnce({ id: "assistant-msg-1", conversationId: "conv-1", role: "assistant", content: "hello" });
    messageRepo.findByConversationId.mockResolvedValue([{ role: "user", content: "hello" }]);
    aiProvider.streamChat.mockReturnValue(createChatStream());

    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of service.sendMessage("conv-1", "user-1", "hello", "claude-like-model")) chunks.push(chunk);

    expect(chunks[0]).toEqual({ content: "hello", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
    expect(aiProvider.streamChat).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      "claude-3-5-sonnet",
      "upstream-key",
      "https://upstream.example.com",
      "anthropic",
    );
  });

  it("rejects provider-id requests when no exact model name is configured", async () => {
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
        allowedModels: null,
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
        model: "gpt-5.4-b",
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

    await expect(iterator.next()).rejects.toThrow("is not configured");
  });

  it("rejects provider value even when provider is unique", async () => {
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

    const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-5.4");

    await expect(iterator.next()).rejects.toThrow("is not configured");
  });

  it("rejects model when relay token allow-list does not include requested model name", async () => {
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
    messageRepo.create.mockResolvedValue({
      id: "user-msg-1",
      conversationId: "conv-1",
      role: "user",
      content: "hello",
    });
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

    const iterator = service.sendMessage("conv-1", "user-1", "hello", "gpt-5.4-.1C");

    await expect(iterator.next()).rejects.toThrow("does not allow model");
  });
});
