/** Internal limits shared by the scheduler, recovery and delivery workers. */
export const RELAY_PROBE_ROUND_POLICY = Object.freeze({
  timezone: "Asia/Shanghai",
  defaultMinuteOfDay: 180,
  utcOffsetMs: 8 * 60 * 60 * 1000,
  dayMs: 24 * 60 * 60 * 1000,
  tickMs: 15_000,
  leaseMs: 120_000,
  roundTimeoutMs: 12 * 60 * 60 * 1000,
  batchSize: 50,
  deliveryRetryMs: 60_000,
  maxDeliveryAttempts: 8,
});

export function probeDailyOccurrence(now: Date, minuteOfDay: number): Date {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440)
    throw new RangeError("Invalid minute of day");
  const { utcOffsetMs, dayMs } = RELAY_PROBE_ROUND_POLICY;
  return new Date(Math.floor((now.getTime() + utcOffsetMs) / dayMs) * dayMs - utcOffsetMs + minuteOfDay * 60_000);
}

export function nextProbeDailyOccurrence(now: Date, minuteOfDay: number): Date {
  const today = probeDailyOccurrence(now, minuteOfDay);
  return today.getTime() > now.getTime() ? today : new Date(today.getTime() + RELAY_PROBE_ROUND_POLICY.dayMs);
}

/** A restart may recover today's occurrence; older missed days are deliberately not replayed. */
export function dueProbeDailyOccurrence(now: Date, minuteOfDay: number): Date | undefined {
  const today = probeDailyOccurrence(now, minuteOfDay);
  return today.getTime() <= now.getTime() ? today : undefined;
}
