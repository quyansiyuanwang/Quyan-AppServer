import { z } from "zod";

const pricingTypeSchema = z.enum(["token-based", "per-request"]);
const RELAY_MULTIPLIER_SCALE = 6;
// Floating-point tolerance for decimal precision checks.
const DECIMAL_PRECISION_EPSILON = 1e-8;

const hasDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < DECIMAL_PRECISION_EPSILON;
};

const globalMultiplierSchema = z.coerce
  .number()
  .min(0)
  .max(1000)
  .refine(
    (value) => hasDecimalPrecision(value, RELAY_MULTIPLIER_SCALE),
    `globalMultiplier must have at most ${RELAY_MULTIPLIER_SCALE} decimal places`,
  )
  .optional();

const modelPricingItemSchema = z.object({
  model: z.string().trim().min(1).max(200),
  modelId: z.string().trim().min(1).max(200).optional(),
  pricingType: pricingTypeSchema.optional(),
  inputPrice: z.coerce.number().min(0),
  outputPrice: z.coerce.number().min(0),
  fixedPrice: z.coerce.number().min(0).optional(),
  cacheCreationMultiplier: z.coerce.number().min(0),
  cacheReadMultiplier: z.coerce.number().min(0),
  supportedFormats: z.string().max(500).optional(),
});

export const updateRelayConfigBodySchema = z.object({
  globalMultiplier: globalMultiplierSchema,
  maxConcurrency: z.coerce.number().int().min(1).optional(),
  queueTimeout: z.coerce.number().int().min(0).optional(),
  upstreamStreamTimeout: z.coerce.number().int().min(0).optional(),
  enableQueue: z.coerce.boolean().optional(),
  apiCatalogPoolVisibility: z.enum(["hidden", "anonymous-range"]).optional(),
  channelTopologyMode: z.enum(["legacy", "strict-two-tier"]).optional(),
  modelRates: z.array(modelPricingItemSchema).optional(),
  uptimeStatusUrl: z.string().max(500).optional(),
  monitorNameMapping: z.record(z.string(), z.string()).nullable().optional(),
  showOnlyConfigured: z.coerce.boolean().optional(),
  uptimeTransformRules: z.unknown().optional(),
  uptimeStaticData: z.unknown().optional(),
});
