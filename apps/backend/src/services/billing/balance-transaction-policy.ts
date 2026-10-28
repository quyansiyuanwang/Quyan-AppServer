const retentionDays = 30;
export const BALANCE_TRANSACTION_POLICY = Object.freeze({
  retentionDays,
  retentionWindowMs: retentionDays * 24 * 60 * 60 * 1000,
});
