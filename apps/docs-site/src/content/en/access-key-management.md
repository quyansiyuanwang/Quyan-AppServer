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

## Related pages

- `account-settings`
- `api-documentation`
