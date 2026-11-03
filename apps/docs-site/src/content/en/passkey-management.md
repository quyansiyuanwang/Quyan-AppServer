# Passkey management

Passkeys let you sign in without typing a password, using your device's biometric sensor (fingerprint, face scan) or PIN. Account Security lets you review and delete existing passkeys. Adding one securely opens the authentication site for the browser ceremony, then returns to Account Security.

## Prerequisites

- Sign in with permission to perform the relevant view, registration, or deletion action.
- To register, use a browser, device, or credential manager that supports passkeys and complete the browser verification prompt.
- Open passkey management in **Settings → Account Security**. The list includes only credentials your current identity is authorized to view.

## Review existing passkeys

A table (or card list on mobile) of registered passkeys, each showing:

- **Name** — a label you choose when registering (falls back to "unnamed" if skipped).
- **Device type** — the credential type reported by the authenticator, rather than a specific device model.
- **Backed up** — the backup state reported by the authenticator. Availability on other devices depends on the credential manager’s backup and sync settings.
- **Created at** — when the passkey was registered.

## Register a passkey

1. Click **Register** from the list in Account Security; the authentication site opens.
2. Select **Register** again on the authentication site. Optionally enter a recognizable name, confirm, and follow the browser prompt to verify on your device.
3. After successful registration, you return to Account Security. Open the list again to check the result, using **Refresh** if needed.

## Delete a passkey

1. Check the name, creation time, and backup state to identify the credential. Confirm that another sign-in method is available.
2. Select **Delete** for that credential and confirm. Wait for the success message and list refresh.

After deletion, the credential can no longer sign in. Deletion only removes the platform record; it does not automatically remove credentials saved on your device or in a password manager. Delete any local or synced copies separately from the relevant device or password manager.

## Notes

- Viewing, registration, and deletion are authorized separately. Legacy permission mode uses `passkey:manage`; with IAM enforcement, policies for the relevant action and credential apply. Being able to open the list does not guarantee permission to register or delete. If denied, contact your account administrator to check authorization.
- If your account has 2FA enabled, signing in with a passkey may still require a second verification depending on the account’s passkey verification policy and whether the current device is within the [trusted-device]({{DOCS_BASE_URL}}/en/trusted-device-management) window. When 2FA is enabled, some high-risk actions still require fresh verification.
- Deleting the last passkey does not disable 2FA if TOTP or recovery codes are still configured — passkeys are one authentication method among several, not a replacement for 2FA.

## Troubleshooting

| Symptom                                                            | Action                                                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The authentication site reports an unsupported browser             | Use a browser or device that supports passkeys, or another sign-in method already available for your account.                                                                           |
| Registration was cancelled or the challenge expired                | Refresh the list first. If registration did not succeed, select Register to start a new flow.                                                                                           |
| Registration succeeded but the credential is missing from the list | Refresh, then check read permission. With IAM enforcement, the new credential may be outside your identity's readable scope. Do not repeatedly register just because the list is empty. |
| A deleted passkey still appears in the password manager            | Delete platform and password-manager records separately. Once the platform record is deleted, the remaining local credential cannot sign in.                                            |

## Related pages

- [2FA & passkeys]({{DOCS_BASE_URL}}/en/two-factor-authentication)
- [Trusted devices]({{DOCS_BASE_URL}}/en/trusted-device-management)
- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
