import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { OJQAService } from "../../../src/services/oj-submitter/oj-qa.service";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../../src/util/errors";

const { anthropicMessagesMock, anthropicCtorMock } = vi.hoisted(() => ({
  anthropicMessagesMock: vi.fn(),
  anthropicCtorMock: vi.fn(),
}));

vi.mock("@/util/anthropic-upstream.client", () => ({
  AnthropicUpstreamClient: class {
    constructor(channelName?: string) {
      anthropicCtorMock(channelName);
    }

    messages = anthropicMessagesMock;
  },
}));

describe("OJQAService", () => {
  const ojApiKeyRepository = {
    findActiveByKey: vi.fn(),
  };

  const ojModelPricingRepository = {
    findActiveByModel: vi.fn(),
  };

  const ojUsageRepository = {
    chargeAndRecordUsage: vi.fn(),
    queryUsageStats: vi.fn(),
  };

  const balanceService = {
    getBalance: vi.fn(),
  };

  const OJQAServiceCtor = OJQAService as unknown as new (...args: any[]) => OJQAService;

  const service = new OJQAServiceCtor(ojApiKeyRepository, ojModelPricingRepository, ojUsageRepository, balanceService);

  const pricingRecord = {
    inputPrice: new Decimal(1000),
    outputPrice: new Decimal(2000),
    multiplier: new Decimal(1.5),
    cacheCreationMultiplier: new Decimal(1.25),
    cacheReadMultiplier: new Decimal(0.1),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates active API key and returns user/channel info", async () => {
    ojApiKeyRepository.findActiveByKey.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      expiresAt: null,
      channel: { name: "channel-a" },
    });

    const result = await service.validateAPIKey("ojqa_token");

    expect(result).toEqual({
      userId: "user-1",
      keyId: "key-1",
      channelName: "channel-a",
    });
  });

  it("rejects missing or expired API keys", async () => {
    ojApiKeyRepository.findActiveByKey.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-1",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      channel: null,
    });

    await expect(service.validateAPIKey("missing")).rejects.toThrow(UnauthorizedError);
    await expect(service.validateAPIKey("expired")).rejects.toThrow("API key has expired");
  });

  it("loads model pricing or throws when absent", async () => {
    ojModelPricingRepository.findActiveByModel.mockResolvedValueOnce(pricingRecord).mockResolvedValueOnce(null);

    await expect(service.getModelPricing("claude-haiku")).resolves.toBe(pricingRecord);
    await expect(service.getModelPricing("missing-model")).rejects.toThrow(NotFoundError);
  });

  it("calculates cost with cache token multipliers and rounds down to 4 decimals", () => {
    const cost = service.calculateCost(1000, 500, 200, 300, pricingRecord);

    expect(cost).toBe(3.28);
  });

  it("rejects askQuestion when balance is not positive", async () => {
    ojApiKeyRepository.findActiveByKey.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      expiresAt: null,
      channel: null,
    });
    balanceService.getBalance.mockResolvedValue({ balance: new Decimal(0) });

    await expect(
      service.askQuestion("ojqa_token", "What is 2+2?", "claude-haiku", undefined, "127.0.0.1"),
    ).rejects.toThrow(BadRequestError);
    expect(anthropicMessagesMock).not.toHaveBeenCalled();
  });

  it("calls upstream AI, computes cost, and records usage", async () => {
    ojApiKeyRepository.findActiveByKey.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      expiresAt: null,
      channel: { name: "channel-a" },
    });
    balanceService.getBalance.mockResolvedValue({ balance: new Decimal(10) });
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(pricingRecord);
    anthropicMessagesMock.mockResolvedValue({
      content: [{ type: "text", text: "The answer" }],
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    });
    ojUsageRepository.chargeAndRecordUsage.mockResolvedValue(true);

    const result = await service.askQuestion("ojqa_token", "What is 2+2?", "claude-haiku", 2048, "127.0.0.1");

    expect(anthropicCtorMock).toHaveBeenCalledWith("channel-a");
    expect(anthropicMessagesMock).toHaveBeenCalledWith({
      model: "claude-haiku",
      max_tokens: 2048,
      messages: [{ role: "user", content: "What is 2+2?" }],
    });
    expect(ojUsageRepository.chargeAndRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        keyId: "key-1",
        model: "claude-haiku",
        answer: "The answer",
        totalTokens: 1500,
        cost: 2.8299,
        ipAddress: "127.0.0.1",
        inputRate: 0.001,
        outputRate: 0.002,
        multiplier: pricingRecord.multiplier,
        cacheCreationMultiplier: pricingRecord.cacheCreationMultiplier,
        cacheReadMultiplier: pricingRecord.cacheReadMultiplier,
      }),
    );
    expect(result).toEqual({
      answer: "The answer",
      tokensUsed: 1500,
      cost: 2.8299,
    });
  });

  it("wraps upstream failures as BadRequestError", async () => {
    ojApiKeyRepository.findActiveByKey.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      expiresAt: null,
      channel: null,
    });
    balanceService.getBalance.mockResolvedValue({ balance: new Decimal(10) });
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(pricingRecord);
    anthropicMessagesMock.mockRejectedValue(new Error("upstream exploded"));

    await expect(
      service.askQuestion("ojqa_token", "What is 2+2?", "claude-haiku", undefined, "127.0.0.1"),
    ).rejects.toThrow("AI service error: upstream exploded");
  });

  it("rejects when charge and record reports insufficient balance", async () => {
    ojApiKeyRepository.findActiveByKey.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      expiresAt: null,
      channel: null,
    });
    balanceService.getBalance.mockResolvedValue({ balance: new Decimal(10) });
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(pricingRecord);
    anthropicMessagesMock.mockResolvedValue({
      content: [{ type: "text", text: "Late answer" }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    ojUsageRepository.chargeAndRecordUsage.mockResolvedValue(false);

    await expect(
      service.askQuestion("ojqa_token", "What is 2+2?", "claude-haiku", undefined, "127.0.0.1"),
    ).rejects.toThrow("Insufficient balance for this request");
  });

  it("computes usage statistics averages from repository output", async () => {
    const startTime = new Date("2026-04-01T00:00:00.000Z");
    const endTime = new Date("2026-04-16T00:00:00.000Z");
    ojUsageRepository.queryUsageStats.mockResolvedValue({
      total: 2,
      records: [
        {
          id: "usage-1",
          model: "claude-haiku",
          question: "Q1",
          answer: "A1",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cost: new Decimal(0.2),
          createTime: new Date("2026-04-15T00:00:00.000Z"),
        },
      ],
      totalTokens: 25,
      totalCost: 0.5,
      requestCount: 2,
    });

    const result = await service.getUsageStats("user-1", 2, 10, startTime, endTime);

    expect(ojUsageRepository.queryUsageStats).toHaveBeenCalledWith("user-1", 2, 10, startTime, endTime);
    expect(result.avgTokensPerRequest).toBe(13);
    expect(result.avgCostPerRequest).toBe(0.25);
    expect(result.records).toHaveLength(1);
  });
});
