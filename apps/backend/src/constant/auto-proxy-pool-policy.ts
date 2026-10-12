export const AUTO_PROXY_POOL_CONFIG_POLICY = Object.freeze({
  cacheHitRateMinSamples: { default: 10, min: 1, max: 1000 },
  cacheHitRateWindowHours: { default: 168, min: 1, max: 24 * 365 },
});
