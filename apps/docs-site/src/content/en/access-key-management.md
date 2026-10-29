# Access key management

Use this page to create and maintain access keys for account-level programmatic access.

## Page purpose

- Create named access keys.
- Copy a newly created key immediately after creation.
- Review usage and expiry information.
- Delete keys that are no longer needed.

## What you will see

### Key list

- Key name.
- Existing keys appear only in masked form and cannot be re-read in full.
- Request count and last-used time.
- Expiry information.

### Key actions

- Create key.
- Refresh list.
- Copy the newly created key.
- Delete key.

## Common actions

1. Choose to create a key, give it a recognizable name, and optionally select an expiry time. If left blank, the key does not expire automatically; an expired key cannot authenticate requests.
2. Complete the security verification requested on the page and confirm creation.
3. Copy the full key from the success dialog and store it safely. After closing the dialog, you cannot retrieve it from the list.
4. Review last-used time and request count to identify stale or active keys, and delete keys you no longer need or trust.

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

## Related pages

- [Settings]({{DOCS_BASE_URL}}/en/account-settings)
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
