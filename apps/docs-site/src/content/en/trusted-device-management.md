# Trusted device management

A trusted device is a browser/device the system remembers for a limited time window after you successfully complete two-factor verification. While within that window, regular operations on that device can skip repeated verification. This page views and manages those device records — it is the standalone management view for the same feature surfaced as an entry point on the Settings page.

## Page purpose

- View device records currently within the trust window.
- Remove a single device you no longer trust.
- Remove device records individually, checking each page if you suspect account compromise.

## What you will see

### Device list

A card per trusted device, showing:

- **Device label** — IP address if available, otherwise the browser User-Agent, otherwise a shortened device ID.
- **IP address** — the source IP recorded when the device was marked trusted.
- **Browser / User-Agent** — helps you recognize the device.
- **Trusted at** — when the device was first marked trusted.
- **Last used at** — the most recent time this device skipped verification using its trust.
- **Expires in** — the time remaining when the list was loaded (shown in up to two units: days, hours, minutes, or seconds). Refresh the list for an updated value.

### Actions

- **Refresh** — returns to the first page and reloads the trusted-device list. Navigate to another page again if needed.
- **Delete a device** — removes it after a confirmation prompt. If you delete the device you are currently using, the locally stored trust cookie is cleared as well.

The list reads at most 200 device records at a time, and pagination covers only those results. If there are more devices, checking every page may not show all of them; refresh and continue checking after deleting devices. The list can also be empty when device storage is unavailable, so an empty list does not prove there are no trusted devices. If you suspect account compromise, contact an administrator for help. If the list fails to load, the page may still show devices from the last successful load. Do not rely on that list for their current trust status. The page reloads automatically after a deletion; if the deletion succeeds but the list does not update, select **Refresh** and check whether the device is still listed.

## Common actions

1. Periodically review the list and remove devices you no longer own or use.
2. If you suspect account compromise, remove suspicious devices individually, check other pages, and change your password immediately. Whether a new trust record is created when you sign in again depends on the verification flow.
3. If a device's "last used at" timestamp looks wrong and you did not use it, remove it immediately and review your account security settings.

## Notes

- The trust window duration is a server-side setting (default 24 hours) — it is not something individual users can change.
- When 2FA is enabled, high-risk actions such as deleting access keys, deleting RAM users, and detaching policies require fresh verification even on a trusted device. Disabling 2FA also requires verification.
- Clearing trusted devices does not end your active login sessions — it only means the next verification-requiring action on that device can no longer skip the check.
- This feature relies on a browser cookie holding the device token. Clearing cookies or using a private/incognito window means the device will not be recognized as trusted, even if it was marked trusted before.

## Related pages

- [2FA & passkeys]({{DOCS_BASE_URL}}/en/two-factor-authentication)
- [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
