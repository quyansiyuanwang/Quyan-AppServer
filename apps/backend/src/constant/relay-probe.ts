/** Bound discovery and scheduling work before a batch creates any queue reservations. */
export const RELAY_PROBE_BATCH_POLICY = Object.freeze({ channels: 100, targets: 200 });

/** Applications require a fresh verified suggestion, and bounded operator-confirmed values. */
export const RELAY_PROBE_APPLY_POLICY = Object.freeze({
  suggestionMaxAgeMs: 24 * 60 * 60 * 1000,
  largeChangeRatio: 0.2,
  minimumMultiplier: 0.000001,
  maximumMultiplier: 1000,
});
