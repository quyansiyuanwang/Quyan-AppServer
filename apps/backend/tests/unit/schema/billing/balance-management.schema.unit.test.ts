import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE_OVERDRAFT_RULE } from "@quyan/shared";
import {
  adjustAccountSchema,
  batchOverdraftSchema,
  overdraftRuleSchema,
} from "@/api/schema/billing/balance-management.schema";
describe("balance management input", () => {
  it("requires target values to carry the expected original value", () => {
    const input = {
      userId: "user-1",
      operationId: "fixture-operation-1234",
      reason: "Statistics correction",
      totalRecharged: { mode: "set", value: 25 },
    };
    expect(adjustAccountSchema.safeParse(input).success).toBe(false);
    expect(
      adjustAccountSchema.safeParse({ ...input, totalRecharged: { ...input.totalRecharged, expected: 10 } }).success,
    ).toBe(true);
  });
  it("allows statistics-only corrections and rejects excessive precision", () => {
    const input = {
      userId: "user-1",
      operationId: "fixture-operation-1234",
      reason: "Statistics correction",
      totalUsed: { mode: "delta", value: 0.0001 },
    };
    expect(adjustAccountSchema.safeParse(input).success).toBe(true);
    expect(adjustAccountSchema.safeParse({ ...input, totalUsed: { mode: "delta", value: 0.00001 } }).success).toBe(
      false,
    );
  });
  it("requires a real change, unique targets and a bounded batch", () => {
    const base = { defaultVersion: 0, targets: [{ userId: "one", version: 0 }] };
    expect(batchOverdraftSchema.safeParse(base).success).toBe(false);
    expect(batchOverdraftSchema.safeParse({ ...base, rule: null }).success).toBe(true);
    expect(
      batchOverdraftSchema.safeParse({ ...base, categories: [], targets: [...base.targets, ...base.targets] }).success,
    ).toBe(false);
    expect(
      batchOverdraftSchema.safeParse({
        ...base,
        rule: null,
        targets: Array.from({ length: 201 }, (_, i) => ({ userId: `user-${i}`, version: 0 })),
      }).success,
    ).toBe(false);
  });
  it("rejects reversed bounds and invalid formulas", () => {
    expect(overdraftRuleSchema.safeParse({ ...DEFAULT_BALANCE_OVERDRAFT_RULE, minimum: 20, maximum: 10 }).success).toBe(
      false,
    );
    expect(
      overdraftRuleSchema.safeParse({ ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: "formula", formula: "1/0" }).success,
    ).toBe(false);
  });
});
