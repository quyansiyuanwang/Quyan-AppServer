import type { TimePeriodMultiplierRule } from "@/api/dto/relay/relay-channel.dto";
import { ChinaHolidayCalendarService, getChinaCalendarDate } from "./china-holiday-calendar.service";

export type TimePeriodRule = TimePeriodMultiplierRule;
export type HolidayLookup = (date: string) => boolean | undefined;

export function computeMultiplierForTime(
  rules: TimePeriodRule[],
  now: Date,
  isHoliday: HolidayLookup = (date) => ChinaHolidayCalendarService.getInstance().isHoliday(date),
): number {
  const jsDay = now.getDay();
  const currentDay = jsDay === 0 ? 7 : jsDay;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let product = 1.0;
  let chinaCalendarDate: ReturnType<typeof getChinaCalendarDate> | undefined;

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const holidayMode = rule.holidayMode ?? "ignore";
    const chinaDate = holidayMode !== "ignore" ? (chinaCalendarDate ??= getChinaCalendarDate(now)) : undefined;
    if (chinaDate) {
      const holiday = isHoliday(chinaDate.date);
      // Unknown is not a regular weekday: skip either holiday-dependent rule.
      if (holiday === undefined || (holidayMode === "only" ? !holiday : holiday)) continue;
    }
    const ruleDay = chinaDate?.dayOfWeek ?? currentDay;
    const ruleMinutes = chinaDate?.minutes ?? currentMinutes;
    if (holidayMode !== "only" && rule.dayOfWeek && rule.dayOfWeek.trim() !== "") {
      const days = rule.dayOfWeek.split(",").map((d) => parseInt(d.trim(), 10));
      if (!days.includes(ruleDay)) continue;
    }

    if (rule.allDay) {
      product *= rule.multiplier;
      continue;
    }

    const [startH, startM] = rule.startTime.split(":").map(Number);
    const [endH, endM] = rule.endTime.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    let isInRange = false;
    if (endMinutes >= startMinutes) isInRange = ruleMinutes >= startMinutes && ruleMinutes < endMinutes;
    else isInRange = ruleMinutes >= startMinutes || ruleMinutes < endMinutes;

    if (isInRange) product *= rule.multiplier;
  }

  return product;
}
