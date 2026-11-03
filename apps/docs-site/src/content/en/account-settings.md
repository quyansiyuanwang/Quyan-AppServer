# Settings

**Settings** is a top-level nav item containing four sub-pages. Click the arrow next to Settings in the sidebar to expand the sub-menu, then navigate to the page you need.

## Sub-pages

### Profile

Path: **Settings → Profile**

View your username and update your display name and email separately.

- Edit display name.
- Change email with a verification code sent to the new address.
- View your current username (read-only).

#### Change your display name

1. Enter a new display name of up to 50 characters.
2. Select **Save** beside the name and wait for confirmation. Changing the name does not change your sign-in username.

Saving an empty name field does not delete the existing display name. Email changes use the separate flow below; saving the name does not save the email.

#### Change your email

1. Enter a new address you can access and select **Send code**. Complete any requested captcha or 2FA check.
2. Find the six-digit code in the new mailbox, enter it, and select **Change email**.
3. Wait for confirmation and check the current email displayed on the page. Sending a code alone does not change the email.

The new address must differ from the current address and must not belong to another non-deleted account. After a successful change, you cannot change it again within the next 24 hours; crossing midnight does not reset the limit. The send button has a 60-second cooldown after success. Code expiry depends on current service configuration.

### Preferences

Path: **Settings → Preferences**

Adjust appearance and clear locally cached data.

- Toggle light or dark theme.
- Switch display language.
- Select individual LocalStorage and SessionDB items to clear from the browser.

#### Clear local cache

1. In Preferences, choose **Clear Cache** to see the items available for clearing and their sizes.
2. Select the items or groups you want to clear, then choose **Clear selected**. At least one item must be selected.
3. Clearing sign-in data such as authentication tokens shows a sign-in warning and reloads the page. Clearing certain other items, including theme, language, or cached user information, also reloads the page. Save unsubmitted work first.

This clears only the selected local data in the current browser; it does not delete account data on the server. Browser data not listed in the dialog is outside its scope. Items are cleared individually. If an error occurs, items already cleared are not restored automatically. Reopen the dialog to check what remains before retrying; if sign-in data was cleared, you may need to sign in again.

### Account Security

Path: **Settings → Account Security**

Manage credentials and authentication methods.

- Change password (requires `user:change_self_password` permission).
- Create, copy, and remove access keys.
- Register and remove passkeys for passwordless sign-in.
- Enable or disable two-factor authentication (TOTP).
- Manage trusted devices that bypass repeated 2FA prompts.
- Bind or unbind external accounts enabled for the deployment.

#### Change your password

1. Enter the new password and matching confirmation.
2. Select **Change password**. If 2FA is required, complete verification and wait for the original request to resume.
3. After a successful change, the page signs you out. Sign in again with the new password. Changing the password does not disable existing 2FA.

#### Bind or unbind an external account

1. Select an available GitHub or WeChat binding entry in the external accounts section. Entries depend on deployment configuration.
2. Complete the authentication-site and provider authorization prompts. Check the binding list after returning to Account Security.
3. Before unbinding, confirm another sign-in method is available. Then select **Delete** for that binding. This button immediately starts unbinding, so check the provider and account first.

Only one external account can be bound per provider at a time. To replace it, unbind the existing account first. Unbinding removes the association on this site; it does not delete the provider account. If an error occurs or the returned result is unexpected, reopen Account Security to check the current bindings before retrying.

### Event Center

Path: **Settings → Event Center**

Configure notification preferences, email delivery, and webhooks. See [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings) for full details.

## Notes

- Email and password changes may require a verification step or an active 2FA challenge.
- Clearing theme or language cache can reset those local preferences; clearing authentication tokens may require signing in again. This cache cleaner does not revoke sign-in sessions on all devices.
- Access keys, passkeys, and trusted devices open in drawers within the Account Security page. See [Access key management]({{DOCS_BASE_URL}}/en/access-key-management), [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management), and [Trusted devices]({{DOCS_BASE_URL}}/en/trusted-device-management) for details.

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

Policies can grant the two actions on the current user's ARN. A matching explicit Deny overrides Allow. Even wildcard grants cannot use these personal endpoints to change another user's email. Existing verification, two-factor, CAPTCHA, replay protection, email uniqueness and one-change-per-24-hour limits still apply. Third-party OAuth applications also need the `email` scope; `profile` scope alone is insufficient.

Authorization and user state are checked again before sending a code or committing an email change. If an account, grant, role session or OAuth authority changes during the operation, the request can be denied or return a conflict. Refresh the session and confirm the operation again. `legacy` and `shadow` retain the previous effective email permission; `shadow` also records IAM decisions.

## Troubleshooting

| Symptom                                                        | Action                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name or email controls are unavailable, or an action is denied | Ask an administrator to check authorization for the action. Reading a profile, changing a name, sending an email code, and changing email are separate capabilities.     |
| The email code was sent, but the change is rejected            | Check email-change permission, address availability, the 24-hour limit, and session status. Permission to send a code does not guarantee permission to apply the change. |
| The new email field was changed after receiving a code         | Use the code with the address it was sent to. Confirm the target address and request a new code rather than using a code from another mailbox.                           |
| Submission reports a conflict or the outcome is unclear        | Refresh and check the current profile to see whether the change took effect before submitting again. Request a new code if the previous one was consumed or expired.     |
| Only part of the cache was cleared                             | Cleared items are not automatically restored. Reopen the dialog to check the remaining items; if sign-in data was cleared, you may need to sign in first.                |

## Related pages

- [Access key management]({{DOCS_BASE_URL}}/en/access-key-management)
- [Passkey management]({{DOCS_BASE_URL}}/en/passkey-management)
- [Trusted devices]({{DOCS_BASE_URL}}/en/trusted-device-management)
- [Notification settings]({{DOCS_BASE_URL}}/en/notification-settings)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
- [2FA & passkeys]({{DOCS_BASE_URL}}/en/two-factor-authentication)
