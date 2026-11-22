import { z } from "zod";
import { BALANCE_MANAGEMENT_POLICY, BALANCE_OVERDRAFT_CATEGORIES, BALANCE_OVERDRAFT_MODES } from "@quyan/shared";
import { evaluateOverdraftFormula } from "@/util/balance-overdraft-formula";

const amount = z.number().finite().min(0).max(BALANCE_MANAGEMENT_POLICY.maximumAmount).multipleOf(0.0001);
const signedAmount = z
  .number()
  .finite()
  .min(-BALANCE_MANAGEMENT_POLICY.maximumAmount)
  .max(BALANCE_MANAGEMENT_POLICY.maximumAmount)
  .multipleOf(0.0001);
export const overdraftRuleSchema = z
  .object({
    mode: z.enum(BALANCE_OVERDRAFT_MODES),
    fixedAmount: amount,
    percent: amount,
    minimum: amount,
    maximum: amount.nullable(),
    formula: z.string().max(BALANCE_MANAGEMENT_POLICY.formulaLength),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.maximum !== null && rule.minimum > rule.maximum)
      ctx.addIssue({ code: "custom", message: "Minimum exceeds maximum", path: ["maximum"] });
    if (rule.mode === "formula") {
      try {
        evaluateOverdraftFormula(rule.formula, {
          totalRecharged: 0,
          totalUsed: 0,
          fixedAmount: rule.fixedAmount,
          percent: rule.percent,
        });
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid arithmetic formula", path: ["formula"] });
      }
    }
  });
const categories = z
  .array(z.enum(BALANCE_OVERDRAFT_CATEGORIES))
  .max(BALANCE_OVERDRAFT_CATEGORIES.length)
  .refine((v) => new Set(v).size === v.length);
const userId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const managementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  userId: userId.optional(),
});
export const defaultOverdraftSchema = z
  .object({ rule: overdraftRuleSchema, categories, version: z.number().int().min(0) })
  .strict();
export const batchOverdraftSchema = z
  .object({
    targets: z
      .array(z.object({ userId, version: z.number().int().min(0) }).strict())
      .min(1)
      .max(BALANCE_MANAGEMENT_POLICY.batchSize)
      .refine((v) => new Set(v.map((r) => r.userId)).size === v.length),
    defaultVersion: z.number().int().min(0),
    rule: overdraftRuleSchema.nullable().optional(),
    categories: categories.nullable().optional(),
  })
  .strict()
  .refine((v) => v.rule !== undefined || v.categories !== undefined);
export const previewOverdraftSchema = z
  .object({
    userIds: z.array(userId).min(1).max(BALANCE_MANAGEMENT_POLICY.batchSize),
    rule: overdraftRuleSchema.nullable().optional(),
    categories: categories.nullable().optional(),
  })
  .strict();
const adjustmentField = z
  .object({ mode: z.enum(["delta", "set"]), value: signedAmount, expected: signedAmount.optional() })
  .strict()
  .refine((v) => v.mode !== "set" || v.expected !== undefined);
export const adjustAccountSchema = z
  .object({
    userId,
    operationId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    reason: z.string().trim().min(1).max(500),
    balance: adjustmentField.optional(),
    totalRecharged: adjustmentField.optional(),
    totalUsed: adjustmentField.optional(),
  })
  .strict()
  .refine((v) => v.balance !== undefined || v.totalRecharged !== undefined || v.totalUsed !== undefined);
