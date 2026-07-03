import { describe, expect, it } from "vitest";
import { consumptionStatsQuerySchema } from "@/api/schema/system/system.schema";

describe("consumptionStatsQuerySchema", () => {
  it("accepts repeated filter values and normalizes singletons into arrays", () => {
    const result = consumptionStatsQuerySchema.safeParse({
      startDate: "2026-04-01T00:00:00.000Z",
      endDate: "2026-04-07T23:59:59.999Z",
      userIds: "user-1",
      models: ["gpt-4o", "gpt-4o-mini"],
      channels: "OpenAI",
      relayTokenIds: ["rt-1", "rt-2"],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toMatchObject({
      userIds: ["user-1"],
      models: ["gpt-4o", "gpt-4o-mini"],
      channels: ["OpenAI"],
      relayTokenIds: ["rt-1", "rt-2"],
    });
  });

  it("rejects date ranges longer than 30 days", () => {
    const result = consumptionStatsQuerySchema.safeParse({
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-05-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.some((issue) => issue.message.includes("30 days"))).toBe(true);
  });
});
