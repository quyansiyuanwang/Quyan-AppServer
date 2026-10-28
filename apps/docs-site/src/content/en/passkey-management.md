# Passkey management

Passkeys let you sign in without typing a password, using your device's biometric sensor (fingerprint, face scan) or PIN. Account Security lets you review and delete existing passkeys. Adding one securely opens the authentication site for the browser ceremony, then returns to Account Security.

## Page purpose

- Register a new passkey for this device or browser on the authentication site.
- View all passkeys registered to your account.
- Remove passkeys you no longer use or do not recognize.

## What you will see

### Passkey list

A table (or card list on mobile) of registered passkeys, each showing:

- **Name** — a label you choose when registering (falls back to "unnamed" if skipped).
- **Device type** — reported by the browser/platform (e.g. platform authenticator, security key).
- **Backed up** — the backup state reported by the authenticator. Availability on other devices depends on the credential manager’s backup and sync settings.
- **Created at** — when the passkey was registered.

### Actions

- **Register** — opens the authentication site from Account Security. The authentication site shows a message if the device or browser does not support passkeys.
- **Delete** — removes a passkey after confirmation.

## Common actions

1. Click **Register** from the list in Account Security; the authentication site opens.
2. Optionally enter a name, confirm, and follow the browser prompt to verify on your device.
3. Back in Account Security, review the list periodically and delete passkeys tied to devices you no longer own.
4. If your browser reports "not supported", use password + 2FA sign-in instead, or switch to a browser with WebAuthn support.

## Notes

- Viewing, registering, and deleting passkeys requires sign-in and is subject to account permission policies. Registration and deletion also require `passkey:manage`. If an action is denied, contact your account administrator to check your authorization.
- If your account has 2FA enabled, signing in with a passkey may still require a second verification depending on the account’s passkey verification policy and whether the current device is within the [trusted-device]({{DOCS_BASE_URL}}/en/trusted-device-management) window. When 2FA is enabled, some high-risk actions still require fresh verification.
- Deleting the last passkey does not disable 2FA if TOTP or recovery codes are still configured — passkeys are one authentication method among several, not a replacement for 2FA.
- If registration is cancelled or fails, check the list. If no new record appears, try registering again.

## Related pages

- [2FA & passkeys]({{DOCS_BASE_URL}}/en/two-factor-authentication)
- [Trusted devices]({{DOCS_BASE_URL}}/en/trusted-device-management)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
