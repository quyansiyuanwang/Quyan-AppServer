import { describe, expect, it, vi } from "vitest";
import { SystemService } from "@/services/system/system.service";
import type { ConsumptionUsageRow } from "@/store/system/consumption-stats.store";

const toResolvedStartOfDay = (value: string): Date => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const toResolvedEndOfDay = (value: string): Date => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const createUsageRow = (overrides: Partial<ConsumptionUsageRow>): ConsumptionUsageRow => ({
  usageId: overrides.usageId ?? crypto.randomUUID(),
  userId: overrides.userId ?? "user-a",
  username: "username" in overrides ? (overrides.username ?? null) : "Alice",
  createTime: overrides.createTime ?? new Date("2026-04-01T08:00:00.000Z"),
  model: overrides.model ?? "gpt-4o",
  channelName: overrides.channelName ?? "OpenAI",
  relayTokenId: "relayTokenId" in overrides ? (overrides.relayTokenId ?? null) : "rt-1",
  relayTokenName: "relayTokenName" in overrides ? (overrides.relayTokenName ?? null) : "Token A",
  chargedAmount: overrides.chargedAmount ?? 1.5,
  coveredAmount: overrides.coveredAmount ?? 0,
  totalSpend: overrides.totalSpend ?? 1.5,
  totalTokens: overrides.totalTokens ?? 100,
  inputTokens: overrides.inputTokens ?? 60,
  outputTokens: overrides.outputTokens ?? 40,
  cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
  cacheReadTokens: overrides.cacheReadTokens ?? 0,
});

describe("SystemService consumption stats filters", () => {
  it("returns filter options from full range while aggregating filtered rows", async () => {
    const rows: ConsumptionUsageRow[] = [
      createUsageRow({
        usageId: "usage-1",
        userId: "user-a",
        username: "Alice",
        model: "gpt-4o",
        channelName: "OpenAI",
        relayTokenId: "rt-1",
        relayTokenName: "Token A",
        totalSpend: 1.5,
        chargedAmount: 1.5,
      }),
      createUsageRow({
        usageId: "usage-2",
        userId: "user-b",
        username: "Bob",
        model: "claude-3.5-sonnet",
        channelName: "Anthropic",
        relayTokenId: "rt-2",
        relayTokenName: "Token B",
        totalSpend: 2.25,
        chargedAmount: 2.25,
        totalTokens: 250,
      }),
      createUsageRow({
        usageId: "usage-3",
        userId: "user-c",
        username: null,
        model: "gpt-4o-mini",
        channelName: "OpenAI",
        relayTokenId: null,
        relayTokenName: null,
        totalSpend: 0,
        chargedAmount: 0,
        coveredAmount: 0,
        totalTokens: 50,
      }),
    ];

    const consumptionStatsRepository = {
      listUsageRows: vi.fn().mockResolvedValue(rows),
    };

    const service = new (SystemService as any)(
      { query: vi.fn(), findById: vi.fn() },
      { findUsernamesByIds: vi.fn(), findActiveUsernameById: vi.fn(), countAll: vi.fn() },
      { countAll: vi.fn() },
      consumptionStatsRepository,
    ) as SystemService;

    const result = await service.getConsumptionStats({
      userIds: ["user-a", "user-a", "  ", "user-missing"],
      models: ["gpt-4o"],
      channels: ["OpenAI"],
      relayTokenIds: ["rt-1"],
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2026-04-07T23:59:59.999Z"),
    });

    expect(consumptionStatsRepository.listUsageRows).toHaveBeenCalledWith(
      toResolvedStartOfDay("2026-04-01T00:00:00.000Z"),
      toResolvedEndOfDay("2026-04-07T23:59:59.999Z"),
    );

    expect(result.summary.totalSpend).toBe(1.5);
    expect(result.summary.totalRequests).toBe(1);
    expect(result.byUser).toHaveLength(1);
    expect(result.byUser[0]).toMatchObject({ key: "user-a", label: "Alice", totalSpend: 1.5, share: 100 });

    expect(result.filterOptions.users).toEqual([
      { key: "user-a", label: "Alice" },
      { key: "user-b", label: "Bob" },
      { key: "user-c", label: "user-c" },
    ]);
    expect(result.filterOptions.models).toEqual([
      { key: "claude-3.5-sonnet", label: "claude-3.5-sonnet" },
      { key: "gpt-4o", label: "gpt-4o" },
      { key: "gpt-4o-mini", label: "gpt-4o-mini" },
    ]);
    expect(result.filterOptions.channels).toEqual([
      { key: "Anthropic", label: "Anthropic" },
      { key: "OpenAI", label: "OpenAI" },
    ]);
    expect(result.filterOptions.relayTokens).toEqual([
      { key: "rt-1", label: "Token A" },
      { key: "rt-2", label: "Token B" },
    ]);
  });

  it("returns unfiltered rows when filter arrays are empty or blank", async () => {
    const rows: ConsumptionUsageRow[] = [
      createUsageRow({ usageId: "usage-1", userId: "user-a", username: "Alice", totalSpend: 1 }),
      createUsageRow({ usageId: "usage-2", userId: "user-b", username: "Bob", totalSpend: 2 }),
    ];

    const service = new (SystemService as any)(
      { query: vi.fn(), findById: vi.fn() },
      { findUsernamesByIds: vi.fn(), findActiveUsernameById: vi.fn(), countAll: vi.fn() },
      { countAll: vi.fn() },
      { listUsageRows: vi.fn().mockResolvedValue(rows) },
    ) as SystemService;

    const result = await service.getConsumptionStats({
      userIds: ["", "   "],
      models: [],
      channels: ["  "],
      relayTokenIds: [],
    });

    expect(result.summary.totalRequests).toBe(2);
    expect(result.summary.totalSpend).toBe(3);
    expect(result.byUser.map((item) => item.key)).toEqual(["user-b", "user-a"]);
  });

  it("keeps null relay token rows when relay token filter is absent and excludes them when present", async () => {
    const rows: ConsumptionUsageRow[] = [
      createUsageRow({
        usageId: "usage-null-token",
        userId: "user-a",
        username: "Alice",
        relayTokenId: null,
        relayTokenName: null,
        totalSpend: 1,
        chargedAmount: 1,
      }),
      createUsageRow({
        usageId: "usage-real-token",
        userId: "user-b",
        username: "Bob",
        relayTokenId: "rt-1",
        relayTokenName: "Token A",
        totalSpend: 2,
        chargedAmount: 2,
      }),
    ];

    const service = new (SystemService as any)(
      { query: vi.fn(), findById: vi.fn() },
      { findUsernamesByIds: vi.fn(), findActiveUsernameById: vi.fn(), countAll: vi.fn() },
      { countAll: vi.fn() },
      { listUsageRows: vi.fn().mockResolvedValue(rows) },
    ) as SystemService;

    const withoutRelayTokenFilter = await service.getConsumptionStats({
      userIds: ["user-a", "user-b"],
    });

    expect(withoutRelayTokenFilter.summary.totalRequests).toBe(2);
    expect(withoutRelayTokenFilter.summary.totalSpend).toBe(3);

    const withRelayTokenFilter = await service.getConsumptionStats({
      relayTokenIds: ["rt-1"],
    });

    expect(withRelayTokenFilter.summary.totalRequests).toBe(1);
    expect(withRelayTokenFilter.summary.totalSpend).toBe(2);
    expect(withRelayTokenFilter.byUser).toHaveLength(1);
    expect(withRelayTokenFilter.byUser[0]).toMatchObject({ key: "user-b", label: "Bob" });
  });
});
