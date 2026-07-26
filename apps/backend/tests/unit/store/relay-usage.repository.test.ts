import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  relayUsage: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  relayLogicalRequest: {
    groupBy: vi.fn(),
  },
  balanceTransaction: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  monthlyPassUsage: {
    groupBy: vi.fn(),
  },
}));

vi.mock("@/config/database", () => ({
  prisma: prismaMock,
}));

import { RelayUsageRepository } from "../../../src/store/relay/relay-usage.repository";
import { RECORD_STATUS } from "../../../src/constant/status";

describe("RelayUsageRepository", () => {
  const repository = RelayUsageRepository.getInstance();
  const now = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates relay usage metrics with grouped usage rows and structured monthly pass amounts", async () => {
    prismaMock.relayUsage.groupBy.mockResolvedValue([
      {
        relayTokenId: "token-1",
        _count: { _all: 2 },
        _sum: {
          requestTokens: 15,
          responseTokens: 35,
          totalTokens: 50,
          cacheCreationTokens: 3,
          cacheReadTokens: 1,
        },
        _max: { createTime: now },
      },
      {
        relayTokenId: "token-2",
        _count: { _all: 1 },
        _sum: {
          requestTokens: 7,
          responseTokens: 13,
          totalTokens: 20,
          cacheCreationTokens: 0,
          cacheReadTokens: 2,
        },
        _max: { createTime: now },
      },
    ]);
    prismaMock.relayUsage.findMany.mockResolvedValue([
      { id: "usage-1", relayTokenId: "token-1" },
      { id: "usage-2", relayTokenId: "token-1" },
      { id: "usage-3", relayTokenId: "token-2" },
    ]);
    prismaMock.relayLogicalRequest.groupBy.mockResolvedValue([
      { relayTokenId: "token-1", _count: { _all: 1 } },
      { relayTokenId: "token-2", _count: { _all: 1 } },
    ]);
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([
      { relatedId: "usage-1", _sum: { amount: -3 } },
      { relatedId: "usage-2", _sum: { amount: -2 } },
      { relatedId: "usage-3", _sum: { amount: -1.5 } },
    ]);
    prismaMock.monthlyPassUsage.groupBy.mockResolvedValue([{ relayUsageId: "usage-1", _sum: { coveredAmount: 5 } }]);
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      { relatedId: "usage-2", description: "月卡抵扣: /relay/proxy/v1/chat/completions (曲2.5)" },
    ]);

    const result = await repository.aggregateByRelayTokenIds(["token-1", "token-2"]);

    expect(prismaMock.relayUsage.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.relayLogicalRequest.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.relayUsage.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        relayTokenId: "token-1",
        requestCount: 1,
        requestTokens: 15,
        responseTokens: 35,
        totalTokens: 50,
        cacheCreationTokens: 3,
        cacheReadTokens: 1,
        chargedAmount: 5,
        coveredAmount: 7.5,
        lastUsedAt: now,
      },
      {
        relayTokenId: "token-2",
        requestCount: 1,
        requestTokens: 7,
        responseTokens: 13,
        totalTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 2,
        chargedAmount: 1.5,
        coveredAmount: 0,
        lastUsedAt: now,
      },
    ]);
  });

  it("builds usage detail amounts with legacy fallback only when structured records are missing", async () => {
    prismaMock.relayUsage.count.mockResolvedValue(1);
    prismaMock.relayUsage.findMany.mockResolvedValue([
      {
        id: "usage-1",
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
        createTime: now,
        updateTime: now,
        totalOutputTime: null,
        timeToFirstByte: null,
        isStreaming: false,
        status: RECORD_STATUS.ACTIVE,
      },
    ]);
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ relatedId: "usage-1", _sum: { amount: -4 } }]);
    prismaMock.monthlyPassUsage.groupBy.mockResolvedValue([]);
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      { relatedId: "usage-1", description: "月卡抵扣: /relay/proxy/v1/chat/completions (曲6)" },
      { relatedId: "usage-1", description: "Monthly pass coverage for /relay/proxy/v1/chat/completions" },
      { relatedId: "usage-1", description: "API调用: /relay/proxy/v1/chat/completions (曲999)" },
    ]);

    const result = await repository.findUsageDetailPageByRelayTokenId("token-1", undefined, undefined, 20, 0);

    expect(result).toEqual({
      total: 1,
      usages: [
        expect.objectContaining({
          id: "usage-1",
          chargedAmount: 4,
          coveredAmount: 6,
          totalSpend: 10,
        }),
      ],
    });
  });
});
