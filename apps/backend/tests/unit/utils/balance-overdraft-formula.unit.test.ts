import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE_OVERDRAFT_RULE, type BalanceOverdraftRule } from "@quyan/shared";
import {
  calculateOverdraftLimit,
  evaluateOverdraftFormula,
  parseOverdraftFormula,
} from "@/util/balance-overdraft-formula";
const rule = (changes: Partial<BalanceOverdraftRule>): BalanceOverdraftRule => ({
  ...DEFAULT_BALANCE_OVERDRAFT_RULE,
  ...changes,
});
const account = { totalRecharged: 120, totalUsed: 30 };
describe("overdraft arithmetic", () => {
  it.each([
    ["disabled", 0],
    ["fixed", 20],
    ["percent", 12],
    ["sum", 32],
    ["max", 20],
    ["min", 12],
    ["formula", 12],
  ] as const)("calculates %s", (mode, expected) => {
    expect(calculateOverdraftLimit(rule({ mode, fixedAmount: 20, percent: 10 }), account).toNumber()).toBe(expected);
  });
  it("applies bounds, floors four places, and ignores bounds when disabled", () => {
    expect(calculateOverdraftLimit(rule({ mode: "percent", percent: 10, minimum: 15 }), account).toNumber()).toBe(15);
    expect(calculateOverdraftLimit(rule({ mode: "fixed", fixedAmount: 20, maximum: 10 }), account).toNumber()).toBe(10);
    expect(calculateOverdraftLimit(rule({ mode: "formula", formula: "1/3" }), account).toString()).toBe("0.3333");
    expect(calculateOverdraftLimit(rule({ minimum: 15 }), account).toNumber()).toBe(0);
  });
  it("uses a nonnegative recharge base and recomputes when statistics change", () => {
    const percentage = rule({ mode: "percent", percent: 10 });
    expect(calculateOverdraftLimit(percentage, { ...account, totalRecharged: -10 }).toNumber()).toBe(0);
    expect(calculateOverdraftLimit(percentage, { ...account, totalRecharged: 300 }).toNumber()).toBe(30);
  });
  it("implements functions, precedence, unary signs and decimal arithmetic", () => {
    const vars = { totalRecharged: 200, totalUsed: 50, fixedAmount: 3, percent: 10 };
    expect(
      evaluateOverdraftFormula("min(100,max(fixedAmount,totalRecharged * percent / 100)) + abs(-2)", vars).toNumber(),
    ).toBe(22);
    expect(evaluateOverdraftFormula("round(1/3) + .1 + .2", vars).toString()).toBe("0.6333");
  });
  it.each([
    "process.exit()",
    "totalRecharged.constructor",
    "__proto__",
    "Math.max(1,2)",
    "1;2",
    "1 ** 2",
    "1e6",
    "min(1)",
    "abs(1,2)",
    "(1+2",
    "",
    "1".repeat(513),
    "(".repeat(30) + "1" + ")".repeat(30),
  ])("rejects unsupported syntax %s", (formula) => {
    expect(() => parseOverdraftFormula(formula)).toThrow();
  });
  it("rejects division by zero and overflow", () => {
    expect(() =>
      calculateOverdraftLimit(rule({ mode: "formula", formula: "1 / totalRecharged" }), {
        totalRecharged: 0,
        totalUsed: 0,
      }),
    ).toThrow();
    expect(() => calculateOverdraftLimit(rule({ mode: "formula", formula: "999999 * 999999" }), account)).toThrow();
  });
});
