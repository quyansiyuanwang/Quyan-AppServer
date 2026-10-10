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

1. Create a new key with a clear name.
2. Copy the newly generated key immediately and store it safely.
3. Review last-used time and request count to spot stale or active keys.
4. Delete keys that should no longer be trusted.

## Notes

- Newly created secret values are often shown only once.
- Existing keys remain listable for identification and lifecycle management, but not re-readable in full.
- Some creation flows can require a verification step.
- Treat access keys like passwords and never expose them in shared screenshots or chats.

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

- `account-settings`
- `api-documentation`
