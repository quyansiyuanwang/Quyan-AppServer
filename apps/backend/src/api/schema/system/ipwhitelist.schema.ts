import { z } from "zod";

const ipLikeSchema = z.string().trim().min(1).max(45);

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

export const ipWhitelistIpParamsSchema = z.object({
  ip: ipLikeSchema,
});

export const ipWhitelistListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createIPWhitelistBodySchema = z.object({
  ipAddress: ipLikeSchema,
  reason: z.string().max(500).optional(),
  expiresAt: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "expiresAt must be a valid date string")
    .optional(),
});
