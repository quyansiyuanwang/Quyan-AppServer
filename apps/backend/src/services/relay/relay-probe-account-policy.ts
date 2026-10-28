export const RELAY_PROBE_ACCOUNT_POLICY = Object.freeze({
  cachePrefix: "relay:probe-account:v1",
  loginLockTtlMs: 35_000,
  tokenSafetyMs: 30_000,
  refreshLockWaitMs: 5 * 60_000,
  cacheMaxTtlSeconds: 86_400,
});
