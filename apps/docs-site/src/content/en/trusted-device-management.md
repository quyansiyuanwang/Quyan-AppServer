# Trusted device management

A trusted device is a browser/device the system remembers for a limited time window after you successfully complete two-factor verification. Within that window, regular operations on the device can skip repeated verification. Open trusted-device management in the two-factor authentication section of **Settings → Account Security** to review or delete these records.

## Prerequisites

- Sign in to your account. The management entry appears in Account Security when 2FA is enabled.
- Viewing and deleting devices are subject to separate account authorization policies. View access does not guarantee delete access. If denied, ask an administrator to check authorization.

## Review device records

A card per trusted device, showing:

- **Device label** — IP address if available, otherwise the browser User-Agent, otherwise a shortened device ID.
- **IP address** — the source IP recorded when the device was marked trusted.
- **Browser / User-Agent** — helps you recognize the device.
- **Trusted at** — when trust was established for the device.
- **Last used at** — the most recent successful check of this device's trust record. High-risk actions can still require 2FA after a trust match; this timestamp does not mean the action succeeded.
- **Expires in** — the time remaining when the list was loaded (shown in up to two units: days, hours, minutes, or seconds). Refresh the list for an updated value.

The top **Refresh** button returns to the first page and fetches current data. Navigate to other pages again as needed. The list reads at most 200 records at a time, and pagination covers only those results; checking every page may not show all devices.

## Delete a device you no longer trust

1. Check the device label, IP, browser information, and timestamps to identify an unused or unrecognized device.
2. Select **Delete** for that record, check the confirmation prompt, and confirm.
3. Wait for the list to reload and check that the record was removed. Deleting the current browser also clears its trust cookie.

Deletion removes the ability to skip repeated verification; it does not end existing sign-in sessions on that device. If you suspect account compromise, check all pages, delete suspicious records individually, change your password immediately, and contact an administrator for further investigation. Refresh and continue checking after deletion. Whether later verification creates a new trust record depends on the verification flow.

## Troubleshooting

| Symptom                                        | Action                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The list is empty                              | Records may have expired, or device storage may be unavailable. An empty list does not guarantee that the account has no trusted devices.                              |
| Loading failed but devices remain visible      | The page may retain the last successful result. Retry the current page with the refresh button beside the error, or use the top refresh button to retry from page one. |
| Deletion succeeded but the list did not update | Reloading the list may have failed. Use the top refresh button and check the result before retrying deletion.                                                          |
| The device is still signed in after deletion   | This is expected: the next action requiring verification cannot skip it using the old trust record. Revoking trust does not sign the device out.                       |
| The last-used time is unexpected               | Check the device, browser, and IP together. If you cannot recognize the activity, delete the record and review account security.                                       |

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
