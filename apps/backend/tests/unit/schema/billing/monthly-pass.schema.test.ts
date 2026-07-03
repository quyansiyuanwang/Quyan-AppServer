import { describe, expect, it } from "vitest";
import { assignBatchUserMonthlyPassBodySchema } from "@/api/schema/billing/monthly-pass.schema";

describe("assignBatchUserMonthlyPassBodySchema", () => {
  it("rejects duplicate quota window rules with same unit and hours", () => {
    const result = assignBatchUserMonthlyPassBodySchema.safeParse({
      userIds: ["user-1"],
      templateId: "template-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-06-01T00:00:00.000Z",
      quotaWindows: [
        {
          quotaLimit: 10,
          quotaUnit: "amount",
          quotaWindowHours: 24,
        },
        {
          quotaLimit: 20,
          quotaUnit: "amount",
          quotaWindowHours: 24,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.some((issue) => issue.message === "quotaWindowHours + quotaUnit must be unique")).toBe(
      true,
    );
  });
});
