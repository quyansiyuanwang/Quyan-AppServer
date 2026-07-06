# Trusted device management

A trusted device is a browser/device the system remembers for a limited time window after you successfully complete 2FA or a verification challenge. While within that window, regular operations on that device can skip repeated verification. This page views and manages those device records — it is the standalone management view for the same feature surfaced as an entry point on the Settings page.

## Page purpose

- View the list of devices currently within the trust window.
- Remove a single device you no longer trust.
- Clear all trusted devices at once (useful if you suspect account compromise).

## What you will see

### Device list

A card per trusted device, showing:

- **Device label** — IP address if available, otherwise the browser User-Agent, otherwise the first 12 characters of the device ID.
- **IP address** — the source IP recorded when the device was marked trusted.
- **Browser / User-Agent** — helps you recognize the device.
- **Trusted at** — when the device was first marked trusted.
- **Last used at** — the most recent time this device skipped verification using its trust.
- **Expires in** — a live countdown until the trust window for this device ends (shown in the top one or two units: days/hours/minutes/seconds).

### Actions

- **Refresh** — reloads the current list of trusted devices (paginated).
- **Delete a device** — removes it after a confirmation prompt. If you delete the device you are currently using, the locally stored trust cookie is cleared as well.

## Common actions

1. Periodically review the list and remove devices you no longer own or use.
2. If you suspect account compromise, remove every listed device, then change your password and sign in again to establish a fresh trust record.
3. If a device's "last used at" timestamp looks wrong and you did not use it, remove it immediately and review your account security settings.

## Notes

- The trust window duration is a server-wide setting configured by admins on the server-configuration page (default 24 hours) — it is not something individual users can change.
- Trusted status does **not** exempt every action: deleting access keys, deleting RAM users, detaching policies, and disabling 2FA always require a fresh verification, even on a device that is currently within its trust window.
- Clearing trusted devices does not end your active login sessions — it only means the next verification-requiring action on that device can no longer skip the check.
- This feature relies on a browser cookie holding the device token. Clearing cookies or using a private/incognito window means the device will not be recognized as trusted, even if it was marked trusted before.

## Related pages

- `two-factor-authentication`
- `passkey-management`
- `auth-verification`
- `account-settings`
