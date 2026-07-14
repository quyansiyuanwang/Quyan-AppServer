import { z } from "zod";
import {
  MONTHLY_PASS_DECIMAL_SCALE,
  MONTHLY_PASS_MAX_AMOUNT_QUOTA,
  MONTHLY_PASS_MAX_INTEGER_QUOTA,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
} from "@/constant/monthly-pass";
import {
  isValidRetryStatusRule,
  MAX_RETRY_STATUS_RULES,
  normalizeRetryStatusRules,
} from "@/util/relay-failover-status-rule.util";
import { isValidIpWhitelistEntry, splitIpWhitelistEntries } from "@/util/ip-whitelist.util";

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

const hasDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < 1e-8;
};

export const relayTokenIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const relayTokenChannelConfigSchema = z.object({
  channelId: z.string().trim().min(1).max(50),
  priority: z.coerce.number().int().min(0).max(999),
});

const relayTokenIdsSchema = z
  .array(z.string().trim().min(1).max(50))
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, "ids must be unique");

const relayTokenQuotaWindowSchema = z
  .object({
    quotaLimit: z.coerce.number().positive(),
    quotaUnit: z.enum(["amount", "request", "token"]),
    quotaWindowHours: z.coerce.number().min(0).max(MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS),
  })
  .superRefine((value, ctx) => {
    if ((value.quotaUnit === "request" || value.quotaUnit === "token") && !Number.isInteger(value.quotaLimit))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `quotaLimit must be an integer when quotaUnit is ${value.quotaUnit}`,
        path: ["quotaLimit"],
      });

    if (value.quotaUnit === "amount" && !hasDecimalPrecision(value.quotaLimit, MONTHLY_PASS_DECIMAL_SCALE))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `quotaLimit must have at most ${MONTHLY_PASS_DECIMAL_SCALE} decimal places when quotaUnit is amount`,
        path: ["quotaLimit"],
      });

    const max = value.quotaUnit === "amount" ? MONTHLY_PASS_MAX_AMOUNT_QUOTA : MONTHLY_PASS_MAX_INTEGER_QUOTA;
    if (value.quotaLimit > max)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `quotaLimit must not exceed ${max} when quotaUnit is ${value.quotaUnit}`,
        path: ["quotaLimit"],
      });
  });

const retryStatusRuleSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "number" ? String(value) : value.trim()))
  .refine((value) => isValidRetryStatusRule(value), {
    message:
      "retryStatusCodes must be exact HTTP codes, wildcard rules like 4xx/xx*, or regex literals such as /^5(02|03)$/",
  });

const relayTokenFailoverConfigSchema = z.object({
  enabled: z.boolean(),
  maxRetries: z.coerce.number().int().min(0).max(100),
  retryStatusCodes: z
    .array(retryStatusRuleSchema)
    .max(MAX_RETRY_STATUS_RULES)
    .default([])
    .transform((rules) => normalizeRetryStatusRules(rules)),
  failoverThreshold: z.coerce.number().int().min(0).max(100).default(0),
  failbackCooldownMinutes: z.coerce.number().int().min(0).max(525600).default(0),
});

const relayTokenIpWhitelistSchema = z
  .string()
  .max(4000)
  .refine(
    (value) => splitIpWhitelistEntries(value).every((entry) => isValidIpWhitelistEntry(entry)),
    "ipWhitelist must contain valid IP addresses",
  );

const customTokenSchema = z
  .string()
  .trim()
  .min(12)
  .max(200)
  .regex(/^rlt_[a-zA-Z0-9]+$/, "custom token must start with rlt_ and contain only alphanumeric characters");

export const createRelayTokenBodySchema = z
  .object({
    targetUserId: z.string().trim().min(1).max(50).optional(),
    name: z.string().max(100).nullish(),
    token: customTokenSchema.optional(),
    expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
    channelId: z.string().trim().min(1).max(50).optional(),
    channelConfigs: z.array(relayTokenChannelConfigSchema).min(1).max(20).optional(),
    failoverConfig: relayTokenFailoverConfigSchema.optional(),
    quotaLimit: z.union([z.null(), z.coerce.number().min(0).max(99999999.99)]).optional(),
    quotaWindows: z.array(relayTokenQuotaWindowSchema).max(20).optional(),
    allowedModels: z.string().max(2000).nullish(),
    ipWhitelist: z.union([relayTokenIpWhitelistSchema, z.null()]).optional(),
    modelMapping: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.channelId && (!value.channelConfigs || value.channelConfigs.length === 0))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channelId or channelConfigs is required",
        path: ["channelConfigs"],
      });

    if (value.channelConfigs) {
      const channelIdSet = new Set<string>();
      const prioritySet = new Set<number>();

      for (const [index, config] of value.channelConfigs.entries()) {
        if (channelIdSet.has(config.channelId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "channelId must be unique",
            path: ["channelConfigs", index, "channelId"],
          });
        channelIdSet.add(config.channelId);

        if (prioritySet.has(config.priority))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "priority must be unique",
            path: ["channelConfigs", index, "priority"],
          });
        prioritySet.add(config.priority);
      }
    }

    if (value.quotaWindows) {
      const ruleKeySet = new Set<string>();

      for (const [index, quotaWindow] of value.quotaWindows.entries()) {
        const ruleKey = `${quotaWindow.quotaUnit}:${quotaWindow.quotaWindowHours}`;
        if (ruleKeySet.has(ruleKey))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "quotaWindowHours + quotaUnit must be unique",
            path: ["quotaWindows", index, "quotaWindowHours"],
          });
        ruleKeySet.add(ruleKey);
      }
    }
  });

export const updateRelayTokenBodySchema = z
  .object({
    targetUserId: z.string().trim().min(1).max(50).optional(),
    name: z.string().max(100).nullish(),
    token: customTokenSchema.optional(),
    expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
    channelId: z.string().trim().min(1).max(50).optional(),
    channelConfigs: z.array(relayTokenChannelConfigSchema).min(1).max(20).optional(),
    failoverConfig: relayTokenFailoverConfigSchema.optional(),
    quotaLimit: z.union([z.null(), z.coerce.number().min(0).max(99999999.99)]).optional(),
    quotaWindows: z.array(relayTokenQuotaWindowSchema).max(20).optional(),
    allowedModels: z.string().max(2000).nullish(),
    ipWhitelist: z.union([relayTokenIpWhitelistSchema, z.null()]).optional(),
    modelMapping: z.record(z.string(), z.string()).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.channelConfigs) {
      const channelIdSet = new Set<string>();
      const prioritySet = new Set<number>();

      for (const [index, config] of value.channelConfigs.entries()) {
        if (channelIdSet.has(config.channelId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "channelId must be unique",
            path: ["channelConfigs", index, "channelId"],
          });
        channelIdSet.add(config.channelId);

        if (prioritySet.has(config.priority))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "priority must be unique",
            path: ["channelConfigs", index, "priority"],
          });
        prioritySet.add(config.priority);
      }
    }

    if (value.quotaWindows) {
      const ruleKeySet = new Set<string>();

      for (const [index, quotaWindow] of value.quotaWindows.entries()) {
        const ruleKey = `${quotaWindow.quotaUnit}:${quotaWindow.quotaWindowHours}`;
        if (ruleKeySet.has(ruleKey))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "quotaWindowHours + quotaUnit must be unique",
            path: ["quotaWindows", index, "quotaWindowHours"],
          });
        ruleKeySet.add(ruleKey);
      }
    }
  });

export const relayTokenAvailableModelsPreviewBodySchema = z
  .object({
    targetUserId: z.string().trim().min(1).max(50).optional(),
    channelId: z.string().trim().min(1).max(50).optional(),
    channelConfigs: z.array(relayTokenChannelConfigSchema).min(1).max(20).optional(),
    failoverConfig: relayTokenFailoverConfigSchema.optional(),
    allowedModels: z.string().max(2000).nullish(),
    modelMapping: z.record(z.string(), z.string()).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.channelId && (!value.channelConfigs || value.channelConfigs.length === 0))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channelId or channelConfigs is required",
        path: ["channelConfigs"],
      });

    if (!value.channelConfigs) return;
    const channelIds = new Set<string>();
    const priorities = new Set<number>();
    for (const [index, config] of value.channelConfigs.entries()) {
      if (channelIds.has(config.channelId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "channelId must be unique",
          path: ["channelConfigs", index, "channelId"],
        });
      channelIds.add(config.channelId);

      if (priorities.has(config.priority))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "priority must be unique",
          path: ["channelConfigs", index, "priority"],
        });
      priorities.add(config.priority);
    }
  });

export const updateRelayTokenChannelBodySchema = z.object({
  targetUserId: z.string().trim().min(1).max(50).optional(),
  channelId: z.string().trim().min(1).max(50),
});

export const duplicateRelayTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(100).nullish(),
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

export const exportRelayTokensBodySchema = z.object({
  ids: relayTokenIdsSchema.optional(),
  includeDisabled: z.coerce.boolean().optional(),
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

const relayTokenImportItemSchema = z
  .object({
    name: z.string().max(100).nullish(),
    token: customTokenSchema.optional(),
    expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
    channelId: z.string().trim().min(1).max(50).optional(),
    channelConfigs: z.array(relayTokenChannelConfigSchema).min(1).max(20).optional(),
    failoverConfig: relayTokenFailoverConfigSchema.optional(),
    quotaLimit: z.union([z.null(), z.coerce.number().min(0).max(99999999.99)]).optional(),
    quotaWindows: z.array(relayTokenQuotaWindowSchema).max(20).optional(),
    allowedModels: z.string().max(2000).nullish(),
    ipWhitelist: z.union([relayTokenIpWhitelistSchema, z.null()]).optional(),
    enabled: z.coerce.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.channelId && (!value.channelConfigs || value.channelConfigs.length === 0))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channelId or channelConfigs is required",
        path: ["channelConfigs"],
      });

    if (value.channelConfigs) {
      const channelIdSet = new Set<string>();
      const prioritySet = new Set<number>();

      for (const [index, config] of value.channelConfigs.entries()) {
        if (channelIdSet.has(config.channelId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "channelId must be unique",
            path: ["channelConfigs", index, "channelId"],
          });
        channelIdSet.add(config.channelId);

        if (prioritySet.has(config.priority))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "priority must be unique",
            path: ["channelConfigs", index, "priority"],
          });
        prioritySet.add(config.priority);
      }
    }

    if (value.quotaWindows) {
      const ruleKeySet = new Set<string>();

      for (const [index, quotaWindow] of value.quotaWindows.entries()) {
        const ruleKey = `${quotaWindow.quotaUnit}:${quotaWindow.quotaWindowHours}`;
        if (ruleKeySet.has(ruleKey))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "quotaWindowHours + quotaUnit must be unique",
            path: ["quotaWindows", index, "quotaWindowHours"],
          });
        ruleKeySet.add(ruleKey);
      }
    }
  });

export const importRelayTokensBodySchema = z.object({
  tokens: z.array(relayTokenImportItemSchema).min(1).max(200),
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

export const batchSetRelayTokenStatusBodySchema = z.object({
  ids: relayTokenIdsSchema,
  enabled: z.coerce.boolean(),
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

export const batchDeleteRelayTokensBodySchema = z.object({
  ids: relayTokenIdsSchema,
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

export const batchDuplicateRelayTokensBodySchema = z.object({
  ids: relayTokenIdsSchema,
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

export const relayTokenListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  targetUserId: z.string().trim().min(1).max(50).optional(),
});

const relayTokenUsageQueryBaseSchema = z.object({
  startDate: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "startDate must be a valid date string")
    .optional(),
  endDate: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "endDate must be a valid date string")
    .optional(),
  windowHours: z.coerce.number().min(0).max(MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS).optional(),
  resetAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "resetAt must be in HH:mm format")
    .optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
});

export const relayTokenUsageQuerySchema = relayTokenUsageQueryBaseSchema.superRefine((value, ctx) => {
  if (value.startDate && value.endDate) {
    const start = Date.parse(value.startDate);
    const end = Date.parse(value.endDate);
    if (!Number.isNaN(start) && !Number.isNaN(end) && start > end)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startDate must be less than or equal to endDate",
        path: ["startDate"],
      });
  }
});

export const relayTokenUsageSummaryQuerySchema = relayTokenUsageQueryBaseSchema
  .extend({
    targetUserId: z.string().trim().min(1).max(50).optional(),
    tokenIds: z
      .string()
      .max(4000)
      .refine(
        (value) =>
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .every((item) => item.length <= 50),
        "tokenIds must be a comma-separated list of token ids",
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate) {
      const start = Date.parse(value.startDate);
      const end = Date.parse(value.endDate);
      if (!Number.isNaN(start) && !Number.isNaN(end) && start > end)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDate must be less than or equal to endDate",
          path: ["startDate"],
        });
    }
  });

export const relayTokenUsageDetailQuerySchema = relayTokenUsageQueryBaseSchema
  .extend({
    targetUserId: z.string().trim().min(1).max(50).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(10000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate) {
      const start = Date.parse(value.startDate);
      const end = Date.parse(value.endDate);
      if (!Number.isNaN(start) && !Number.isNaN(end) && start > end)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDate must be less than or equal to endDate",
          path: ["startDate"],
        });
    }
  });

export const relayTokenSwitchLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  targetUserId: z.string().trim().min(1).max(50).optional(),
});
