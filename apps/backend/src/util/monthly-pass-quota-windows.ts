import {
  MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
  MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS,
  MONTHLY_PASS_DECIMAL_SCALE,
} from "@/constant/monthly-pass";
import { getMonthlyPassQuotaWindowHoursValidationError } from "./monthly-pass-validation.util";
import { BadRequestError } from "./errors";
import type {
  MonthlyPassQuotaUnit,
  MonthlyPassQuotaWindowInput,
  UserMonthlyPassWithTemplate,
} from "@/store/billing/monthly-pass.store";
export const normalizeMonthlyPassQuotaUnit = (value?: string | null): MonthlyPassQuotaUnit => {
  if (value === "request" || value === "token") return value;
  return "amount";
};

export const normalizeMonthlyPassQuotaWindowHours = (value?: number | null, enforceMax = false): number | null => {
  if (value == null) return null;
  const error = getMonthlyPassQuotaWindowHoursValidationError(value, { allowExceedMax: !enforceMax });
  if (error) {
    if (enforceMax)
      throw new BadRequestError("monthly pass validation failed", undefined, {
        messageKey: error.key,
        messageParams: error.params,
      });
    return null;
  }

  if (value > MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS) {
    // Clamp legacy overflow values so existing records remain usable while new input is validated.
    return MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS;
  }
  return value;
};

export function getUserMonthlyPassQuotaWindows(
  record: Pick<UserMonthlyPassWithTemplate, "dailyQuota" | "quotaUnit" | "quotaWindowHours" | "quotaWindows">,
): MonthlyPassQuotaWindowInput[] {
  if (Array.isArray(record.quotaWindows) && record.quotaWindows.length > 0)
    return record.quotaWindows.map((item) => ({
      quotaLimit: Number(item.quotaLimit),
      quotaUnit: normalizeMonthlyPassQuotaUnit(item.quotaUnit),
      quotaWindowHours: Number(item.quotaWindowHours),
    }));
  if (record.dailyQuota == null) return [];
  const quotaUnit = normalizeMonthlyPassQuotaUnit(record.quotaUnit),
    value = Number(record.dailyQuota),
    scale = 10 ** MONTHLY_PASS_DECIMAL_SCALE;
  return [
    {
      quotaLimit:
        quotaUnit === "request" || quotaUnit === "token" ? Math.floor(value) : Math.round(value * scale) / scale,
      quotaUnit,
      quotaWindowHours:
        normalizeMonthlyPassQuotaWindowHours(
          record.quotaWindowHours ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
          true,
        ) ?? MONTHLY_PASS_DEFAULT_QUOTA_WINDOW_HOURS,
    },
  ];
}
