/** Queue identities and leases are shared by scheduling, workers and reset; never derive keys at call sites. */
export const RELAY_PROBE_QUEUE_POLICY = Object.freeze({
  slotPrefix: "relay:channel-probe-run:v1",
  slotTtlMs: 2 * 60 * 60 * 1000,
});
export function relayProbeQueueSlotKey(channelId: string, memberChannelId?: string): string {
  return `${RELAY_PROBE_QUEUE_POLICY.slotPrefix}:${channelId}:${memberChannelId || "channel"}`;
}
