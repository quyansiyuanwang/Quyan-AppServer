import { describe, expect, it } from "vitest";
import { rechargeBodySchema } from "../../../../src/api/schema/billing/balance.schema";

describe("recharge balance precision", () => {
  const base = { userId: "user-1" };

  it("accepts amounts with up to four decimal places", () => {
    expect(rechargeBodySchema.safeParse({ ...base, amount: "1.2345" }).success).toBe(true);
  });

  it("rejects amounts with more than four decimal places", () => {
    expect(rechargeBodySchema.safeParse({ ...base, amount: "1.23456" }).success).toBe(false);
  });
});
