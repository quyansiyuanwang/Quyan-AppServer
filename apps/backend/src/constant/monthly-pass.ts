import { EnvSpace } from "@/config/env";

export const MONTHLY_PASS_MAX_PAGE_SIZE = 100;
export const MONTHLY_PASS_DEFAULT_PAGE_SIZE = Math.min(
  EnvSpace.monthlyPassConfig.defaultPageSize,
  MONTHLY_PASS_MAX_PAGE_SIZE,
);

// Quota fields are persisted with @db.Decimal(10, 4).
export const MONTHLY_PASS_DECIMAL_SCALE = 4;

// Keep sliding window capped to 12 months (360 days) to bound historical scan cost.
const MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK = 24 * 30 * 12;

export const MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS = Math.min(
  EnvSpace.monthlyPassConfig.defaultQuotaWindowHours,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK,
);

export const MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS = Math.max(
  MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
  Math.min(EnvSpace.monthlyPassConfig.maxQuotaWindowHours, MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK),
);

export const MONTHLY_PASS_QUOTA_WINDOW_MS = 60 * 60 * 1000;

export const MONTHLY_PASS_MAX_AMOUNT_QUOTA = EnvSpace.monthlyPassConfig.maxAmountQuota;

export const MONTHLY_PASS_MAX_INTEGER_QUOTA = EnvSpace.monthlyPassConfig.maxIntegerQuota;
