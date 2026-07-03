import { z } from "zod";

const ipLikeSchema = z.string().trim().min(1).max(45);

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

export const ipBlacklistIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const ipAddressParamsSchema = z.object({
  ipAddress: ipLikeSchema,
});

export const ipParamsSchema = z.object({
  ip: ipLikeSchema,
});

export const ipBlacklistListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createIPBlacklistBodySchema = z.object({
  ipAddress: ipLikeSchema,
  duration: z.coerce.number().int().min(-1),
  reason: z.string().max(500).optional(),
});

export const updateIPBlacklistBodySchema = z.object({
  banReason: z.string().max(500).optional(),
  expireTime: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "expireTime must be a valid date string")
    .optional(),
});

export const setIpErrorWeightBodySchema = z.object({
  weight: z.coerce.number().int().min(0).max(1000000),
});
