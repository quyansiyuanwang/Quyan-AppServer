import { HttpStatusCode } from 'axios'

/** Internal loading policy. Domain/routes/API contracts are not duplicated here. */
export const SESSION_RECOVERY_POLICY = {
  totalTimeoutMs: 15_000,
  attemptTimeoutMs: 5_000,
  retryDelaysMs: [300, 900],
  jitterRatio: 0.2,
  transientStatuses: [
    HttpStatusCode.BadGateway,
    HttpStatusCode.ServiceUnavailable,
    HttpStatusCode.GatewayTimeout,
  ],
} as const

export const ROUTE_PREFETCH_POLICY = {
  concurrency: 2,
  maxPendingTargets: 16,
  maxIdleTargets: 4,
  maxRecentTargets: 8,
  maxConnectedOrigins: 2,
  hoverDelayMs: 150,
  idleDelayMs: 1_500,
  restrictedConnections: ['slow-2g', '2g', '3g'],
} as const

export const UPDATE_CHECK_POLICY = {
  intervalMs: 60_000,
  maxIntervalMs: 600_000,
  requestTimeoutMs: 10_000,
  backoffMultiplier: 2,
  requiredConfirmations: 2,
} as const

export const BACKGROUND_START_POLICY = {
  progress: { delayMs: 800, idleTimeoutMs: 4_000 },
  updateCheck: { delayMs: 4_000, idleTimeoutMs: 8_000 },
  analytics: { delayMs: 1_200, idleTimeoutMs: 5_000 },
} as const
