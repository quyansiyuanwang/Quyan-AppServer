const toPositiveInt = (value: string | undefined, fallback: number, min: number, max?: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const normalized = Math.floor(parsed);
  if (normalized < min) return fallback;
  if (max != null && normalized > max) return fallback;

  return normalized;
};

const toPositiveNumber = (value: string | undefined, fallback: number, min: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;

  return parsed;
};

export const MONTHLY_PASS_MAX_PAGE_SIZE = 100;
export const MONTHLY_PASS_DEFAULT_PAGE_SIZE = toPositiveInt(
  process.env.MONTHLY_PASS_DEFAULT_PAGE_SIZE,
  20,
  1,
  MONTHLY_PASS_MAX_PAGE_SIZE,
);

// Quota fields are persisted with @db.Decimal(10, 4).
export const MONTHLY_PASS_DECIMAL_SCALE = 4;

// Keep sliding window capped to 12 months (360 days) to bound historical scan cost.
const MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK = 24 * 30 * 12;

export const MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS = toPositiveInt(
  process.env.MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
  24,
  1,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK,
);

export const MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS = toPositiveInt(
  process.env.MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS_FALLBACK,
  MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
);

export const MONTHLY_PASS_QUOTA_WINDOW_MS = 60 * 60 * 1000;

export const MONTHLY_PASS_MAX_AMOUNT_QUOTA = toPositiveNumber(
  process.env.MONTHLY_PASS_MAX_AMOUNT_QUOTA,
  999999.9999,
  0.0001,
);

export const MONTHLY_PASS_MAX_INTEGER_QUOTA = toPositiveInt(process.env.MONTHLY_PASS_MAX_INTEGER_QUOTA, 999999, 1);
