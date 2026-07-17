import {
  MONTHLY_PASS_DECIMAL_SCALE,
  MONTHLY_PASS_MAX_AMOUNT_QUOTA,
  MONTHLY_PASS_MAX_INTEGER_QUOTA,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
} from "@/constant/monthly-pass";

export type MonthlyPassQuotaUnitValue = "amount" | "request" | "token";

export const MONTHLY_PASS_PRICE_DECIMAL_SCALE = 4;
export const MONTHLY_PASS_DISCOUNT_PERCENT_SCALE = 2;
export const MONTHLY_PASS_PURCHASE_LIMIT_MAX = 9999;
export const MONTHLY_PASS_PURCHASE_LIMIT_WINDOW_MAX_DAYS = 3650;

export const hasMonthlyPassDecimalPrecision = (value: number, scale: number): boolean => {
  const factor = 10 ** scale;
  const scaled = value * factor;
  return Math.abs(Math.round(scaled) - scaled) < 1e-8;
};

export const isMonthlyPassIntegerQuotaUnit = (unit: MonthlyPassQuotaUnitValue): boolean => {
  return unit === "request" || unit === "token";
};

export const getMonthlyPassQuotaMax = (unit: MonthlyPassQuotaUnitValue): number => {
  return isMonthlyPassIntegerQuotaUnit(unit) ? MONTHLY_PASS_MAX_INTEGER_QUOTA : MONTHLY_PASS_MAX_AMOUNT_QUOTA;
};

export const getMonthlyPassQuotaValidationError = (
  fieldName: string,
  value: number,
  unit: MonthlyPassQuotaUnitValue,
): string | undefined => {
  if (!Number.isFinite(value) || value <= 0) return `${fieldName} must be greater than 0`;

  if (isMonthlyPassIntegerQuotaUnit(unit) && !Number.isInteger(value))
    return `${fieldName} must be an integer when quotaUnit is ${unit}`;

  if (!isMonthlyPassIntegerQuotaUnit(unit) && !hasMonthlyPassDecimalPrecision(value, MONTHLY_PASS_DECIMAL_SCALE))
    return `${fieldName} must have at most ${MONTHLY_PASS_DECIMAL_SCALE} decimal places when quotaUnit is amount`;

  const max = getMonthlyPassQuotaMax(unit);
  if (value > max) return `${fieldName} must not exceed ${max} when quotaUnit is ${unit}`;

  return undefined;
};

export const getMonthlyPassPriceValidationError = (
  fieldName: string,
  value: number,
  options: { allowZero?: boolean } = {},
): string | undefined => {
  const isBelowMinimum = options.allowZero ? value < 0 : value <= 0;
  if (!Number.isFinite(value) || isBelowMinimum)
    return `${fieldName} must be ${options.allowZero ? "greater than or equal to" : "greater than"} 0`;

  if (!hasMonthlyPassDecimalPrecision(value, MONTHLY_PASS_PRICE_DECIMAL_SCALE))
    return `${fieldName} must have at most ${MONTHLY_PASS_PRICE_DECIMAL_SCALE} decimal places`;

  if (value > MONTHLY_PASS_MAX_AMOUNT_QUOTA) return `${fieldName} must not exceed ${MONTHLY_PASS_MAX_AMOUNT_QUOTA}`;

  return undefined;
};

export const getMonthlyPassDiscountPercentValidationError = (value: number): string | undefined => {
  if (!Number.isFinite(value) || value < 0 || value > 100)
    return "discountPercent must be greater than or equal to 0 and less than or equal to 100";

  if (!hasMonthlyPassDecimalPrecision(value, MONTHLY_PASS_DISCOUNT_PERCENT_SCALE))
    return `discountPercent must have at most ${MONTHLY_PASS_DISCOUNT_PERCENT_SCALE} decimal places`;

  return undefined;
};

export const getMonthlyPassQuotaWindowHoursValidationError = (
  value: number,
  options: { allowExceedMax?: boolean } = {},
): string | undefined => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
    return "quotaWindowHours must be a positive integer";

  if (!options.allowExceedMax && value > MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS)
    return `quotaWindowHours must be less than or equal to ${MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS}`;

  return undefined;
};

export const getMonthlyPassPositiveIntegerValidationError = (
  fieldName: string,
  value: number,
  max: number,
): string | undefined => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
    return `${fieldName} must be a positive integer`;

  if (value > max) return `${fieldName} must not exceed ${max}`;

  return undefined;
};
