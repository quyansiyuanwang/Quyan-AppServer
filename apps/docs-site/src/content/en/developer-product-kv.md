# KV storage

KV storage is intended for frontend configuration, lightweight counters, feature flags, and short-lived JSON data. Keys are unique only within the current instance and values are stored as JSON. It is not a file store, relational database, or high-throughput queue.

## Permissions and limits

Reads require the KV read action; writes and deletion require KV write. Keys may contain letters, digits, dots, underscores, colons, and hyphens and are limited to 191 characters. A serialized JSON value is limited to 64 KiB, and each instance to 1,000 entries. TTL ranges from 1 second to 30 days. Expired values behave as absent.

## API

Authenticate every request with `Authorization: Bearer sk-dpk-...`:

```http
POST /v1/products/kv/entries/ui.theme
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{ "value": { "mode": "dark" }, "ttlSeconds": 86400 }
```

`GET /v1/products/kv/entries` lists keys, `GET /v1/products/kv/entries/{key}` reads one value, and `DELETE /v1/products/kv/entries/{key}` removes it. Writes are upserts and return `version`, `updateTime`, and an optional `expiresAt`. Each write sets the expiry again; omitting TTL removes the expiry. The version can show that a value changed, but the write API has no conditional update by version: concurrent read-modify-write operations can overwrite one another, so coordinate concurrency in your application for counters and similar uses. Product API calls count toward usage; quota and overage charges depend on the current product configuration.

Do not put API keys or other credentials in KV. Use the Secret Vault product for credentials managed by the platform.

## JWT project management

Project KV management uses `quyan:developer:ListKv`, `GetKv`, `SetKv`, and `DeleteKv`, supporting per-key delegation within an account. The ARN is `acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`; its final segment is the key's UTF-8 base64url encoding without padding. Copy resourceArn from a response to avoid encoding mistakes.

`GET /v1/developer/projects/{projectId}/kv/entries/page` returns filtered metadata (items, page, pageSize, hasNext), without values or a total. Empty pages may have a next page. In enforce, the array list returns only the default first page, and expired reads/lists do not delete entries. `GET .../kv/page` still reads a key named page. Project authorization does not automatically grant access to every key. See [RAM management](./ram-management) for policies and resource-group rules.
