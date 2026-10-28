import { Permission } from "@quyan/shared";
import { RELAY_CHANNEL_STATUS, type RelayChannelStatus } from "@quyan/shared";
export { RELAY_CHANNEL_STATUS };
export type { RelayChannelStatus };

export const VISIBLE_RELAY_CHANNEL_STATUSES: RelayChannelStatus[] = [
  RELAY_CHANNEL_STATUS.ENABLED,
  RELAY_CHANNEL_STATUS.DISABLED,
];

/** Deployment-managed eligibility for the existing channel-visibility bypass, not a policy grant. */
export const RELAY_CHANNEL_VISIBILITY_MANAGEMENT_PERMISSIONS = Object.freeze([
  Permission.RELAY_CHANNEL_CREATE,
  Permission.RELAY_CHANNEL_UPDATE,
  Permission.RELAY_CHANNEL_DELETE,
  Permission.RELAY_CHANNEL_REVIEW,
]);
