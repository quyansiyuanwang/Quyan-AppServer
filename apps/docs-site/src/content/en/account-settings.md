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

## Personal profile permissions and resource scope

With IAM enforcement enabled, reading the current profile uses `quyan:user:GetCurrentUser` on `acs:quyan:*:<accountId>:user/<userId>`. Authenticated identities have a default grant only for their own profile; a matching explicit Deny still blocks it. This capability does not permit querying other users or administering accounts.

Changing the display name requires the separate `quyan:user:UpdateProfile` permission. Reading a profile does not automatically grant editing. A policy can target the current user:

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Allow",
    "Action": "quyan:user:UpdateProfile",
    "Resource": "acs:quyan:*:<accountId>:user/<userId>"
  }
}
```

Replace the placeholders with the actual account and current user IDs. Display-name updates cannot change email, password, account status, or group membership. Even wildcard grants do not permit editing other users through the personal profile endpoint.

If a profile changes during a request, reading or editing it may return a conflict. Refresh and confirm the edit again; concurrent changes are not automatically overwritten. An invalid account or role session blocks the operation. Third-party OAuth applications additionally need the `profile` scope (including its historical permission alias); the scope does not replace IAM editing permission.

## Email permissions and resource scope

With IAM enforcement enabled, sending the change code requires `quyan:user:SendEmailChangeCode`; applying the verified change requires `quyan:user:ChangeEmail`. Both target `acs:quyan:*:<accountId>:user/<userId>` for the current user. These are independent actions: a grant to send a code does not grant permission to change the email. Display-name editing and reading a profile do not grant either email action.

Policies can grant the two actions on the current user's ARN. A matching explicit Deny overrides Allow. Even wildcard grants cannot use these personal endpoints to change another user's email. Existing verification, two-factor, CAPTCHA, replay protection, email uniqueness and once-per-day limits still apply. Third-party OAuth applications also need the `email` scope; `profile` scope alone is insufficient.

Authorization and user state are checked again before sending a code or committing an email change. If an account, grant, role session or OAuth authority changes during the operation, the request can be denied or return a conflict. Refresh the session and confirm the operation again. `legacy` and `shadow` retain the previous effective email permission; `shadow` also records IAM decisions.

## Related pages

- `access-key-management`
- `passkey-management`
- `trusted-device-management`
- `notification-settings`
- `auth-verification`
