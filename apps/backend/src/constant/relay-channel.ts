export const RELAY_CHANNEL_STATUS = {
  DELETED: 0,
  ENABLED: 1,
  DISABLED: 2,
} as const;

export type RelayChannelStatus = (typeof RELAY_CHANNEL_STATUS)[keyof typeof RELAY_CHANNEL_STATUS];

export const VISIBLE_RELAY_CHANNEL_STATUSES: RelayChannelStatus[] = [
  RELAY_CHANNEL_STATUS.ENABLED,
  RELAY_CHANNEL_STATUS.DISABLED,
];
