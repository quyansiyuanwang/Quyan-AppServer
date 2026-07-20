import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  balanceTransaction: { findMany: vi.fn() },
  monthlyPassUsage: { findMany: vi.fn() },
  relayUsage: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock("@/config/database", () => ({ prisma: prismaMock }));

import { ConsumptionStatsRepository } from "@/store/system/consumption-stats.repository";
import { UNATTRIBUTED_RELAY_CHANNEL_NAME } from "@/util/relay-display-channel.util";

const now = new Date("2026-07-20T08:00:00.000Z");

const transaction = (overrides: Record<string, unknown> = {}) => ({
  relatedId: "usage-1",
  userId: "user-1",
  createTime: now,
  type: "api_usage",
  amount: -1,
  model: "gpt-4o",
  tokens: 100,
  inputTokens: 60,
  outputTokens: 40,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  channelName: null,
  displayChannelName: null,
  description: null,
  ...overrides,
});

describe("ConsumptionStatsRepository", () => {
  const repository = ConsumptionStatsRepository.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.monthlyPassUsage.findMany.mockResolvedValue([]);
    prismaMock.relayUsage.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([{ id: "user-1", username: "Alice" }]);
  });

  it("uses transaction display snapshots before linked relay usage snapshots", async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({ displayChannelName: "Logical Pool" }),
    ]);
    prismaMock.relayUsage.findMany.mockResolvedValue([
      {
        id: "usage-1",
        relayTokenId: "token-1",
        displayChannelName: "Physical Member",
        relayToken: { name: "Token A" },
      },
    ]);

    const rows = await repository.listUsageRows(new Date("2026-07-20"), new Date("2026-07-21"));

    expect(rows).toEqual([
      expect.objectContaining({
        channelName: "Logical Pool",
        relayTokenId: "token-1",
        relayTokenName: "Token A",
      }),
    ]);
  });

  it("uses linked relay usage snapshots when transaction snapshots are absent", async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([transaction()]);
    prismaMock.relayUsage.findMany.mockResolvedValue([
      {
        id: "usage-1",
        relayTokenId: "token-1",
        displayChannelName: "Automatic Pool Member",
        relayToken: { name: "Token A" },
      },
    ]);

    const rows = await repository.listUsageRows(new Date("2026-07-20"), new Date("2026-07-21"));

    expect(rows[0]).toMatchObject({ channelName: "Automatic Pool Member" });
  });

  it("preserves legacy names, rejects placeholder snapshots, and marks missing evidence unattributed", async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({ relatedId: "legacy", channelName: "Legacy Channel", displayChannelName: "New Snapshot" }),
      transaction({ relatedId: "placeholder", displayChannelName: "历史渠道（未记录）" }),
    ]);
    prismaMock.relayUsage.findMany.mockResolvedValue([]);

    const rows = await repository.listUsageRows(new Date("2026-07-20"), new Date("2026-07-21"));
    const channelNames = new Map(rows.map((row) => [row.usageId, row.channelName]));

    expect(channelNames.get("legacy")).toBe("Legacy Channel");
    expect(channelNames.get("placeholder")).toBe(UNATTRIBUTED_RELAY_CHANNEL_NAME);
  });

  it("uses a single linked monthly-pass legacy name but leaves conflicts unattributed", async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({ relatedId: "single" }),
      transaction({ relatedId: "conflict" }),
    ]);
    prismaMock.monthlyPassUsage.findMany.mockResolvedValue([
      {
        relayUsageId: "single",
        coveredAmount: 1,
        coveredTokens: 100,
        channelName: "Monthly Pass Channel",
        displayChannelName: null,
      },
      {
        relayUsageId: "conflict",
        coveredAmount: 1,
        coveredTokens: 100,
        channelName: "Channel A",
        displayChannelName: null,
      },
      {
        relayUsageId: "conflict",
        coveredAmount: 1,
        coveredTokens: 100,
        channelName: "Channel B",
        displayChannelName: null,
      },
    ]);

    const rows = await repository.listUsageRows(new Date("2026-07-20"), new Date("2026-07-21"));
    const channelNames = new Map(rows.map((row) => [row.usageId, row.channelName]));

    expect(channelNames.get("single")).toBe("Monthly Pass Channel");
    expect(channelNames.get("conflict")).toBe(UNATTRIBUTED_RELAY_CHANNEL_NAME);
  });
});