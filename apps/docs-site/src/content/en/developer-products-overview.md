# Developer products

Developer products provide separate instance, permission, quota, and audit boundaries for KV storage, short links, secret vaults, status monitoring, verification, IP geolocation, push aggregation, and JSON endpoints. Each product has a Console for daily work, Operations for account usage and capacity, and Product configuration for platform-wide settings.

## Get started

1. Create an instance in the product Console. An instance isolates resources and credentials.
2. Create a `sk-dpk-` API key for the RAM principal that will make calls, selecting only actions that principal currently has.
3. Send `Authorization: Bearer sk-dpk-...` from a server-side environment. Never embed the key in frontend code, a mobile application, or a public repository. The console’s built-in test tools require entering a key in the browser; use them only on a trusted device.
4. Use the Console to inspect instances, quota, and audit records. Disable the instance or revoke a key to stop calls.

New product API keys use the `sk-dpk-` prefix; existing `dpk_` credentials remain supported. The full key is shown only when it is created.

## RAM and API keys

Every key is bound to a RAM principal and evaluated against that principal's current permissions on every call. Removing a RAM permission immediately removes the matching key capability. Account owners may delegate only to principals in their own account; RAM users may create keys only for themselves.

The raw key is shown once after creation. Store it in deployment-time secret management; the Console list subsequently shows its name, prefix, actions, and expiry.

In the instance details, select Create Key and provide a name, principal, actions, and optional expiry. Copy the full key when it is created; it cannot be viewed again after closing the dialog. To stop a key, select Revoke in the same list and confirm. Calls can no longer use the revoked key.

## Instance states and responses

Disabling an instance prevents external calls. Requests using a product API key receive `403`; public short links and status pages may return other errors. Revoked, expired, or invalid keys fail authentication, and insufficient permissions can also block calls. Deleting an instance removes its resources and revokes its keys; it cannot be restored.

## Quota and billing

Daily free quota is aggregated per account and product, so creating extra instances cannot increase it. When the product overage price is zero, calls are free and unrestricted by that quota, though usage is still recorded. When the price is positive, calls beyond the free quota require overage billing to be enabled and sufficient account balance. Validation failures, private-IP lookups, and failed verification sends do not result in a charge. A successful send means the channel accepted the request, not that final delivery is guaranteed. See each product guide for its metering and limits.

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

Administrative instance lists for a primary account use `quyan:developer:ListProductAccountInstances` on `acs:platform:*:platform:developer-product-instance/<actual instance ID>`. Instance names and slugs are loaded only after each row is authorized. Each backing project must be active and belong to the same primary account. Disabled, non-deleted instances remain visible for administration. Changes to an instance, backing project, product record, primary account, or authorization prevent stale results from being returned. Queries do not provision product records.

Product account quota updates use `quyan:developer:UpsertProductAccount`, requiring both `acs:platform:*:platform:developer-product-account-scope/<primaryAccountId>/<productCode>` and the actual product account record. Newly generated records are checked before commit, and restored records retain their original ID. The target must be an active primary account and the product configuration must already exist. Updates do not initialize unrelated configurations. Competing inserts, configuration changes, ownership changes, revoked authorization, or a record Deny reject the entire operation. Audit records contain the actual record ID and safe quota changes.

The paginated primary-account directory uses `quyan:developer:ListProductAccountOwners` on the primary account and product scope. Provisioned accounts additionally require authorization on their actual product account record. Pagination and totals are calculated after both checks; unauthorized primary accounts are excluded from totals. Authorized accounts that have not used the product appear without a product record for administrative configuration. Keyword filtering remains in the database, while names, usernames, and quotas are loaded after authorization. Changes to primary accounts, product records, or authorization reject the result; unfiltered account counts are never returned.
