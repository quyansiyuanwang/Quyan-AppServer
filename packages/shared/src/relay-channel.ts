export const RELAY_CHANNEL_STATUS = {
  DELETED: 0,
  ENABLED: 1,
  DISABLED: 2,
} as const;

export type RelayChannelStatus = (typeof RELAY_CHANNEL_STATUS)[keyof typeof RELAY_CHANNEL_STATUS];
