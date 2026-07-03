import { z } from "zod";

const pricingTypeSchema = z.enum(["token-based", "per-request"]);

const modelPricingBaseSchema = z.object({
  model: z.string().trim().min(1).max(200),
  pricingType: pricingTypeSchema.optional(),
  inputPrice: z.coerce.number().min(0),
  outputPrice: z.coerce.number().min(0),
  fixedPrice: z.coerce.number().min(0).optional(),
  provider: z.string().max(100).optional(),
  cacheCreationMultiplier: z.coerce.number().min(0).max(100).optional(),
  cacheReadMultiplier: z.coerce.number().min(0).max(100).optional(),
  supportedFormats: z.string().max(500).optional(),
});

export const modelPricingIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createModelPricingBodySchema = modelPricingBaseSchema;

export const updateModelPricingBodySchema = modelPricingBaseSchema.partial();

export const importModelPricingBodySchema = z.object({
  models: z.array(createModelPricingBodySchema).min(1),
});
