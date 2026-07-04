export { MANAGED_STATUS, HEARTBEAT_STATUS } from '@appserver/shared'
export type { ManagedStatus, HeartbeatStatus } from '@appserver/shared'

export const ACCOUNT_STATUS = {
  DELETED: -1,
  DISABLED: 0,
  ACTIVE: 1,
} as const

export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS]
