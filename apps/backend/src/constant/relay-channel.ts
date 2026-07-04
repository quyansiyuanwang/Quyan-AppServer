import { RELAY_CHANNEL_STATUS, type RelayChannelStatus } from "@appserver/shared";
export { RELAY_CHANNEL_STATUS };
export type { RelayChannelStatus };

export const VISIBLE_RELAY_CHANNEL_STATUSES: RelayChannelStatus[] = [
  RELAY_CHANNEL_STATUS.ENABLED,
  RELAY_CHANNEL_STATUS.DISABLED,
];
