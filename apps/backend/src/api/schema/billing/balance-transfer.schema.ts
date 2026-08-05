import { z } from "zod";

const amountSchema = z.coerce
  .number()
  .min(0.01)
  .max(100000)
  .refine((value) => Number.isInteger(value * 10000), {
    message: "金额最多支持 4 位小数",
  });

export const createBalanceGiftCodeBodySchema = z.object({
  amount: amountSchema,
  expiresAt: z.coerce.date().optional(),
});

export const createBalanceTransferBodySchema = z.object({
  recipientUsername: z.string().trim().min(3).max(50),
  amount: amountSchema,
  description: z.string().trim().max(500).optional(),
});

export const balanceGiftCodeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const balanceGiftCodeParamsSchema = z.object({
  id: z.string().trim().min(1),
});
