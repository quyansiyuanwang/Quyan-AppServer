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

## Reading quota override administration

In IAM enforcement mode, the quota override administration list requires eligibility from a real global group with `DEVELOPER_QUOTA_MANAGE`, using `quyan:developer:ListQuotaOverrides` on `acs:platform:*:platform:developer-quota-override/<override record ID>`. Only authorized actual override records are returned, and a matching Deny takes priority. AssumeRole uses only the role's own record grants.

If records, eligibility, policies, or role sessions change while reading, the result is withheld. Deleted records are hidden. Expired overrides remain visible for administrative cleanup; displaying them does not reactivate them.

## Quota override write permissions

Creation and updates use `quyan:developer:UpsertQuotaOverride`; deletion uses `quyan:developer:DeleteQuotaOverride`. They require eligibility from a real global group with `DEVELOPER_QUOTA_MANAGE`. Creation and updates check both `acs:platform:*:platform:developer-quota-subject/<user or project>/<subject ID>/<service>` and the actual override record ARN. The service segment is `ip`, `verification`, or `push`; general overrides use `all`. Restoring a deleted override keeps its original ID, so existing resource Deny statements remain effective.

The target user, account, or project must be active. If subject ownership, target versions, eligibility, or authorization changes before saving, the operation fails without partially saving changes. Expiry must be in the future. Deletion can clean up overrides that are no longer needed. Missing or unauthorized deletion targets return 403 in IAM enforcement mode. Write endpoints retain replay protection.

## Product configuration read permissions

In IAM enforcement mode, the administrative configuration list requires eligibility from a real global group with `DEVELOPER_PRODUCT_CONFIG_MANAGE`, using `quyan:developer:ListProductConfigurations` on `acs:platform:*:platform:developer-product-config/<configuration record ID>`. Only authorized, persisted product configurations are returned, sorted by product code. Reading does not automatically create other products' configuration records.

In IAM enforcement mode, configuration writes require `quyan:developer:UpsertProductConfiguration` on both the product scope `acs:platform:*:platform:developer-product-config-control/<productCode>` and the actual configuration `acs:platform:*:platform:developer-product-config/<configurationId>`. New records are checked before commit, and restored configurations keep their original IDs. An explicit denial, revoked authorization, or a concurrent configuration change prevents a partial write. Saving one product does not initialize configurations for other products.

A matching Deny takes priority, and AssumeRole uses only the role's own grants. If configurations, eligibility, policies, or role sessions change while reading, the result is withheld. Administrative limits and settings are loaded only after each record is authorized.

## Product account list permissions

In IAM enforcement mode, both the complete and product-filtered account lists use `quyan:developer:ListProductAccounts` on `acs:platform:*:platform:developer-product-account/<actual product account record ID>`. The actor must belong to a real global group with `DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE` platform eligibility. Only authorized, non-deleted persisted records with an active primary account are returned. Disabled or expired product records remain available for administrative cleanup. Quotas and primary-account display information are read only after each record is authorized.

Changes to records, primary accounts, policies, platform eligibility, or role sessions during the read prevent stale results from being returned. Product filtering is applied during retrieval, and the list is ordered by most recent update. Queries do not create product records for other accounts.

Product usage queries use the separate `quyan:developer:GetProductAccountUsage` action on the actual product account record. A user-ID lookup resolves the same underlying record and cannot broaden access through an alternate path. The record, primary account, product pricing configuration, daily counters, and authorization are rechecked before returning; concurrent changes reject the read. Queries retain compatibility with legacy daily-counter dates and do not create records or reset counters. Quotas, counters, and pricing information are loaded only after the resource is authorized.

Call-log lists use `quyan:developer:ListProductAccountCalls`, evaluating each `acs:platform:*:platform:developer-product-call-log/<actual log ID>`. Both query paths verify the product record and active primary account. They return at most the 200 most recent authorized, non-deleted logs, applying the cap after filtering. Charges, calling identities, and related record IDs are loaded only after authorization; detailed request contents, credentials, and secrets are not read or returned. Changes to record ownership, eligibility, or authorization during retrieval prevent stale results from being returned.
