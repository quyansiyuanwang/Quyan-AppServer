/** Internal bounds for read-only capability snapshots, not request-routing quotas. */
export const RELAY_CAPABILITY_RESOLUTION_LIMITS = Object.freeze({
  channelNodes: 5000,
  traversalVisits: 5000,
  poolDepth: 64,
});
