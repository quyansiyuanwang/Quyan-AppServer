import {
  MONTHLY_PASS_DECIMAL_SCALE,
  MONTHLY_PASS_MAX_AMOUNT_QUOTA,
  MONTHLY_PASS_MAX_INTEGER_QUOTA,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
} from "@/constant/monthly-pass";
import type { MessageKey, TranslationParams } from "@/locales";

export type MonthlyPassQuotaUnitValue = "amount" | "request" | "token";

export const MONTHLY_PASS_PRICE_DECIMAL_SCALE = 4;
export const MONTHLY_PASS_DISCOUNT_PERCENT_SCALE = 2;
export const MONTHLY_PASS_PURCHASE_LIMIT_MAX = 9999;
export const MONTHLY_PASS_PURCHASE_LIMIT_WINDOW_MAX_DAYS = 3650;

/**
 * 校验失败的结构化描述。
 *
 * 这里**不再返回英文原句**（P09 前它返回字符串，被调用方直接当作 message 抛出，
 * 导致 zh-CN 用户看到英文，且无法本地化）。改为返回「消息 key + 安全标量参数」，
 * 由调用方通过 `messageKey` 携带，最终在响应边界统一渲染。
 */
export interface MonthlyPassValidationIssue {
  key: MessageKey;
  params?: TranslationParams;
}

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
): MonthlyPassValidationIssue | undefined => {
  if (!Number.isFinite(value) || value <= 0)
    return { key: "monthlyPass.fieldMustBePositive", params: { field: fieldName } };

  if (isMonthlyPassIntegerQuotaUnit(unit) && !Number.isInteger(value))
    return { key: "monthlyPass.fieldMustBeIntegerForUnit", params: { field: fieldName, unit } };

  if (!isMonthlyPassIntegerQuotaUnit(unit) && !hasMonthlyPassDecimalPrecision(value, MONTHLY_PASS_DECIMAL_SCALE))
    return {
      key: "monthlyPass.fieldDecimalPlacesForAmount",
      params: { field: fieldName, scale: MONTHLY_PASS_DECIMAL_SCALE },
    };

  const max = getMonthlyPassQuotaMax(unit);
  if (value > max) return { key: "monthlyPass.fieldMustNotExceedForUnit", params: { field: fieldName, max, unit } };

  return undefined;
};

export const getMonthlyPassPriceValidationError = (
  fieldName: string,
  value: number,
  options: { allowZero?: boolean } = {},
): MonthlyPassValidationIssue | undefined => {
  const isBelowMinimum = options.allowZero ? value < 0 : value <= 0;
  if (!Number.isFinite(value) || isBelowMinimum)
    return {
      key: options.allowZero ? "monthlyPass.fieldMustBeNonNegative" : "monthlyPass.fieldMustBePositive",
      params: { field: fieldName },
    };

  if (!hasMonthlyPassDecimalPrecision(value, MONTHLY_PASS_PRICE_DECIMAL_SCALE))
    return {
      key: "monthlyPass.fieldDecimalPlaces",
      params: { field: fieldName, scale: MONTHLY_PASS_PRICE_DECIMAL_SCALE },
    };

  if (value > MONTHLY_PASS_MAX_AMOUNT_QUOTA)
    return { key: "monthlyPass.fieldMustNotExceed", params: { field: fieldName, max: MONTHLY_PASS_MAX_AMOUNT_QUOTA } };

  return undefined;
};

export const getMonthlyPassDiscountPercentValidationError = (value: number): MonthlyPassValidationIssue | undefined => {
  if (!Number.isFinite(value) || value < 0 || value > 100) return { key: "monthlyPass.discountPercentRange" };

  if (!hasMonthlyPassDecimalPrecision(value, MONTHLY_PASS_DISCOUNT_PERCENT_SCALE))
    return { key: "monthlyPass.discountPercentDecimalPlaces", params: { scale: MONTHLY_PASS_DISCOUNT_PERCENT_SCALE } };

  return undefined;
};

export const getMonthlyPassQuotaWindowHoursValidationError = (
  value: number,
  options: { allowExceedMax?: boolean } = {},
): MonthlyPassValidationIssue | undefined => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
    return { key: "monthlyPass.quotaWindowHoursPositiveInteger" };

  if (!options.allowExceedMax && value > MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS)
    return { key: "monthlyPass.quotaWindowHoursMax", params: { max: MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS } };

  return undefined;
};

export const getMonthlyPassPositiveIntegerValidationError = (
  fieldName: string,
  value: number,
  max: number,
): MonthlyPassValidationIssue | undefined => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
    return { key: "monthlyPass.fieldMustBePositiveInteger", params: { field: fieldName } };

  if (value > max) return { key: "monthlyPass.fieldMustNotExceed", params: { field: fieldName, max } };

  return undefined;
};
