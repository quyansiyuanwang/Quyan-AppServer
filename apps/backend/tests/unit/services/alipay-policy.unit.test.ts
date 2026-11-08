import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { alipaySettingsSchema, moneySchema, rechargeCredit, refundCredit } from "@/services/billing/alipay-policy";

describe("Alipay monetary policy", () => {
  it.each(["0", "-1", "1.001", "1e2", "NaN", "01.00", " 1.00", "Infinity"])(
    "rejects non-payment amount %s",
    (value) => {
      expect(moneySchema.safeParse(value).success).toBe(false);
    },
  );
  it("accepts yuan amounts without floating point rounding", () => {
    expect(moneySchema.safeParse("0.01").success).toBe(true);
    expect(rechargeCredit("0.29", "100").toFixed(4)).toBe("29.0000");
    expect(rechargeCredit("0.01", "0.1234").toFixed(4)).toBe("0.0012");
  });
  it("allocates all credit across multiple partial refunds exactly", () => {
    const a = refundCredit("0.03", "0.0002", 0, "0.01");
    const b = refundCredit("0.03", "0.0002", "0.01", "0.01");
    const c = refundCredit("0.03", "0.0002", "0.02", "0.01");
    expect(a.plus(b).plus(c).equals(new Decimal("0.0002"))).toBe(true);
  });
  it("defaults off and rejects inverted limits", () => {
    expect(alipaySettingsSchema.parse({}).enabled).toBe(false);
    expect(alipaySettingsSchema.safeParse({ minAmount: "10", maxAmount: "1" }).success).toBe(false);
  });
  it.each([
    "not-a-url",
    "/balance",
    "https://",
    "javascript:alert(1)",
    "https://user:secret@fixture.invalid/balance",
    "https://fixture.invalid/#/balance",
  ])("rejects unsafe payment return URL %s", (returnUrl) => {
    expect(alipaySettingsSchema.safeParse({ returnUrl }).success).toBe(false);
  });
});
