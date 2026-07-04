export const MANAGED_STATUS = {
  DELETED: -1,
  DISABLED: 0,
  ENABLED: 1,
} as const;

export type ManagedStatus = (typeof MANAGED_STATUS)[keyof typeof MANAGED_STATUS];

export const HEARTBEAT_STATUS = {
  DOWN: 0,
  UP: 1,
} as const;

export type HeartbeatStatus = (typeof HEARTBEAT_STATUS)[keyof typeof HEARTBEAT_STATUS];
