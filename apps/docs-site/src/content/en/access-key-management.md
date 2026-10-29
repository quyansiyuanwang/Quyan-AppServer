# Access key management

Use this page to create and maintain access keys for account-level programmatic access.

## Prerequisites

- Sign in and open access key management from **Settings → Account Security**.
- To create a key, the account must have a bound email address. Without 2FA, you also need access to that mailbox for verification.
- Viewing, creation, and deletion need their own authorization. Creating a key does not guarantee permission to list or delete it; see the permission details below.

## Review the key list

- Key name.
- Existing keys appear only in masked form and cannot be re-read in full.
- Request count and last-used time.
- Expiry information.

Request count and last-used time help you observe key usage; they do not mean every corresponding business request succeeded. An expired key may remain listed, but it can no longer authenticate.

## Create and save a key

1. Choose to create a key, enter a recognizable name of up to 100 characters, and optionally select a future expiry time. Leaving expiry blank means the key does not expire automatically.
2. Without 2FA, send a code to the account's bound email and enter the six-digit code. With 2FA, complete the requested second-factor check. Confirm creation and wait for the result.
3. Copy the full key from the success dialog and store it safely. The copy-success message does not guarantee the clipboard was updated; paste into trusted secret storage and verify it, or select and copy the read-only text manually if needed. After closing the dialog, you cannot retrieve it from the list.
4. Configure the key in the application that needs it and verify access to the required APIs. The key does not automatically grant additional business permissions.

## Delete or replace a key

1. Check the name and masked value to identify the key to delete.
2. If an application still uses it, first create and save a replacement, update the application configuration, and verify access before deleting the old key.
3. Select **Delete** for the old key and confirm. With 2FA enabled, this high-risk deletion still requires verification.
4. Wait for successful deletion and the list refresh. The old key cannot authenticate new requests after deletion; create a new key if access is needed again.

## Notes

- The full key is shown only when creation succeeds.
- Existing keys remain listable for identification and lifecycle management, but not re-readable in full.
- Creating a key requires security verification, as described below.
- Treat access keys like passwords and never expose them in shared screenshots or chats.

## Creation permissions and security verification

When IAM enforcement is enabled, creating a key requires `quyan:ram:CreateAccessKey`; sending its creation verification code requires the separate `quyan:ram:SendAccessKeyCreationVerificationCode` action. Both target the executing user, not a key that has yet to exist:

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Allow",
    "Action": ["quyan:ram:CreateAccessKey", "quyan:ram:SendAccessKeyCreationVerificationCode"],
    "Resource": "acs:quyan:*:<accountId>:user/<userId>"
  }
}
```

Replace the placeholders with the current account and executing user IDs. Neither action is automatically granted. Creation does not grant listing or revocation, nor does it permit creating keys for another user. A matching Deny takes precedence.

Without two-factor authentication, creation requires a valid, unused email code. A used code cannot be reused. If creation fails and the code has expired or been used, request a new code before trying again. With two-factor authentication enabled, the existing security challenge still applies, but no additional email code is required or sent.

If email, two-factor settings, account state, or the role session changes during verification, authenticate again and restart the flow. Conflicts do not create a key. Third-party OAuth applications may still create keys subject to the `accesskey` scope, user authorization, and these IAM permissions; this does not permit reading or deleting existing keys. The full new key is returned only on successful creation, so save it immediately.

## Revocation permissions and resource scope

When IAM policy authorization is enabled, deleting an access key requires `quyan:ram:DeleteAccessKey`. A policy can restrict this operation to one of the current user's keys:

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Allow",
    "Action": "quyan:ram:DeleteAccessKey",
    "Resource": "acs:quyan:*:<accountId>:access-key/<userId>/<keyId>"
  }
}
```

Replace the placeholders with the current account ID, current user ID, and actual key ID. This grant does not allow reading the full secret or managing another user's keys. A matching Deny overrides Allow.

Deletion retains replay protection and requires a verification challenge when two-factor authentication is enabled. A revoked key cannot authenticate new requests. If the account, role session, or key ownership changes after authorization, the request is rejected. Refresh the list before retrying a concurrent-change conflict.

## List permissions and pagination

With IAM enforcement enabled, `quyan:ram:ListAccessKeys` controls which of your own keys appear. It uses the same key ARN as revocation, but does not grant deletion or access to the full secret. A matching Deny hides the key; a wildcard grant still cannot list another user's keys.

The page uses server-side pagination with previous/next controls and a page-size selector. A page can be empty after permission filtering while a later page still contains visible keys; use Next when available. No unfiltered total is displayed. Refresh retries the current page, and creating a key returns to the first page. The full secret is shown only in the creation dialog, never in either list API.

API clients should use `GET /v1/accesskeys/page?page=1&pageSize=50`. The response includes `items`, `page`, `pageSize`, and `hasNext`. The existing `GET /v1/accesskeys` array endpoint remains compatible and returns the complete authorized, masked list. Third-party OAuth applications cannot read either list.

## Troubleshooting

| Symptom                                                             | Action                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A verification code cannot be sent                                  | Check the bound mailbox and code-sending permission. Successful sending starts a 60-second cooldown. Contact an administrator about email service errors.                                            |
| The creation form asks for an email code even though 2FA is enabled | Reopen the creation dialog to fetch current security status. A status-loading failure may also show the email method; server requirements apply.                                                     |
| Creation reports an error or its outcome is unclear                 | Refresh and check the authorized list first; an error alone does not prove no key was created. If read permission is insufficient, ask an administrator to confirm the result before creating again. |
| The success dialog was closed before the full key was saved         | The list cannot recover the full value. Delete the unusable key, create a replacement, and save it immediately.                                                                                      |
| The current page is empty                                           | Check whether Next is available. Permission filtering or a failed load may also cause an empty page, so it does not prove there are no keys.                                                         |
| Deletion succeeded but the list did not update                      | Refresh the current page. If its last item was deleted, check the previous page.                                                                                                                     |

## Related pages

- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
- [Verification]({{DOCS_BASE_URL}}/en/auth-verification)
