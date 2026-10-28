import { Permission } from './permission'

/** Seeded registration group baseline. Configured registration groups are not implicit IAM exceptions. */
export const DEFAULT_USER_GROUP_USERNAME = 'user'
export const DEFAULT_USER_GROUP_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.RELAY_CHANNEL_SUBMIT,
  Permission.RELAY_CHANNEL_PROVIDER_READ,
  Permission.RELAY_CHANNEL_PROVIDER_SETTLE,
])
