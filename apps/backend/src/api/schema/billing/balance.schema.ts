import { z } from "zod";

const BALANCE_TRANSACTION_MAX_QUERY_RANGE_DAYS = 30;
const BALANCE_TRANSACTION_MAX_QUERY_RANGE_MS = BALANCE_TRANSACTION_MAX_QUERY_RANGE_DAYS * 24 * 60 * 60 * 1000;

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

const validateBalanceTransactionQueryRange = (
  value: { startTime?: string; endTime?: string },
  ctx: z.RefinementCtx,
): void => {
  if (!value.startTime) return;

  const startTime = new Date(value.startTime);
  if (Number.isNaN(startTime.getTime())) return;

  const endTime = value.endTime ? new Date(value.endTime) : new Date();
  if (Number.isNaN(endTime.getTime())) return;

  if (endTime.getTime() - startTime.getTime() <= BALANCE_TRANSACTION_MAX_QUERY_RANGE_MS) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: value.endTime ? ["endTime"] : ["startTime"],
    message: `query time range must not exceed ${BALANCE_TRANSACTION_MAX_QUERY_RANGE_DAYS} days`,
  });
};

export const batchBalanceAccountsBodySchema = z.object({
  userIds: z.array(z.string().trim().min(1)).min(1).max(200),
});

export const rechargeBodySchema = z.object({
  userId: z.string().trim().min(1).max(50),
  amount: z.coerce
    .number()
    .finite()
    .min(-100000)
    .max(100000)
    .refine((value) => Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-7, {
      message: "amount must have at most 4 decimal places",
    }),
  description: z.string().max(500).optional(),
  countAsStatistics: z.coerce.boolean().optional(),
});

export const balanceUserIdParamsSchema = z.object({
  userId: z.string().trim().min(1),
});

const balanceTransactionQueryObjectSchema = z.object({
  type: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  model: z.string().trim().optional(),
  tokenName: z.string().trim().optional(),
  startTime: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "startTime must be a valid date string")
    .optional(),
  endTime: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "endTime must be a valid date string")
    .optional(),
});

export const balanceTransactionsQuerySchema = balanceTransactionQueryObjectSchema.superRefine(
  validateBalanceTransactionQueryRange,
);

export const balanceAllTransactionsQuerySchema = balanceTransactionQueryObjectSchema
  .extend({
    userId: z.string().trim().optional(),
  })
  .superRefine(validateBalanceTransactionQueryRange);
