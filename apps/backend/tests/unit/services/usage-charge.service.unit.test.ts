import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageChargeService } from "../../../src/services/billing/usage-charge.service";
import type { RelayFinalizeChargeInput } from "../../../src/store/relay/relay-proxy.store";

const createChargeInput = (overrides: Partial<RelayFinalizeChargeInput> = {}): RelayFinalizeChargeInput => ({
  userId: "user-1",
  relayTokenId: "token-1",
  requestId: "request-1",
  requestTokens: 10,
  responseTokens: 20,
  totalTokens: 30,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  path: "/relay/proxy/v1/chat/completions",
  method: "POST",
  statusCode: 200,
  ipAddress: "127.0.0.1",
  totalOutputTime: 123,
  timeToFirstByte: 12,
  isStreaming: false,
  cost: 1.2345,
  modelName: "gpt-4o-mini",
  executionChannelId: "channel-1",
  displayChannelId: "channel-1",
  displayChannelName: "Default Channel",
  channelId: "channel-1",
  monthlyPassCoverageAt: new Date("2026-01-01T00:00:00.000Z"),
  inputRate: 0.000001,
  outputRate: 0.000002,
  multiplier: 1,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
  channelMultiplier: 1,
  globalMultiplier: 1,
  ...overrides,
});

describe("UsageChargeService", () => {
  const relayProxyRepository = {
    findBalanceAccountByUserId: vi.fn(),
    finalizeChargedUsage: vi.fn(),
  };

  const monthlyPassService = {
    hasActiveCoverage: vi.fn(),
  };

  const distributedLockService = {
    runWithLock: vi.fn(),
  };
  const overdraft = { resolve: vi.fn(), initialize: vi.fn() };

  const UsageChargeServiceCtor = UsageChargeService as unknown as new (...args: any[]) => UsageChargeService;

  const service = new UsageChargeServiceCtor(
    relayProxyRepository,
    monthlyPassService,
    distributedLockService,
    overdraft,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    overdraft.resolve.mockResolvedValue({ categories: ["relay", "chat"], limit: 0 });
    distributedLockService.runWithLock.mockImplementation(async (_key: string, task: () => Promise<any>) => task());
  });

  it("returns true immediately when monthly pass coverage is active", async () => {
    monthlyPassService.hasActiveCoverage.mockResolvedValue(true);

    const result = await service.hasCoverageOrPositiveBalance({
      userId: "user-1",
      modelName: "gpt-4o-mini",
      channelId: "channel-1",
    });

    expect(result).toBe(true);
    expect(monthlyPassService.hasActiveCoverage).toHaveBeenCalledTimes(1);
    expect(relayProxyRepository.findBalanceAccountByUserId).not.toHaveBeenCalled();
  });

  it("falls back to balance check when monthly pass coverage is not active", async () => {
    monthlyPassService.hasActiveCoverage.mockResolvedValue(false);
    relayProxyRepository.findBalanceAccountByUserId.mockResolvedValue({ balance: 10 });

    const result = await service.hasCoverageOrPositiveBalance({
      userId: "user-1",
      modelName: "gpt-4o-mini",
      channelId: "channel-1",
    });

    expect(result).toBe(true);
    expect(relayProxyRepository.findBalanceAccountByUserId).toHaveBeenCalledWith("user-1");
  });

  it("returns false when no coverage and non-positive balance", async () => {
    monthlyPassService.hasActiveCoverage.mockResolvedValue(false);
    relayProxyRepository.findBalanceAccountByUserId.mockResolvedValue({ balance: 0 });

    const result = await service.hasCoverageOrPositiveBalance({
      userId: "user-1",
      modelName: "gpt-4o-mini",
      channelId: "channel-1",
    });

    expect(result).toBe(false);
  });

  it("defaults balanceChargeMode to strict when omitted", async () => {
    relayProxyRepository.finalizeChargedUsage.mockResolvedValue({ applied: true });

    const input = createChargeInput({ balanceChargeMode: undefined });
    const result = await service.chargeUsage(input);

    expect(result).toEqual({ applied: true });
    expect(relayProxyRepository.finalizeChargedUsage).toHaveBeenCalledWith({
      ...input,
      balanceChargeMode: "strict",
    });
    expect(distributedLockService.runWithLock).toHaveBeenCalledTimes(1);
  });
  it("admits a negative balance only for allowed categories with remaining shared credit", async () => {
    monthlyPassService.hasActiveCoverage.mockResolvedValue(false);
    relayProxyRepository.findBalanceAccountByUserId.mockResolvedValue({ balance: -9, status: 1 });
    overdraft.resolve.mockResolvedValue({ categories: ["relay"], limit: 10 });
    const input = { userId: "user-1", modelName: "fixture-model", channelId: "channel-1" };
    await expect(service.hasCoverageOrPositiveBalance(input)).resolves.toBe(true);
    await expect(service.hasCoverageOrPositiveBalance({ ...input, category: "chat" })).resolves.toBe(false);
    relayProxyRepository.findBalanceAccountByUserId.mockResolvedValue({ balance: -10, status: 1 });
    await expect(service.hasCoverageOrPositiveBalance(input)).resolves.toBe(false);
    relayProxyRepository.findBalanceAccountByUserId.mockResolvedValue({ balance: 10, status: 0 });
    await expect(service.hasCoverageOrPositiveBalance(input)).resolves.toBe(false);
  });
  it("initializes an account admitted through the default credit policy", async () => {
    monthlyPassService.hasActiveCoverage.mockResolvedValue(false);
    relayProxyRepository.findBalanceAccountByUserId.mockResolvedValue(null);
    overdraft.resolve.mockResolvedValue({ categories: ["relay"], limit: 10 });
    await expect(
      service.hasCoverageOrPositiveBalance({ userId: "new-user", modelName: "fixture-model", channelId: "channel-1" }),
    ).resolves.toBe(true);
    expect(overdraft.initialize).toHaveBeenCalledWith("new-user");
  });

  it("preserves explicit balanceChargeMode when provided", async () => {
    relayProxyRepository.finalizeChargedUsage.mockResolvedValue({ applied: false });

    const input = createChargeInput({ balanceChargeMode: "allow-negative" });
    const result = await service.chargeUsage(input);

    expect(result).toEqual({ applied: false });
    expect(relayProxyRepository.finalizeChargedUsage).toHaveBeenCalledWith(input);
    expect(distributedLockService.runWithLock).toHaveBeenCalledTimes(1);
  });
});
