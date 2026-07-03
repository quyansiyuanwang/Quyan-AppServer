export const RECORD_STATUS = {
  DELETED: 0,
  ACTIVE: 1,
} as const;

export type RecordStatus = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

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

export const BALANCE_ACCOUNT_STATUS = {
  UNINITIALIZED: 0,
  ACTIVE: 1,
} as const;

export type BalanceAccountStatus = (typeof BALANCE_ACCOUNT_STATUS)[keyof typeof BALANCE_ACCOUNT_STATUS];
