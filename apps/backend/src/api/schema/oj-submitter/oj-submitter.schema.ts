import { z } from "zod";

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

export const ojPricingModelParamsSchema = z.object({
  model: z.string().trim().min(1).max(200),
});

export const ojApiKeyIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const askQuestionBodySchema = z.object({
  question: z.string().trim().min(1).max(10000),
  model: z.string().max(200).optional(),
  maxTokens: z.coerce.number().int().min(1).max(32000).optional(),
});

export const ojUsageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
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

export const createOJAPIKeyBodySchema = z.object({
  name: z.string().max(100).optional(),
  expiresAt: z.coerce.date().optional(),
  channelId: z.string().trim().optional(),
});

export const updateOJAPIKeyBodySchema = z.object({
  name: z.string().max(100).optional(),
  expiresAt: z.coerce.date().optional().nullable(),
  channelId: z.string().trim().optional().nullable(),
});

export const createOJModelPricingBodySchema = z.object({
  model: z.string().trim().min(1).max(200),
  inputPrice: z.coerce.number().min(0),
  outputPrice: z.coerce.number().min(0),
  multiplier: z.coerce.number().min(0).max(100).optional(),
  cacheCreationMultiplier: z.coerce.number().min(0).max(100).optional(),
  cacheReadMultiplier: z.coerce.number().min(0).max(100).optional(),
  provider: z.string().max(100).optional(),
});

export const updateOJModelPricingBodySchema = z.object({
  inputPrice: z.coerce.number().min(0).optional(),
  outputPrice: z.coerce.number().min(0).optional(),
  multiplier: z.coerce.number().min(0).max(100).optional(),
  cacheCreationMultiplier: z.coerce.number().min(0).max(100).optional(),
  cacheReadMultiplier: z.coerce.number().min(0).max(100).optional(),
  provider: z.string().max(100).optional(),
});
