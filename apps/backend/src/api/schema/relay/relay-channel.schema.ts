import { z } from "zod";
import { RELAY_UPSTREAM_FORMATS } from "@appserver/shared";

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

const contextLengthRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  minTokens: z.coerce.number().int().min(0).max(10_000_000),
  multiplier: z.coerce.number().min(0.01).max(100),
});

const relayChannelTypeSchema = z.enum(["standalone", "pooled-member", "pooled", "automatic-proxy-pool"]);
const routingStrategySchema = z.enum([
  "priority",
  "random",
  "weighted-random",
  "round-robin",
  "health-priority",
  "latency-priority",
]);
const allowedModelsModeSchema = z.enum(["all", "manual", "auto"]);
const automaticPoolRankingModeSchema = z.enum(["price-first", "stability-first"]);
const healthTrackingModeSchema = z.enum(["automatic", "manual", "disabled"]);
const visibilityModeSchema = z.enum(["public", "private", "whitelist", "hidden"]);
const providerSettlementModeSchema = z.enum(["realtime", "interval", "daily", "manual"]);
const providerConfigSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    commissionPercent: z.coerce.number().min(0).max(100),
    settlementMode: providerSettlementModeSchema,
    settlementIntervalDays: z.coerce.number().int().min(1).max(365).optional(),
    settlementTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.settlementMode === "interval" && !value.settlementIntervalDays)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["settlementIntervalDays"],
        message: "Required for interval settlement",
      });
    if (value.settlementMode === "daily" && !value.settlementTime)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["settlementTime"],
        message: "Required for daily settlement",
      });
  });

const relayChannelMemberSchema = z.object({
  id: z.string().trim().min(1).optional(),
  memberChannelId: z.string().trim().min(1),
  priority: z.coerce.number().int().min(0).max(9999),
  weight: z.coerce.number().min(0).max(100000).optional(),
  enabled: z.coerce.boolean().optional(),
});

const routingConfigSchema = z
  .object({
    maxRetries: z.coerce.number().int().min(0).max(100).optional(),
    failoverThreshold: z.coerce.number().int().min(0).max(100).optional(),
    retryStatusCodes: z
      .array(z.union([z.coerce.number().int().min(100).max(599), z.string().trim().min(1)]))
      .optional(),
    failbackCooldownMinutes: z.coerce.number().int().min(0).max(10080).optional(),
    healthScoreThreshold: z.coerce.number().min(0).max(1).nullable().optional(),
    latencyThresholdMs: z.coerce.number().int().min(0).max(600000).nullable().optional(),
    circuitBreakerThreshold: z.coerce.number().int().min(0).max(1000).nullable().optional(),
    allowedModelsMode: allowedModelsModeSchema.optional(),
    stickyByModel: z.coerce.boolean().optional(),
    stickyByFormat: z.coerce.boolean().optional(),
    rankingMode: automaticPoolRankingModeSchema.optional(),
    dynamicMemberRankingEnabled: z.coerce.boolean().optional(),
    healthTrackingMode: healthTrackingModeSchema.optional(),
    manualAvailability: z.coerce.number().min(0).max(1).nullable().optional(),
    manualLatencyMs: z.coerce.number().int().min(0).max(600000).nullable().optional(),
  })
  .nullable()
  .optional();

const visibilityConfigSchema = z
  .object({
    userIds: z.array(z.string().trim().min(1)).max(500).optional(),
    groupIds: z.array(z.string().trim().min(1)).max(500).optional(),
    roleIds: z.array(z.string().trim().min(1)).max(500).optional(),
  })
  .nullable()
  .optional();

const relayChannelBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  openaiUpstreamUrl: z.string().max(500).optional(),
  openaiUpstreamApiKey: z.string().max(500).optional(),
  useProxy: z.coerce.boolean().optional(),
  anthropicUpstreamUrl: z.string().max(500).optional(),
  anthropicUpstreamApiKey: z.string().max(500).optional(),
  geminiUpstreamUrl: z.string().max(500).optional(),
  geminiUpstreamApiKey: z.string().max(500).optional(),
  channelType: relayChannelTypeSchema.optional(),
  routingStrategy: routingStrategySchema.optional(),
  routingConfig: routingConfigSchema,
  visibilityMode: visibilityModeSchema.optional(),
  visibilityConfig: visibilityConfigSchema,
  poolMembers: z.array(relayChannelMemberSchema).max(200).nullable().optional(),
  pooledParentId: z.string().trim().min(1).nullable().optional(),
  pooledPriority: z.coerce.number().int().min(0).max(9999).optional(),
  pooledWeight: z.coerce.number().positive().max(100000).optional(),
  pooledMemberEnabled: z.coerce.boolean().optional(),
  multiplier: channelMultiplierSchema,
  allowedFormats: z.string().max(500).optional(),
  allowedModels: z.string().max(2000).nullable().optional(),
  addUserIdentifier: z.coerce.boolean().optional(),
  inputTokensIncludeCacheRead: z.coerce.boolean().optional(),
  modelMapping: z.record(z.string(), z.string()).nullable().optional(),
  timePeriodMultipliers: z.array(timePeriodRuleSchema).nullable().optional(),
  contextLengthMultipliers: z
    .array(contextLengthRuleSchema)
    .max(100)
    .refine(
      (rules) => new Set(rules.map((rule) => rule.minTokens)).size === rules.length,
      "contextLengthMultipliers must have unique minTokens",
    )
    .nullable()
    .optional(),
  providers: z.array(providerConfigSchema).max(100).optional(),
});

const relayChannelIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, "ids must be unique");

export const relayChannelIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const relayChannelManagementQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    keyword: z.string().trim().max(100).optional(),
    channelType: relayChannelTypeSchema.optional(),
    channelTypes: z
      .preprocess(
        (value) => (Array.isArray(value) ? value : value === undefined ? undefined : [value]),
        z
          .array(relayChannelTypeSchema)
          .min(1)
          .max(4)
          .refine((types) => new Set(types).size === types.length, "channelTypes must not contain duplicates"),
      )
      .optional(),
    enabled: z.preprocess(
      (value) => (value === "true" ? true : value === "false" ? false : value),
      z.boolean().optional(),
    ),
    submissionStatus: z.enum(["pending", "approved", "rejected", "offboarded"]).optional(),
  })
  .refine((query) => !(query.channelType && query.channelTypes?.length), {
    message: "channelType and channelTypes cannot be used together",
    path: ["channelTypes"],
  });

export const createRelayChannelBodySchema = relayChannelBaseSchema;

export const updateRelayChannelBodySchema = relayChannelBaseSchema.partial();

export const updateRelayChannelHealthConfigBodySchema = z
  .object({
    healthTrackingMode: healthTrackingModeSchema,
    manualAvailability: z.coerce.number().min(0).max(1).nullable().optional(),
    manualLatencyMs: z.coerce.number().int().min(0).max(600000).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.healthTrackingMode !== "manual") return;
    if (value.manualAvailability === undefined || value.manualAvailability === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manualAvailability"],
        message: "Required for manual tracking",
      });
    }
    if (value.manualLatencyMs === undefined || value.manualLatencyMs === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manualLatencyMs"],
        message: "Required for manual tracking",
      });
    }
  });

export const batchUpdateRelayChannelHealthConfigBodySchema = z
  .object({
    ids: relayChannelIdsSchema,
    healthTrackingMode: healthTrackingModeSchema,
    manualAvailability: z.coerce.number().min(0).max(1).nullable().optional(),
    manualLatencyMs: z.coerce.number().int().min(0).max(600000).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.healthTrackingMode !== "manual") return;
    if (value.manualAvailability === undefined || value.manualAvailability === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manualAvailability"],
        message: "Required for manual tracking",
      });
    }
    if (value.manualLatencyMs === undefined || value.manualLatencyMs === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manualLatencyMs"],
        message: "Required for manual tracking",
      });
    }
  });

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

const batchUpdateRelayChannelPatchSchema = z
  .object({
    multiplier: channelMultiplierSchema,
    allowedFormats: z.string().max(500).optional(),
    allowedModels: z.string().max(2000).nullable().optional(),
    addUserIdentifier: z.coerce.boolean().optional(),
    inputTokensIncludeCacheRead: z.coerce.boolean().optional(),
    modelMapping: z.record(z.string(), z.string()).nullable().optional(),
    visibilityMode: visibilityModeSchema.optional(),
    visibilityConfig: visibilityConfigSchema,
    routingStrategy: routingStrategySchema.optional(),
    routingConfig: routingConfigSchema,
    timePeriodMultipliers: z.array(timePeriodRuleSchema).nullable().optional(),
    contextLengthMultipliers: z
      .array(contextLengthRuleSchema)
      .max(100)
      .refine(
        (rules) => new Set(rules.map((rule) => rule.minTokens)).size === rules.length,
        "contextLengthMultipliers must have unique minTokens",
      )
      .nullable()
      .optional(),
  })
  .strict();

export const batchUpdateRelayChannelsBodySchema = z
  .object({
    ids: relayChannelIdsSchema,
    patch: batchUpdateRelayChannelPatchSchema,
    modelPricingMigration: z
      .object({
        sourceModelId: z.string().trim().min(1).max(200),
        targetPricingModel: z.string().trim().min(1).max(200),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value.patch).length > 0 || value.modelPricingMigration) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["patch"],
      message: "At least one patch field or modelPricingMigration is required",
    });
  });

export const exportRelayChannelsBodySchema = z.object({
  ids: relayChannelIdsSchema.optional(),
  includeDisabled: z.coerce.boolean().optional(),
});

export const importRelayChannelsBodySchema = z.object({
  channels: z
    .array(
      relayChannelBaseSchema.extend({
        id: z.string().trim().min(1).optional(),
        enabled: z.coerce.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const submitRelayChannelBodySchema = relayChannelBaseSchema
  .pick({
    name: true,
    openaiUpstreamUrl: true,
    openaiUpstreamApiKey: true,
    anthropicUpstreamUrl: true,
    anthropicUpstreamApiKey: true,
    geminiUpstreamUrl: true,
    geminiUpstreamApiKey: true,
    multiplier: true,
    allowedFormats: true,
    allowedModels: true,
    inputTokensIncludeCacheRead: true,
    modelMapping: true,
    timePeriodMultipliers: true,
    contextLengthMultipliers: true,
  })
  .extend({
    channelType: z.literal("standalone").optional(),
    providers: z.array(providerConfigSchema).max(100).optional(),
  });

export const createRelayChannelChangeRequestBodySchema = submitRelayChannelBodySchema.omit({
  channelType: true,
});

export const reviewRelayChannelChangeRequestBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional(),
});

export const updateRelayChannelProviderConfigBodySchema = z.object({
  multiplier: channelMultiplierSchema.optional(),
  providers: z.array(providerConfigSchema).max(100).optional(),
});

export const updateRelayChannelServiceStatusBodySchema = z.object({
  enabled: z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean()),
});

export const relayChannelUpstreamModelsBodySchema = z
  .object({
    format: z.enum(RELAY_UPSTREAM_FORMATS),
    channelId: z.string().trim().min(1).optional(),
    upstreamUrl: z.string().max(500).optional(),
    apiKey: z.string().max(500).optional(),
  })
  .superRefine((value, context) => {
    if (!value.channelId && (!value.upstreamUrl || !value.apiKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["channelId"],
        message: "channelId or upstream credentials are required",
      });
    }
  });

export const reviewRelayChannelSubmissionBodySchema = z.object({
  action: z.enum(["approve", "reject", "offboard"]),
  reason: z.string().trim().max(1000).optional(),
});

export const providerEarningsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
