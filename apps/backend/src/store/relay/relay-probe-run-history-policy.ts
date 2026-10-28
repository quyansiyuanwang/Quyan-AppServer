const failed = Object.freeze(["failed", "timed_out", "cancelled"] as const);
/** Both authorization modes preserve queued and running probe tasks. */
export const relayProbeHistoryTerminalStatuses = Object.freeze({
  failed,
  all: Object.freeze(["succeeded", ...failed] as const),
});
