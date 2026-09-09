/**
 * Cache statistics are stored in RelayUsage, so this is a sampling window rather
 * than a Redis retention period. Keep it long enough to smooth short-lived provider
 * behavior while limiting the aggregation query to a bounded range.
 */
export const RELAY_CACHE_HIT_RATE_LOOKBACK_HOURS = 24 * 7;
export const RELAY_CACHE_HIT_RATE_MIN_WINDOW_HOURS = 1;
export const RELAY_CACHE_HIT_RATE_MAX_WINDOW_HOURS = 24 * 365;

export const getRelayCacheHitRateSince = (
  windowHours = RELAY_CACHE_HIT_RATE_LOOKBACK_HOURS,
  now = new Date(),
): Date => {
  const normalizedHours = Math.min(
    RELAY_CACHE_HIT_RATE_MAX_WINDOW_HOURS,
    Math.max(RELAY_CACHE_HIT_RATE_MIN_WINDOW_HOURS, Number(windowHours) || RELAY_CACHE_HIT_RATE_LOOKBACK_HOURS),
  );
  return new Date(now.getTime() - normalizedHours * 60 * 60 * 1000);
};
