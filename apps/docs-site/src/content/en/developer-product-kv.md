# KV storage

KV stores JSON configuration, feature flags, and short-lived data by key. Each instance has its own key space. Manage entries in the console or use a product API key from your backend.

## Prerequisites and limits

Create an enabled KV instance and obtain the required permissions. Listing and reading values require `product:kv:read`; writing and deletion require `product:kv:write`. Instance creation and key administration use separate management permissions. See [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview).

| Item    | Limit and behavior                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key     | Product APIs accept 1–191 characters: English letters, digits, dots, underscores, colons, and hyphens; use the same rules in the console for compatibility |
| Value   | Valid JSON, no more than 64 KiB after UTF-8 serialization; some characters occupy multiple bytes                                                           |
| Entries | Up to 1,000 per instance; expired records awaiting cleanup can still occupy capacity                                                                       |
| TTL     | Optional integer from 1 to 2,592,000 seconds (30 days); omit it for no expiry                                                                              |
| Version | Starts at 1 for a new key and increases on each overwrite; indicates changes, without conditional writes or historical version recovery                    |

KV has no atomic counter increment, queue consumption, or multi-key transaction API. Concurrent read-modify-write operations can overwrite each other; coordinate them in your application. Do not store product API keys or other credentials as KV values. Use [Secret Vault]({{DOCS_BASE_URL}}/en/developer-product-secret) for platform-managed credentials.

## Create and edit in the console

1. Open the KV product console and open the target instance's details.
2. Select New KV entry and enter a key and valid JSON, for example key `ui.theme` and value `{"mode":"dark"}`.
3. Optionally enter TTL in seconds. Leave it blank for no expiry.
4. Select Save. After success, check the key, version, and expiry in the list.

Writing an existing key directly overwrites its value without an additional overwrite confirmation. Check the key before creating an entry. The list contains metadata, not values. Edit first reads the current value before opening the form. The key cannot be changed while editing. Opening the form does not grant write access; saving still requires write permission. Users with write access alone can also use the new-entry form to write a known key.

Editing an expired entry can report that the key does not exist. For an expiring entry, the form initially contains the remaining seconds when opened. Saving recalculates expiry from the save time. Check TTL again after leaving the dialog open. Saving with an empty TTL removes expiry; `0` cannot mean immediate expiry.

The list has no polling or pagination. The top-level refresh reloads only instances. Close and reopen instance details to reload entries.

## Delete entries and clear expired records

Select Delete for an entry and confirm. Deletion is permanent, with no console undo or recovery. Deleting a nonexistent key again returns a not-found error.

Once expired, a key reads as absent. Loading the product instance's KV list clears expired records for that instance, as does the product API list request. Reading one expired key clears only that key. Do not assume capacity is released immediately at expiry.

If creating a key fails at capacity, successfully reload the entry list to clear expired records, then retry. If still full, delete entries you no longer need. The project-management list and read APIs in IAM enforcement mode described below do not perform this cleanup.

## Use the product API

Call your deployment's API service from a trusted backend with a product key for the instance. Both the key's grants and its bound identity's effective permissions must allow the action. A sign-in token, AccessKey, or relay token cannot replace the product key. To serve configuration to browsers, return only authorized data through your backend; do not put the key in frontend code or browser storage.

```http
POST /v1/products/kv/entries/ui.theme
Authorization: Bearer <PRODUCT_API_KEY>
Content-Type: application/json

{ "value": { "mode": "dark" }, "ttlSeconds": 86400 }
```

Replace `<PRODUCT_API_KEY>` with your key. The JSON request must include `value`; do not omit the value entirely. Check the response business code as well as the HTTP status.

| Operation          | Request                                | Successful response `data`                                                      |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| List               | `GET /v1/products/kv/entries`          | Metadata array ordered by latest update, without values or pagination           |
| Read               | `GET /v1/products/kv/entries/{key}`    | `key`, `value`, `version`, `updateTime`, and `expiresAt` when expiry is set     |
| Write or overwrite | `POST /v1/products/kv/entries/{key}`   | Saved value and metadata; the operation can finish even if the response is lost |
| Delete             | `DELETE /v1/products/kv/entries/{key}` | `success: true`                                                                 |

Each write resets TTL. Omitting `ttlSeconds` removes the previous expiry. Do not blindly repeat writes after a timeout: retries increase the version again and reset expiry. Read the key and check its value and metadata before deciding to retry.

## Usage and charges

Product key API requests for listing, reading, writing, and deleting all count toward usage. Console entry management uses the sign-in session rather than those metered APIs. Page clicks, key request counts, and version numbers are not billing call counts.

The account's KV instances share daily product quota, counted by the server's calendar date. Free quota, overage settings, and unit prices follow the current product configuration. Requests are still counted at a zero unit price. Execution failures enter a quota refund process that can be delayed. Rejection during authentication, parameter validation, or quota checks does not establish a completed operation.

## Project management API and granular authorization

For resource management through a sign-in session, administrators can delegate `quyan:developer:ListKv`, `GetKv`, `SetKv`, and `DeleteKv` separately. Listing does not automatically allow reading values, overwriting, or deletion.

The instance console's `GET /v1/products/kv/instances/{instanceId}/entries` checks `ListKv` on the backing project and returns the instance's entry metadata without per-key filtering. It differs from the project-management pagination API below; identify the intended entry point when delegating access.

`GET /v1/developer/projects/{projectId}/kv/entries/page` returns `items`, `page`, `pageSize`, and `hasNext`, without values or a `total`. IAM enforcement mode filters visible entries per key. An empty page can still have a next page; use `hasNext` to continue. In enforcement mode, the old array endpoint `GET /v1/developer/projects/{projectId}/kv` returns only the default first page.

A key's ARN is `acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`. Its final segment is the original key's UTF-8 base64url encoding without padding. Prefer `resourceArn` from a project-management response. Read a single key through `GET /v1/developer/projects/{projectId}/kv/{key}`, including a key named `page`. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management) for policy rules.

## Troubleshooting

| Symptom                                             | Action                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON cannot be saved                                | Check quotes, commas, and JSON syntax; check serialized byte size rather than character count alone                                         |
| Entry appears but cannot be edited                  | It may have expired or been deleted, or read permission may be missing; reload and check grants                                             |
| A list remains after a load failure                 | It may be the previous result, including data from another instance; select Retry in the error and wait for a successful load before acting |
| Save or deletion succeeds but the list is unchanged | The follow-up refresh may have failed; reload and read the entry to confirm before repeating the operation                                  |
| New entry hits the count limit                      | Successfully reload the list to clear expired records, then delete unused keys if still full                                                |
| Version increases but the value is unexpected       | Check other writers and concurrent updates; the version is not a conditional-update lock or a way to restore old values                     |
