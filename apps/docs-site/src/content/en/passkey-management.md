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
- **Backed up** — whether the platform credential manager (iCloud Keychain, Google Password Manager, Windows Hello) has synced this passkey across your devices. A synced passkey still works if you lose the original device.
- **Created at** — when the passkey was registered.

### Actions

- **Register** — starts the browser's WebAuthn registration flow. Only shown if your browser/device supports passkeys (`window.PublicKeyCredential` must be available); otherwise a "not supported" indicator is shown instead.
- **Delete** — removes a passkey immediately. This does not require re-authentication beyond your current session.

## Common actions

1. Click **Register** from the list in Account Security; the authentication site opens.
2. Complete your device's biometric or PIN prompt, then name the new passkey when asked.
3. Back in Account Security, review the list periodically and delete passkeys tied to devices you no longer own.
4. If your browser reports "not supported", use password + 2FA sign-in instead, or switch to a browser with WebAuthn support.

## Notes

- Registering and deleting passkeys requires the `passkey:manage` permission, which every regular account holds by default (no admin approval needed for your own passkeys).
- If your account has 2FA enabled, signing in with a passkey may still prompt for a TOTP code depending on whether the current device is within the [trusted-device](/docs/trusted-device-management) window. High-risk operations always require a fresh check regardless of trusted-device status.
- Deleting the last passkey does not disable 2FA if TOTP or recovery codes are still configured — passkeys are one authentication method among several, not a replacement for 2FA.
- If registration is cancelled or fails (e.g. the browser prompt is dismissed), no partial credential is stored.

## Related pages

- `two-factor-authentication`
- `trusted-device-management`
- `account-settings`
