export { MANAGED_STATUS, HEARTBEAT_STATUS } from '@appserver/shared';
export type { ManagedStatus, HeartbeatStatus } from '@appserver/shared';

export const RECORD_STATUS = {
  DELETED: 0,
  ACTIVE: 1,
} as const;

export type RecordStatus = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

export const BALANCE_ACCOUNT_STATUS = {
  UNINITIALIZED: 0,
  ACTIVE: 1,
} as const;

export type BalanceAccountStatus = (typeof BALANCE_ACCOUNT_STATUS)[keyof typeof BALANCE_ACCOUNT_STATUS];
