# Two-factor authentication & passkeys

Two-factor authentication (2FA) adds an extra layer of security to your account. After enabling 2FA, signing in requires both your password and a time-based one-time code. Passkeys provide passwordless authentication using biometrics or device PINs.

## 2FA overview

The system supports TOTP-based 2FA using authenticator apps (Google Authenticator, Authy, 1Password, etc.). Each code is valid for 30 seconds.

### Enabling 2FA

1. Go to Account Settings → Security → Two-factor authentication.
2. Click "Enable". A QR code and setup key will be shown.
3. Scan the QR code with your authenticator app.
4. Enter the 6-digit code from your app to confirm.
5. Save your recovery codes in a safe place.

### Recovery codes

When you enable 2FA, 10 recovery codes are generated. Each code can be used **once** to bypass 2FA if you lose access to your authenticator device.

- Store recovery codes offline (print or write them down).
- Do not store them on the same device as your authenticator app.
- You can regenerate recovery codes from the 2FA settings page (requires current 2FA verification).

### Disabling 2FA

Disabling 2FA requires either a valid TOTP code or a recovery code. The system will send a notification confirming the status change.

## Passkeys

Passkeys let you sign in without a password using your device's biometric sensor (fingerprint, face scan) or PIN. They are more secure than passwords and resistant to phishing.

### Passkey requirements

- **2FA required**: If you have 2FA enabled, signing in with a passkey may still require a TOTP code depending on your account's passkey policy.
- **Device support**: Passkeys require a compatible browser and device (most modern browsers on Windows, macOS, iOS, and Android).
- **Synced passkeys**: Passkeys can sync across devices via your platform's credential manager (iCloud Keychain, Google Password Manager).

### Managing passkeys

1. Go to Account Settings → Security → Passkeys.
2. View all registered passkeys with creation dates and last-used timestamps.
3. Add a new passkey by following the browser prompt.
4. Remove passkeys you no longer use.
5. Optionally toggle "require 2FA even for passkey login" for stricter security.

## Trusted devices

After a successful login with 2FA, you can mark the current browser as trusted. For the configured trust window (default 24 hours), 2FA challenges will be skipped on that device for regular operations.

### Trusted device behavior

| Operation type | Trusted device honored? |
|---------------|------------------------|
| Normal login | Yes |
| Standard step-up challenges (email change, profile edits) | Yes |
| High-risk operations (delete access keys, delete RAM users, detach policies) | **No** — always requires fresh 2FA |
| Disable 2FA | No — requires code or recovery code |

### Managing trusted devices

1. Go to Account Settings → Security → Trusted devices.
2. View the list of devices currently within the trust window.
3. Remove any device you do not recognize.
4. Clear all trusted devices if you suspect account compromise.

## Security notes

- 2FA codes are TOTP-based and time-synchronized. Ensure your device clock is accurate.
- Recovery codes are one-time use. When you use one, it is immediately removed.
- Changing your password does **not** disable 2FA.
- 2FA status changes dispatch notification events. Keep notification settings up to date.

## Permission requirements

| Action | Required permission |
|--------|-------------------|
| Manage own 2FA | None (all users) |
| Manage own passkeys | None (all users) |
| Manage trusted devices | None (all users) |

## Related pages

- `auth-verification`
- `notification-settings`
- `account-settings`
