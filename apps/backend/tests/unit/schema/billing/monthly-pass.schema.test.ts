import { describe, expect, it } from "vitest";
import {
  assignBatchUserMonthlyPassBodySchema,
  createMonthlyPassTemplateBodySchema,
  updateMonthlyPassTemplateBodySchema,
  updateUserMonthlyPassBodySchema,
} from "@/api/schema/billing/monthly-pass.schema";

const validPriceFirstTemplate = {
  name: "Free Pack",
  originalPrice: 100,
  discountPercent: 0,
};

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

describe("monthly pass zero-value and PATCH contracts", () => {
  it("accepts a zero discount for a free price-first template", () => {
    const result = createMonthlyPassTemplateBodySchema.safeParse(validPriceFirstTemplate);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discountPercent).toBe(0);
  });

  it.each([
    ["originalPrice", { ...validPriceFirstTemplate, originalPrice: 0 }],
    ["defaultQuota", { name: "Quota Pack", defaultQuota: 0 }],
    ["dailyQuota", { ...validPriceFirstTemplate, dailyQuota: 0 }],
    ["quotaWindowHours", { ...validPriceFirstTemplate, quotaWindowHours: 0 }],
    ["quotaWindowHours decimal", { ...validPriceFirstTemplate, quotaWindowHours: 1.5 }],
    ["purchaseLimitPerUser", { ...validPriceFirstTemplate, purchaseLimitPerUser: 0, purchaseLimitWindowDays: 1 }],
  ])("rejects zero or invalid %s", (_field, body) => {
    expect(createMonthlyPassTemplateBodySchema.safeParse(body).success).toBe(false);
  });

  it("allows a partial price update", () => {
    expect(updateMonthlyPassTemplateBodySchema.safeParse({ discountPercent: 0 }).success).toBe(true);
  });

  it("allows a partial purchase-limit update", () => {
    expect(updateMonthlyPassTemplateBodySchema.safeParse({ purchaseLimitPerUser: 2 }).success).toBe(true);
  });

  it("checks duplicate user quota windows when quotaUnit is omitted", () => {
    const result = updateUserMonthlyPassBodySchema.safeParse({
      quotaWindows: [
        { quotaLimit: 10, quotaUnit: "amount", quotaWindowHours: 24 },
        { quotaLimit: 20, quotaUnit: "amount", quotaWindowHours: 24 },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.message === "quotaWindowHours + quotaUnit must be unique")).toBe(
      true,
    );
  });
});
