const defaultWindowDays = 30,
  maximumWindowDays = 90;
export const SUPPORT_ANALYTICS_POLICY = Object.freeze({
  defaultWindowDays,
  maximumWindowDays,
  defaultWindowMs: defaultWindowDays * 86400000,
  maximumWindowMs: maximumWindowDays * 86400000,
  defaultPageSize: 20,
  maximumPageSize: 100,
});
