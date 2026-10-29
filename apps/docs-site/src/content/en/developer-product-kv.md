# KV storage

KV storage is intended for frontend configuration, feature flags, and short-lived JSON data. Keys are unique only within the current instance and values are stored as JSON. It is not a file store, relational database, or high-throughput queue. For counters and other read-modify-write operations, the application must coordinate concurrent updates to prevent them from overwriting one another.

## Permissions and limits

Reads require the KV read action; writes and deletion require KV write. Keys may contain letters, digits, dots, underscores, colons, and hyphens and are limited to 191 characters. A serialized JSON value is limited to 64 KiB, and each instance to 1,000 entries. TTL ranges from 1 second to 30 days. Expired values behave as absent.

Expired records can still count toward the 1,000-entry limit until cleaned up, so creating a new key can fail at capacity. With read access, reload the KV list in the product instance console or call the product API `GET /v1/products/kv/entries` to clear expired records for that instance, then retry. Product API calls count toward usage. If the instance is still at capacity, delete entries you no longer need. The IAM-enforced JWT project list described below does not perform this cleanup.

## Manage entries in the console

Open a KV product instance and select New. Enter a key, a valid JSON value, and an optional TTL in seconds, then save. Writing an existing key overwrites its value and resets its expiry, so check the key before saving. The list shows keys, versions, and expiry times. Selecting Edit first reads the current value; the key cannot be changed in the edit dialog. Deletion requires confirmation. Viewing and saving require read and write permissions respectively.

When editing an expiring entry, the form fills in the remaining seconds at the time it opens. Saving recalculates expiry from the time of saving, so check the TTL again if the dialog has been open for a while. Saving with an empty TTL removes the expiry.

If the list fails to load, it may still show the previous list, including after switching instances; an empty list does not establish that the current instance has no entries. Select Retry in the error message and wait for a successful load before acting. Refresh can also fail after a save or deletion, even if a success message appears. Retry loading and read the entry to check the result before repeating the operation.

## API

Product API requests use `Authorization: Bearer sk-dpk-...`. Call the API from a trusted backend and protect the key. To provide configuration to a browser, have your backend authorize the request and return only the needed data; do not embed the product key in frontend code or browser storage.

```http
POST /v1/products/kv/entries/ui.theme
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{ "value": { "mode": "dark" }, "ttlSeconds": 86400 }
```

`GET /v1/products/kv/entries` lists keys, `GET /v1/products/kv/entries/{key}` reads one value, and `DELETE /v1/products/kv/entries/{key}` removes it. Writes are upserts and return `version`, `updateTime`, and an optional `expiresAt`. Each write sets the expiry again; omitting TTL removes the expiry. The version can show that a value changed, but the write API has no conditional update by version: concurrent read-modify-write operations can overwrite one another, so coordinate concurrency in your application for counters and similar uses. Product API calls count toward usage; quota and overage charges depend on the current product configuration.

Do not put API keys or other credentials in KV. Use [Secret Vault]({{DOCS_BASE_URL}}/en/developer-product-secret) for credentials managed by the platform.

## JWT project management

Project KV management uses `quyan:developer:ListKv`, `GetKv`, `SetKv`, and `DeleteKv`, supporting per-key delegation within an account. The ARN is `acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`; its final segment is the key's UTF-8 base64url encoding without padding. Copy resourceArn from a response to avoid encoding mistakes.

`GET /v1/developer/projects/{projectId}/kv/entries/page` returns filtered metadata (items, page, pageSize, hasNext), without values or a total. Empty pages may have a next page. In enforce, the array list returns only the default first page, and expired reads/lists do not delete entries. `GET .../kv/page` still reads a key named page. Project authorization does not automatically grant access to every key. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management) for policies and resource-group rules.
