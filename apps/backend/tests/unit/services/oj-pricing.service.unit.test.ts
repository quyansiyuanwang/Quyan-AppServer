import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { OJPricingService } from "../../../src/services/oj-submitter/oj-pricing.service";
import { BadRequestError, NotFoundError } from "../../../src/util/errors";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "../../../src/constant/pricing";

describe("OJPricingService", () => {
  const ojModelPricingRepository = {
    listActive: vi.fn(),
    findByModel: vi.fn(),
    findActiveByModel: vi.fn(),
    create: vi.fn(),
    updateByModel: vi.fn(),
    softDeleteByModel: vi.fn(),
  };
  const businessLogService = {
    logOperation: vi.fn(),
  };

  const OJPricingServiceCtor = OJPricingService as unknown as new (...args: any[]) => OJPricingService;

  const service = new OJPricingServiceCtor(ojModelPricingRepository, businessLogService);

  const pricingRecord = {
    id: "pricing-1",
    model: "claude-sonnet",
    inputPrice: new Decimal(12.34),
    outputPrice: new Decimal(56.78),
    multiplier: new Decimal(1.5),
    cacheCreationMultiplier: new Decimal(1.25),
    cacheReadMultiplier: new Decimal(0.1),
    provider: "anthropic",
    createTime: new Date("2026-04-16T00:00:00.000Z"),
    updateTime: new Date("2026-04-16T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists pricing with Decimal fields converted to numbers", async () => {
    ojModelPricingRepository.listActive.mockResolvedValue([pricingRecord]);

    const result = await service.listPricing();

    expect(result).toEqual([
      expect.objectContaining({
        inputPrice: 12.34,
        outputPrice: 56.78,
        multiplier: 1.5,
        cacheCreationMultiplier: 1.25,
        cacheReadMultiplier: 0.1,
      }),
    ]);
  });

  it("throws when fetching missing pricing", async () => {
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(null);

    await expect(service.getPricing("missing-model")).rejects.toThrow(NotFoundError);
  });

  it("creates pricing with default cache multipliers and multiplier", async () => {
    ojModelPricingRepository.findByModel.mockResolvedValue(null);
    ojModelPricingRepository.create.mockImplementation(async (data) => ({
      ...pricingRecord,
      ...data,
    }));

    await service.createPricing(
      {
        model: "claude-haiku",
        inputPrice: 2,
        outputPrice: 4,
      },
      "admin-user",
    );

    const createPayload = ojModelPricingRepository.create.mock.calls[0][0];
    expect(Number(createPayload.inputPrice)).toBe(2);
    expect(Number(createPayload.outputPrice)).toBe(4);
    expect(Number(createPayload.multiplier)).toBe(1);
    expect(Number(createPayload.cacheCreationMultiplier)).toBe(DEFAULT_CACHE_CREATION_MULTIPLIER);
    expect(Number(createPayload.cacheReadMultiplier)).toBe(DEFAULT_CACHE_READ_MULTIPLIER);
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "OJ_PRICING_CREATE",
        actorUserId: "admin-user",
      }),
    );
  });

  it("rejects duplicated pricing model", async () => {
    ojModelPricingRepository.findByModel.mockResolvedValue(pricingRecord);

    await expect(
      service.createPricing(
        {
          model: "claude-sonnet",
          inputPrice: 1,
          outputPrice: 2,
        },
        "admin-user",
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("updates only provided pricing fields", async () => {
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(pricingRecord);
    ojModelPricingRepository.updateByModel.mockImplementation(async (_model, data) => ({
      ...pricingRecord,
      ...data,
    }));

    const result = await service.updatePricing(
      "claude-sonnet",
      {
        outputPrice: 88.8,
        cacheReadMultiplier: 0.25,
      },
      "admin-user",
    );

    const updatePayload = ojModelPricingRepository.updateByModel.mock.calls[0][1];
    expect(updatePayload.inputPrice).toBeUndefined();
    expect(Number(updatePayload.outputPrice)).toBe(88.8);
    expect(Number(updatePayload.cacheReadMultiplier)).toBe(0.25);
    expect(result.outputPrice).toBe(88.8);
    expect(result.cacheReadMultiplier).toBe(0.25);
  });

  it("throws when deleting missing pricing", async () => {
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(null);

    await expect(service.deletePricing("missing-model", "admin-user")).rejects.toThrow(NotFoundError);
  });

  it("soft deletes existing pricing", async () => {
    ojModelPricingRepository.findActiveByModel.mockResolvedValue(pricingRecord);

    const result = await service.deletePricing("claude-sonnet", "admin-user");

    expect(ojModelPricingRepository.softDeleteByModel).toHaveBeenCalledWith("claude-sonnet");
    expect(result).toEqual({ success: true });
  });
});
