import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageChargeService } from "../../../src/services/billing/usage-charge.service";
import type { RelayFinalizeChargeInput } from "../../../src/store/relay/relay-proxy.store";

const createChargeInput = (overrides: Partial<RelayFinalizeChargeInput> = {}): RelayFinalizeChargeInput => ({
  userId: "user-1",
  relayTokenId: "token-1",
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
  channelId: "channel-1",
  monthlyPassCoverageAt: new Date("2026-01-01T00:00:00.000Z"),
  inputRate: 0.000001,
  outputRate: 0.000002,
  multiplier: 1,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
  channelName: "Default Channel",
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

  const UsageChargeServiceCtor = UsageChargeService as unknown as new (...args: any[]) => UsageChargeService;

  const service = new UsageChargeServiceCtor(relayProxyRepository, monthlyPassService, distributedLockService);

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("preserves explicit balanceChargeMode when provided", async () => {
    relayProxyRepository.finalizeChargedUsage.mockResolvedValue({ applied: false });

    const input = createChargeInput({ balanceChargeMode: "allow-negative" });
    const result = await service.chargeUsage(input);

    expect(result).toEqual({ applied: false });
    expect(relayProxyRepository.finalizeChargedUsage).toHaveBeenCalledWith(input);
    expect(distributedLockService.runWithLock).toHaveBeenCalledTimes(1);
  });
});
