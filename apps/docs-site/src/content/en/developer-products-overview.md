# Developer products

Developer products provide separate instance, permission, quota, and audit boundaries for KV storage, short links, secret vaults, status monitoring, verification, IP geolocation, and push aggregation. Each product has a Console for daily work, Operations for account usage and capacity, and Product configuration for platform-wide settings.

## Get started

1. Create an instance in the product Console. An instance isolates resources and credentials.
2. Create a `dpk_` API key for the RAM principal that will make calls, selecting only actions that principal currently has.
3. Send `Authorization: Bearer dpk_...` from a server-side environment. Never ship the key in a browser, mobile application, or public repository.
4. Use the Console to inspect instances, quota, and audit records. Disable the instance or revoke a key to stop calls.

## RAM and API keys

Every key is bound to a RAM principal and evaluated against that principal's current permissions on every call. Removing a RAM permission immediately removes the matching key capability. Account owners may delegate only to principals in their own account; RAM users may create keys only for themselves.

The raw key is shown once after creation. Store it in deployment-time secret management; the Console subsequently shows only its prefix, permissions, expiry, and last-use time.

## Instance states and responses

Disabling an instance immediately rejects external calls with `403`: the resource exists but is unavailable. It is not reported as `404`. Authentication failures are reserved for revoked, deleted, malformed, or otherwise invalid keys. Deleting an instance permanently removes its resources and keys.

## Quota and billing

Daily free quota is aggregated per account and product, so creating extra instances cannot increase it. Calls above quota continue only when overage billing is enabled in Operations and the account has sufficient balance. Validation failures, private-IP lookups, and verification messages that were not delivered are not billed.

Refer to each product page for request details and use the least-privileged RAM action for every integration.
