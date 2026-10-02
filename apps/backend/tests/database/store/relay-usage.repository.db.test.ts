import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  relayUsage: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  relayUsageTokenAttribution: {
    findMany: vi.fn(),
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
    vi.resetAllMocks();
    prismaMock.relayUsageTokenAttribution.findMany.mockResolvedValue([]);
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
    expect(prismaMock.relayUsageTokenAttribution.findMany).toHaveBeenCalledTimes(1);
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

  it("aggregates attributed-only composite usage without requiring direct usage rows", async () => {
    const start = new Date("2025-12-01T00:00:00.000Z");
    prismaMock.relayUsage.groupBy.mockResolvedValue([]);
    prismaMock.relayUsage.findMany.mockResolvedValue([]);
    // Two attempts belong to one logical request; requestCount must not count attribution rows.
    prismaMock.relayLogicalRequest.groupBy.mockResolvedValue([{ relayTokenId: "composite-1", _count: { _all: 1 } }]);
    prismaMock.relayUsageTokenAttribution.findMany.mockResolvedValue([
      {
        relayTokenId: "composite-1",
        relayUsageId: "leaf-success",
        relayUsage: {
          id: "leaf-success",
          requestTokens: 10,
          responseTokens: 20,
          totalTokens: 30,
          cacheCreationTokens: 3,
          cacheReadTokens: 2,
          createTime: now,
        },
      },
      {
        relayTokenId: "composite-1",
        relayUsageId: "leaf-failure",
        relayUsage: {
          id: "leaf-failure",
          requestTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          createTime: start,
        },
      },
    ]);
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([
      { relatedId: "leaf-success", _sum: { amount: -2 } },
      { relatedId: "leaf-failure", _sum: { amount: 0 } },
    ]);
    prismaMock.monthlyPassUsage.groupBy.mockResolvedValue([
      { relayUsageId: "leaf-success", _sum: { coveredAmount: 4 } },
    ]);
    prismaMock.balanceTransaction.findMany.mockResolvedValue([]);

    const result = await repository.aggregateByRelayTokenIds(["composite-1"], start, now);

    expect(prismaMock.relayUsageTokenAttribution.findMany).toHaveBeenCalledWith({
      where: {
        relayTokenId: { in: ["composite-1"] },
        relayUsage: {
          relayTokenId: undefined,
          status: RECORD_STATUS.ACTIVE,
          createTime: { gte: start, lte: now },
        },
      },
      include: { relayUsage: true },
    });
    expect(prismaMock.balanceTransaction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ relatedId: { in: ["leaf-success", "leaf-failure"] } }),
      }),
    );
    expect(result).toEqual([
      {
        relayTokenId: "composite-1",
        requestCount: 1,
        requestTokens: 10,
        responseTokens: 20,
        totalTokens: 30,
        cacheCreationTokens: 3,
        cacheReadTokens: 2,
        chargedAmount: 2,
        coveredAmount: 4,
        lastUsedAt: now,
      },
    ]);
  });

  it("combines historical direct usage and nested attribution while counting logical requests once", async () => {
    const earlier = new Date("2025-12-31T00:00:00.000Z");
    prismaMock.relayUsage.groupBy.mockResolvedValue([
      {
        relayTokenId: "outer",
        _sum: { requestTokens: 2, responseTokens: 3, totalTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 1 },
        _max: { createTime: earlier },
      },
    ]);
    prismaMock.relayUsage.findMany.mockResolvedValue([{ id: "historical-direct", relayTokenId: "outer" }]);
    prismaMock.relayLogicalRequest.groupBy.mockResolvedValue([
      { relayTokenId: "outer", _count: { _all: 2 } },
      { relayTokenId: "inner", _count: { _all: 1 } },
    ]);
    const leaf = {
      id: "nested-leaf",
      requestTokens: 10,
      responseTokens: 20,
      totalTokens: 30,
      cacheCreationTokens: 3,
      cacheReadTokens: 2,
      createTime: now,
    };
    prismaMock.relayUsageTokenAttribution.findMany.mockResolvedValue([
      { relayTokenId: "outer", relayUsageId: leaf.id, relayUsage: leaf },
      { relayTokenId: "inner", relayUsageId: leaf.id, relayUsage: leaf },
    ]);
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([
      { relatedId: "historical-direct", _sum: { amount: -1 } },
      { relatedId: leaf.id, _sum: { amount: -2 } },
    ]);
    prismaMock.monthlyPassUsage.groupBy.mockResolvedValue([{ relayUsageId: leaf.id, _sum: { coveredAmount: 4 } }]);
    prismaMock.balanceTransaction.findMany.mockResolvedValue([]);

    const result = await repository.aggregateByRelayTokenIds(["outer", "inner"]);

    expect(result).toEqual([
      {
        relayTokenId: "outer",
        requestCount: 2,
        requestTokens: 12,
        responseTokens: 23,
        totalTokens: 35,
        cacheCreationTokens: 3,
        cacheReadTokens: 3,
        chargedAmount: 3,
        coveredAmount: 4,
        lastUsedAt: now,
      },
      {
        relayTokenId: "inner",
        requestCount: 1,
        requestTokens: 10,
        responseTokens: 20,
        totalTokens: 30,
        cacheCreationTokens: 3,
        cacheReadTokens: 2,
        chargedAmount: 2,
        coveredAmount: 4,
        lastUsedAt: now,
      },
    ]);
  });

  it("does not query usage or attribution for an empty token scope", async () => {
    await expect(repository.aggregateByRelayTokenIds([])).resolves.toEqual([]);
    expect(prismaMock.relayUsage.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.relayUsageTokenAttribution.findMany).not.toHaveBeenCalled();
    expect(prismaMock.balanceTransaction.groupBy).not.toHaveBeenCalled();
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
