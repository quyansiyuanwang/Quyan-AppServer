import { describe, expect, it } from "vitest";
import { createBalanceGiftCodeBodySchema } from "@/api/schema/billing/balance-transfer.schema";
import { createRedemptionCodeBodySchema } from "@/api/schema/billing/redemption-code.schema";

describe("gift-code expiry schemas", () => {
  it.each(["2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00", "2099-01-01 00:00:00"])(
    "accepts the frontend datetime format %s",
    (expiresAt) => {
      const result = createBalanceGiftCodeBodySchema.safeParse({ amount: 10, expiresAt });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.expiresAt).toBeInstanceOf(Date);
    },
  );

  it("rejects an invalid expiry instead of passing it to the service", () => {
    expect(createBalanceGiftCodeBodySchema.safeParse({ amount: 10, expiresAt: "not-a-date" }).success).toBe(false);
  });

  it("uses the same date contract for administrator redemption codes", () => {
    const result = createRedemptionCodeBodySchema.safeParse({
      amount: 10,
      count: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects non-ISO redemption-code expiry values", () => {
    expect(createRedemptionCodeBodySchema.safeParse({ amount: 10, expiresAt: "2099-01-01 00:00:00" }).success).toBe(
      false,
    );
  });
});
