import { z } from "zod";
import {
  MONTHLY_PASS_DECIMAL_SCALE,
  MONTHLY_PASS_MAX_AMOUNT_QUOTA,
  MONTHLY_PASS_MAX_INTEGER_QUOTA,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
} from "@/constant/monthly-pass";
import { MANAGED_STATUS } from "@/constant/status";

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

const PRICE_DECIMAL_SCALE = 4;
const DISCOUNT_PERCENT_SCALE = 2;
const PURCHASE_LIMIT_MAX = 9999;
const PURCHASE_LIMIT_WINDOW_MAX_DAYS = 3650;

const quotaUnitSchema = z.enum(["amount", "request", "token"]);
const quotaWindowHoursSchema = z.coerce.number().min(0).max(MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS);
const assignmentModeSchema = z.enum(["create_new", "extend_existing"]);

const hasDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < 1e-8;
};

const validateQuotaByUnit = (
  ctx: z.RefinementCtx,
  quotaUnit: z.infer<typeof quotaUnitSchema> | undefined,
  fieldName: string,
  value: number | null | undefined,
): void => {
  if (value == null) return;

  const unit = quotaUnit ?? "amount";
  const max = unit === "amount" ? MONTHLY_PASS_MAX_AMOUNT_QUOTA : MONTHLY_PASS_MAX_INTEGER_QUOTA;

  if (value > max)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [fieldName],
      message: `${fieldName} must not exceed ${max} when quotaUnit is ${unit}`,
    });

  if (unit !== "amount" && !Number.isInteger(value))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [fieldName],
      message: `${fieldName} must be an integer when quotaUnit is ${unit}`,
    });

  if (unit === "amount" && !hasDecimalPrecision(value, MONTHLY_PASS_DECIMAL_SCALE))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [fieldName],
      message: `${fieldName} must have at most ${MONTHLY_PASS_DECIMAL_SCALE} decimal places`,
    });
};

const validateUniqueQuotaWindowRules = (
  ctx: z.RefinementCtx,
  quotaWindows: Array<{ quotaUnit: z.infer<typeof quotaUnitSchema>; quotaWindowHours: number }> | undefined,
): void => {
  if (!quotaWindows) return;

  const ruleKeySet = new Set<string>();

  for (const [index, quotaWindow] of quotaWindows.entries()) {
    const ruleKey = `${quotaWindow.quotaUnit}:${quotaWindow.quotaWindowHours}`;
    if (ruleKeySet.has(ruleKey))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "quotaWindowHours + quotaUnit must be unique",
        path: ["quotaWindows", index, "quotaWindowHours"],
      });
    ruleKeySet.add(ruleKey);
  }
};

const monthlyPassQuotaWindowSchema = z
  .object({
    quotaLimit: z.coerce.number().positive(),
    quotaUnit: quotaUnitSchema,
    quotaWindowHours: quotaWindowHoursSchema,
  })
  .superRefine((value, ctx) => {
    validateQuotaByUnit(ctx, value.quotaUnit, "quotaLimit", value.quotaLimit);
  });

const monthlyPassTemplateBaseObjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  allowBalanceRedemption: z.coerce.boolean().optional(),
  purchaseLimitPerUser: z.coerce.number().int().min(1).max(PURCHASE_LIMIT_MAX).nullable().optional(),
  purchaseLimitWindowDays: z.coerce.number().int().min(1).max(PURCHASE_LIMIT_WINDOW_MAX_DAYS).nullable().optional(),
  originalPrice: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  defaultQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
  dailyQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
  quotaUnit: quotaUnitSchema.optional(),
  quotaWindowHours: quotaWindowHoursSchema.optional(),
  quotaWindows: z.array(monthlyPassQuotaWindowSchema).max(20).optional(),
  allowedModels: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
  allowedChannels: z.array(z.string().trim().min(1).max(100)).max(500).optional(),
});

const monthlyPassTemplateBaseSchema = monthlyPassTemplateBaseObjectSchema.superRefine((value, ctx) => {
  const hasLimit = value.purchaseLimitPerUser !== undefined && value.purchaseLimitPerUser !== null;
  const hasLimitWindow = value.purchaseLimitWindowDays !== undefined && value.purchaseLimitWindowDays !== null;
  if (hasLimit !== hasLimitWindow)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["purchaseLimitPerUser"],
      message: "purchaseLimitPerUser and purchaseLimitWindowDays must be set together",
    });

  const hasPricingInput = value.originalPrice !== undefined || value.discountPercent !== undefined;

  if (hasPricingInput) {
    if (value.originalPrice === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["originalPrice"],
        message: "originalPrice is required when using price-first monthly pass templates",
      });

    if (value.discountPercent === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountPercent"],
        message: "discountPercent is required when using price-first monthly pass templates",
      });

    if (value.defaultQuota !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultQuota"],
        message: "defaultQuota cannot be provided when using price-first monthly pass templates",
      });

    if (value.quotaUnit !== undefined && value.quotaUnit !== "amount")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quotaUnit"],
        message: "quotaUnit must be amount for price-first monthly pass templates",
      });

    if (value.originalPrice !== undefined && !hasDecimalPrecision(value.originalPrice, PRICE_DECIMAL_SCALE))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["originalPrice"],
        message: `originalPrice must have at most ${PRICE_DECIMAL_SCALE} decimal places`,
      });

    if (value.discountPercent !== undefined && !hasDecimalPrecision(value.discountPercent, DISCOUNT_PERCENT_SCALE))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountPercent"],
        message: `discountPercent must have at most ${DISCOUNT_PERCENT_SCALE} decimal places`,
      });

    validateQuotaByUnit(ctx, "amount", "dailyQuota", value.dailyQuota);
  } else {
    if (value.defaultQuota == null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultQuota"],
        message: "defaultQuota is required when not using price-first monthly pass templates",
      });

    const quotaUnit = value.quotaUnit ?? "amount";
    validateQuotaByUnit(ctx, quotaUnit, "defaultQuota", value.defaultQuota);
    validateQuotaByUnit(ctx, quotaUnit, "dailyQuota", value.dailyQuota);
  }

  validateUniqueQuotaWindowRules(ctx, value.quotaWindows);
});

const userMonthlyPassBaseSchema = z
  .object({
    userId: z.string().trim().min(1).max(50),
    templateId: z.string().trim().min(1).max(50),
    startAt: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "startAt must be a valid date string"),
    endAt: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "endAt must be a valid date string"),
    totalQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
    dailyQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
    quotaUnit: quotaUnitSchema.optional(),
    quotaWindowHours: quotaWindowHoursSchema.optional(),
    quotaWindows: z.array(monthlyPassQuotaWindowSchema).max(20).optional(),
    note: z.string().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    validateQuotaByUnit(ctx, value.quotaUnit, "totalQuota", value.totalQuota);
    validateQuotaByUnit(ctx, value.quotaUnit, "dailyQuota", value.dailyQuota);

    validateUniqueQuotaWindowRules(ctx, value.quotaWindows);
  });

export const monthlyPassTemplateIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const userMonthlyPassIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createMonthlyPassTemplateBodySchema = monthlyPassTemplateBaseSchema;

export const updateMonthlyPassTemplateBodySchema = monthlyPassTemplateBaseObjectSchema
  .partial()
  .extend({
    defaultQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
    dailyQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).nullable().optional(),
    quotaWindowHours: quotaWindowHoursSchema.nullable().optional(),
    quotaWindows: z.array(monthlyPassQuotaWindowSchema).max(20).optional(),
    allowedModels: z.array(z.string().trim().min(1).max(200)).max(500).nullable().optional(),
    allowedChannels: z.array(z.string().trim().min(1).max(100)).max(500).nullable().optional(),
    status: z.coerce.number().int().min(MANAGED_STATUS.DELETED).max(MANAGED_STATUS.ENABLED).optional(),
  })
  .superRefine((value, ctx) => {
    const hasLimit = value.purchaseLimitPerUser !== undefined && value.purchaseLimitPerUser !== null;
    const hasLimitWindow = value.purchaseLimitWindowDays !== undefined && value.purchaseLimitWindowDays !== null;
    if (hasLimit !== hasLimitWindow)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchaseLimitPerUser"],
        message: "purchaseLimitPerUser and purchaseLimitWindowDays must be set together",
      });

    const hasPricingUpdate = value.originalPrice !== undefined || value.discountPercent !== undefined;

    if (value.originalPrice !== undefined && !hasDecimalPrecision(value.originalPrice, PRICE_DECIMAL_SCALE))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["originalPrice"],
        message: `originalPrice must have at most ${PRICE_DECIMAL_SCALE} decimal places`,
      });

    if (value.discountPercent !== undefined && !hasDecimalPrecision(value.discountPercent, DISCOUNT_PERCENT_SCALE))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountPercent"],
        message: `discountPercent must have at most ${DISCOUNT_PERCENT_SCALE} decimal places`,
      });

    if (hasPricingUpdate) {
      if (value.originalPrice === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["originalPrice"],
          message: "originalPrice is required when updating price-first monthly pass templates",
        });

      if (value.discountPercent === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["discountPercent"],
          message: "discountPercent is required when updating price-first monthly pass templates",
        });

      if (value.defaultQuota !== undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["defaultQuota"],
          message: "defaultQuota cannot be provided when updating price-first monthly pass templates",
        });

      if (value.quotaUnit !== undefined && value.quotaUnit !== "amount")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quotaUnit"],
          message: "quotaUnit must be amount for price-first monthly pass templates",
        });

      validateQuotaByUnit(ctx, "amount", "dailyQuota", value.dailyQuota);
    } else {
      const quotaUnit = value.quotaUnit ?? "amount";
      validateQuotaByUnit(ctx, quotaUnit, "defaultQuota", value.defaultQuota);
      validateQuotaByUnit(ctx, quotaUnit, "dailyQuota", value.dailyQuota);
    }

    validateUniqueQuotaWindowRules(ctx, value.quotaWindows);
  });

export const listMonthlyPassTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(0).max(100).optional(),
  keyword: z.string().trim().max(100).optional(),
  status: z.coerce.number().int().min(MANAGED_STATUS.DELETED).max(MANAGED_STATUS.ENABLED).optional(),
});

export const assignUserMonthlyPassBodySchema = userMonthlyPassBaseSchema.refine(
  (value) => Date.parse(value.endAt) > Date.parse(value.startAt),
  {
    message: "endAt must be later than startAt",
    path: ["endAt"],
  },
);

export const claimMonthlyPassTemplateBodySchema = z.object({
  templateId: z.string().trim().min(1).max(50),
});

export const updateUserMonthlyPassBodySchema = z
  .object({
    startAt: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "startAt must be a valid date string")
      .optional(),
    endAt: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "endAt must be a valid date string")
      .optional(),
    totalQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
    dailyQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).nullable().optional(),
    quotaUnit: quotaUnitSchema.optional(),
    quotaWindowHours: quotaWindowHoursSchema.nullable().optional(),
    quotaWindows: z.array(monthlyPassQuotaWindowSchema).max(20).optional(),
    note: z.string().max(1000).optional(),
    status: z.coerce.number().int().min(MANAGED_STATUS.DELETED).max(MANAGED_STATUS.ENABLED).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.quotaUnit) return;

    validateQuotaByUnit(ctx, value.quotaUnit, "totalQuota", value.totalQuota);
    validateQuotaByUnit(ctx, value.quotaUnit, "dailyQuota", value.dailyQuota);

    validateUniqueQuotaWindowRules(ctx, value.quotaWindows);
  });

export const assignBatchUserMonthlyPassBodySchema = z
  .object({
    userIds: z.array(z.string().trim().min(1).max(50)).max(5000).optional(),
    targetFilter: z
      .object({
        keyword: z.string().trim().max(200).optional(),
        groupId: z.string().trim().min(1).max(50).optional(),
        includeAllVisible: z.coerce.boolean().optional(),
      })
      .optional(),
    templateId: z.string().trim().min(1).max(50),
    startAt: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "startAt must be a valid date string"),
    endAt: z
      .string()
      .max(40)
      .refine((value) => validDateString(value), "endAt must be a valid date string"),
    totalQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
    dailyQuota: z.coerce.number().min(0.0001).max(MONTHLY_PASS_MAX_AMOUNT_QUOTA).optional(),
    quotaUnit: quotaUnitSchema.optional(),
    quotaWindowHours: quotaWindowHoursSchema.optional(),
    quotaWindows: z.array(monthlyPassQuotaWindowSchema).max(20).optional(),
    note: z.string().max(1000).optional(),
    assignmentMode: assignmentModeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.endAt) <= Date.parse(value.startAt))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endAt must be later than startAt",
        path: ["endAt"],
      });

    validateQuotaByUnit(ctx, value.quotaUnit, "totalQuota", value.totalQuota);
    validateQuotaByUnit(ctx, value.quotaUnit, "dailyQuota", value.dailyQuota);
    validateUniqueQuotaWindowRules(ctx, value.quotaWindows);

    const hasUserIds = Array.isArray(value.userIds) && value.userIds.length > 0;
    const hasTargetFilter =
      value.targetFilter != null &&
      (Boolean(value.targetFilter.includeAllVisible) ||
        Boolean(value.targetFilter.keyword) ||
        Boolean(value.targetFilter.groupId));

    if (!hasUserIds && !hasTargetFilter)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "userIds or targetFilter is required",
        path: ["userIds"],
      });
  });

export const listUserMonthlyPassesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(0).max(100).optional(),
  userId: z.string().trim().optional(),
  templateId: z.string().trim().optional(),
  status: z.coerce.number().int().min(MANAGED_STATUS.DELETED).max(MANAGED_STATUS.ENABLED).optional(),
});

export const listMyMonthlyPassesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(0).max(100).optional(),
  status: z.coerce.number().int().min(MANAGED_STATUS.DELETED).max(MANAGED_STATUS.ENABLED).optional(),
});

export const listMonthlyPassUsagesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().min(0).max(100).optional(),
  userId: z.string().trim().optional(),
  templateId: z.string().trim().optional(),
  model: z.string().trim().optional(),
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
