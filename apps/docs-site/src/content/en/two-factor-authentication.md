# Two-factor authentication & passkeys

Two-factor authentication (2FA) adds an extra layer of security to your account. After enabling 2FA, sign-in may require additional verification; trusted devices and passkey policy affect the requirement. Passkeys provide passwordless authentication using biometrics or device PINs.

## 2FA overview

The system supports TOTP-based 2FA using authenticator apps (Google Authenticator, Authy, 1Password, etc.). The code period defaults to 30 seconds and depends on the server configuration.

### Enabling 2FA

1. Open **Settings → Account Security** and find the two-factor authentication section.
2. Select the enable action to display a QR code and setup key.
3. Scan the QR code with your authenticator app, or enter the setup key manually in the app. Do not share the QR code or key.
4. Enter the 6-digit code from your app to confirm.
5. Before closing the recovery-code dialog, save the displayed codes somewhere safe. Use **Copy**, or record them manually if copying fails. After closing the dialog, follow the prompt about signing in again.

### Recovery codes

When you enable 2FA, a set of recovery codes is generated (10 by default, depending on server configuration). If you lose access to your authenticator device, a recovery code can complete second-factor verification. Each code can be used **once**.

- Store recovery codes offline (print or write them down).
- Do not store them on the same device as your authenticator app.
- The current settings page has no recovery-code regeneration action. An authorized API caller can use `POST /v1/users/me/2fa/recovery-codes/regenerate` with a valid authenticator or recovery code; the request must also satisfy replay protection. Regeneration replaces the previous codes, so securely save the new set immediately.

### Disabling 2FA

1. In the two-factor authentication section of **Settings → Account Security**, select the disable action.
2. Enter a valid TOTP code, or switch to recovery codes and enter an unused code. Email codes are not accepted for this action.
3. After submission succeeds, follow the prompt to sign in again.

Disabling 2FA invalidates the authenticator setup and recovery codes, clears trusted-device records, and revokes existing sign-in sessions. It also triggers a status-change notification; email or other delivery depends on notification settings and channel availability. To enable 2FA again, set up the authenticator again and save the new recovery codes.

## Passkeys

Passkeys let you sign in without a password using your device's biometric sensor (fingerprint, face scan) or PIN. They are more secure than passwords and resistant to phishing.

### Passkey requirements

- **2FA required**: If you have 2FA enabled, signing in with a passkey may still require a second verification depending on your account's passkey policy.
- **Device support**: Passkeys require a compatible browser and device (most modern browsers on Windows, macOS, iOS, and Android).
- **Synced passkeys**: Passkeys can sync across devices via your platform's credential manager (iCloud Keychain, Google Password Manager).

### Managing passkeys

1. Open passkey management in **Settings → Account Security** to review existing credentials.
2. Select **Register** to open the authentication site and follow its registration prompts. You return to Account Security when finished.
3. Delete passkeys you no longer use. Before deleting, confirm that another sign-in method is available.
4. With 2FA enabled, use the two-factor authentication section to change whether passkey sign-in also requires 2FA. After saving, follow the prompt to sign in again.

This switch only changes second-factor policy for passkey sign-in. It does not register or delete passkeys or disable account 2FA. Even with the switch enabled, devices within the trust window may skip regular sign-in verification; high-risk actions retain their own verification requirements.

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
