export interface TimePeriodRule {
  name: string;
  enabled: boolean;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  multiplier: number;
}

export function computeMultiplierForTime(rules: TimePeriodRule[], now: Date): number {
  const jsDay = now.getDay();
  const currentDay = jsDay === 0 ? 7 : jsDay;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let product = 1.0;

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.dayOfWeek && rule.dayOfWeek.trim() !== "") {
      const days = rule.dayOfWeek.split(",").map((d) => parseInt(d.trim(), 10));
      if (!days.includes(currentDay)) continue;
    }

    const [startH, startM] = rule.startTime.split(":").map(Number);
    const [endH, endM] = rule.endTime.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    let isInRange = false;
    if (endMinutes >= startMinutes) isInRange = currentMinutes >= startMinutes && currentMinutes < endMinutes;
    else isInRange = currentMinutes >= startMinutes || currentMinutes < endMinutes;

    if (isInRange) product *= rule.multiplier;
  }

  return product;
}
