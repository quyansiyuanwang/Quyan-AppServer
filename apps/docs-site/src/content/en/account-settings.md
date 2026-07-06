# Settings

**Settings** is a top-level nav item containing four sub-pages. Click the arrow next to Settings in the sidebar to expand the sub-menu, then navigate to the page you need.

## Sub-pages

### Profile

Path: **Settings → Profile**

Manage your display name, email address, and username.

- Edit display name.
- Change email with a verification code sent to the new address.
- View your current username (read-only).

### Preferences

Path: **Settings → Preferences**

Adjust appearance and clear locally cached data.

- Toggle light or dark theme.
- Switch display language.
- Clear LocalStorage, SessionDB, or all cached data.

### Account Security

Path: **Settings → Account Security**

Manage credentials and authentication methods.

- Change password (requires `user:change_self_password` permission).
- Create, copy, and remove access keys.
- Register and remove passkeys for passwordless sign-in.
- Enable or disable two-factor authentication (TOTP).
- Manage trusted devices that bypass repeated 2FA prompts.

### Event Center

Path: **Settings → Event Center**

Configure notification preferences, email delivery, and webhooks. See `notification-settings` for full details.

## Notes

- Email and password changes may require a verification step or an active 2FA challenge.
- Clearing cached data can reset temporary UI state such as theme and language preferences, and may sign you out.
- Access keys, passkeys, and trusted devices open in drawers within the Account Security page. See `access-key-management`, `passkey-management`, and `trusted-device-management` for details.

## Related pages

- `access-key-management`
- `passkey-management`
- `trusted-device-management`
- `notification-settings`
- `auth-verification`
