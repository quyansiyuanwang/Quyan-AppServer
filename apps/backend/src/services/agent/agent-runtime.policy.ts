/** Transport limits for machine runtime connections; not user-configurable authorization rules. */
export const AGENT_RUNTIME_LIMITS = {
  // Accommodates escaped JSON output from the runtime's bounded command buffers.
  maxFrameBytes: 32 * 1024 * 1024,
  maxQueuedFrameBytes: 64 * 1024 * 1024,
  helloTimeoutMs: 10_000,
  requestTimeoutMs: 30_000,
  maxPendingRequests: 1024,
  maxQueuedFrames: 128,
  maxAgentIdLength: 120,
} as const;
