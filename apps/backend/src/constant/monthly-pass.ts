import { env } from "@/config/env";

export const MONTHLY_PASS_MAX_PAGE_SIZE = 100;
export const MONTHLY_PASS_DEFAULT_PAGE_SIZE = Math.min(
  env.integrations.monthlyPass.defaultPageSize,
  MONTHLY_PASS_MAX_PAGE_SIZE,
);

// Quota fields are persisted with @db.Decimal(10, 4).
export const MONTHLY_PASS_DECIMAL_SCALE = 4;

// Keep sliding window capped to 12 months (360 days) to bound historical scan cost.
const MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK = 24 * 30 * 12;

export const MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS = Math.min(
  env.integrations.monthlyPass.defaultQuotaWindowHours,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK,
);

export const MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS = Math.max(
  MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
  Math.min(env.integrations.monthlyPass.maxQuotaWindowHours, MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK),
);

export const MONTHLY_PASS_QUOTA_WINDOW_MS = 60 * 60 * 1000;

export const MONTHLY_PASS_MAX_AMOUNT_QUOTA = env.integrations.monthlyPass.maxAmountQuota;

export const MONTHLY_PASS_MAX_INTEGER_QUOTA = env.integrations.monthlyPass.maxIntegerQuota;
