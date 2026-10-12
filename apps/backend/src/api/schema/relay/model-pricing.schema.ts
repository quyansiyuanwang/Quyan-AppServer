import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
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

export const MODEL_PRICING_IMPORT_MAX_ITEMS = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest - 1;
export const importModelPricingBodySchema = z
  .object({
    models: z
      .array(createModelPricingBodySchema.strict())
      .min(1)
      .max(MODEL_PRICING_IMPORT_MAX_ITEMS)
      .refine(
        (models) => new Set(models.map((item) => item.model)).size === models.length,
        "Duplicate model names are not allowed",
      ),
  })
  .strict();
