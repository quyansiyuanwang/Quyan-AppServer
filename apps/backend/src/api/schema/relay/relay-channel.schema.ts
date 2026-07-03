import { z } from "zod";

const RELAY_CHANNEL_MULTIPLIER_SCALE = 6;
// Floating-point tolerance for decimal precision checks.
const DECIMAL_PRECISION_EPSILON = 1e-8;

const hasDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < DECIMAL_PRECISION_EPSILON;
};

const channelMultiplierSchema = z.coerce
  .number()
  .min(0)
  .max(1000)
  .refine(
    (value) => hasDecimalPrecision(value, RELAY_CHANNEL_MULTIPLIER_SCALE),
    `multiplier must have at most ${RELAY_CHANNEL_MULTIPLIER_SCALE} decimal places`,
  )
  .optional();

const dayOfWeekRegex = /^([1-7](,[1-7])*)?$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const timePeriodRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  dayOfWeek: z.string().regex(dayOfWeekRegex, "dayOfWeek must be comma-separated 1-7 or empty"),
  startTime: z.string().regex(timeRegex, "startTime must be HH:mm"),
  endTime: z.string().regex(timeRegex, "endTime must be HH:mm"),
  multiplier: z.number().min(0.01).max(100),
});

const relayChannelBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  openaiUpstreamUrl: z.string().max(500).optional(),
  openaiUpstreamApiKey: z.string().max(500).optional(),
  anthropicUpstreamUrl: z.string().max(500).optional(),
  anthropicUpstreamApiKey: z.string().max(500).optional(),
  geminiUpstreamUrl: z.string().max(500).optional(),
  geminiUpstreamApiKey: z.string().max(500).optional(),
  multiplier: channelMultiplierSchema,
  allowedFormats: z.string().max(500).optional(),
  allowedModels: z.string().max(2000).nullable().optional(),
  addUserIdentifier: z.coerce.boolean().optional(),
  inputTokensIncludeCacheRead: z.coerce.boolean().optional(),
  modelMapping: z.record(z.string(), z.string()).nullable().optional(),
  timePeriodMultipliers: z.array(timePeriodRuleSchema).nullable().optional(),
});

const relayChannelIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, "ids must be unique");

export const relayChannelIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createRelayChannelBodySchema = relayChannelBaseSchema;

export const updateRelayChannelBodySchema = relayChannelBaseSchema.partial();

export const duplicateRelayChannelBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

export const batchSetRelayChannelStatusBodySchema = z.object({
  ids: relayChannelIdsSchema,
  enabled: z.coerce.boolean(),
});

export const batchDeleteRelayChannelsBodySchema = z.object({
  ids: relayChannelIdsSchema,
});

export const batchDuplicateRelayChannelsBodySchema = z.object({
  ids: relayChannelIdsSchema,
});

export const exportRelayChannelsBodySchema = z.object({
  ids: relayChannelIdsSchema.optional(),
  includeDisabled: z.coerce.boolean().optional(),
});

export const importRelayChannelsBodySchema = z.object({
  channels: z
    .array(
      relayChannelBaseSchema.extend({
        enabled: z.coerce.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});
