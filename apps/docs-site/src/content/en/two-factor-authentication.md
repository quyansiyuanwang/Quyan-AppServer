# Two-factor authentication & passkeys

Two-factor authentication (2FA) adds an extra layer of security to your account. After enabling 2FA, sign-in may require additional verification; trusted devices and passkey policy affect the requirement. Passkeys provide passwordless authentication using biometrics or device PINs.

## 2FA overview

The system supports TOTP-based 2FA using authenticator apps (Google Authenticator, Authy, 1Password, etc.). The code period defaults to 30 seconds and depends on the server configuration.

### Enabling 2FA

1. Go to Account Settings → Security → Two-factor authentication.
2. Click "Enable". A QR code and setup key will be shown.
3. Scan the QR code with your authenticator app.
4. Enter the 6-digit code from your app to confirm.
5. Save your recovery codes in a safe place.

### Recovery codes

When you enable 2FA, a set of recovery codes is generated (10 by default, depending on server configuration). Each code can be used **once** to bypass 2FA if you lose access to your authenticator device.

- Store recovery codes offline (print or write them down).
- Do not store them on the same device as your authenticator app.
- The current settings page has no recovery-code regeneration action. An authorized API caller can use `POST /v1/users/me/2fa/recovery-codes/regenerate` with a valid authenticator or recovery code; the request must also satisfy replay protection. Regeneration replaces the previous codes, so securely save the new set immediately.

### Disabling 2FA

Disabling 2FA requires either a valid TOTP code or a recovery code. The system will send a notification confirming the status change.

## Passkeys

Passkeys let you sign in without a password using your device's biometric sensor (fingerprint, face scan) or PIN. They are more secure than passwords and resistant to phishing.

### Passkey requirements

- **2FA required**: If you have 2FA enabled, signing in with a passkey may still require a second verification depending on your account's passkey policy.
- **Device support**: Passkeys require a compatible browser and device (most modern browsers on Windows, macOS, iOS, and Android).
- **Synced passkeys**: Passkeys can sync across devices via your platform's credential manager (iCloud Keychain, Google Password Manager).

### Managing passkeys

1. Go to Account Settings → Security → Passkeys.
2. View registered passkeys and their creation dates.
3. Add a new passkey by following the browser prompt.
4. Remove passkeys you no longer use.
5. Optionally toggle "require 2FA even for passkey login" for stricter security.

See [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management) for the full field reference and notes on backed-up passkeys.

## Trusted devices

After a successful 2FA login, the system can record the current browser as trusted. For the configured trust window (default 24 hours), 2FA challenges will be skipped on that device for regular operations.

### Trusted device behavior

| Operation type                                                               | Trusted device honored?                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Normal login                                                                 | Yes                                                      |
| Standard step-up challenges (such as email changes)                          | Yes                                                      |
| High-risk operations (delete access keys, delete RAM users, detach policies) | **No** — requires fresh verification when 2FA is enabled |
| Disable 2FA                                                                  | No — requires code or recovery code                      |

### Managing trusted devices

1. Go to Account Settings → Security → Trusted devices.
2. View the list of devices currently within the trust window.
3. Remove any device you do not recognize.
4. If you suspect account compromise, check all pages and remove suspicious devices individually.

See [Trusted devices]({{DOCS_BASE_URL}}/en/trusted-device-management) for the device list and how the trust window interacts with high-risk operations.

## Security notes

- 2FA codes are TOTP-based and time-synchronized. Ensure your device clock is accurate.
- Recovery codes are one-time use. When you use one, it is immediately removed.
- Changing your password does **not** disable 2FA.
- 2FA status changes dispatch notification events. Keep notification settings up to date.

## Permission requirements

You must sign in to manage account security settings. Actions are also subject to your account’s permission policies. If an action is denied, contact your account administrator to check your authorization.

## Related pages

- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
- [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management)
- [Trusted devices]({{DOCS_BASE_URL}}/en/trusted-device-management)
- [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
