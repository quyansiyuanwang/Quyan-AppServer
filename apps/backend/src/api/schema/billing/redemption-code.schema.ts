import { z } from "zod";

export const createRedemptionCodeBodySchema = z.object({
  amount: z.coerce.number().min(0.01).max(100000),
  count: z.coerce.number().int().min(1).max(1000).optional(),
  expiresAt: z.preprocess(
    (value) =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? new Date(value)
        : value,
    z.date(),
  ).optional(),
});

export const redeemCodeBodySchema = z.object({
  code: z.string().trim().min(1).max(100),
});

export const redemptionCodeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const redemptionCodeDeleteParamsSchema = z.object({
  id: z.string().trim().min(1),
});
