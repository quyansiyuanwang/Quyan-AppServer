# JSON Endpoints

The JSON Endpoints product gives each instance one editable JSON document for configuration publishing and lightweight data sharing. Edit content in the product console, use a product key from your backend, or read through the endpoint's share URL.

## Prerequisites

Create an enabled JSON Endpoint product instance. Names are 1–100 characters; instance slugs are 3–80 lowercase letters, digits, or hyphens. Instance limits follow the account's current entitlement. New content is `{}` and public by default. An ordinary share path contains the owning username and instance slug. Creation can conflict with an existing endpoint using the same owner and slug.

Reading requires `json_endpoint:read`. Updating or clearing through the product API requires `json_endpoint:update`. Instance and key management use `json_endpoint:manage`. Both the product key's action grants and its bound identity's effective permissions must allow the operation. See [Developer products overview]({{DOCS_BASE_URL}}/en/developer-products-overview) for key creation and storage.

Anyone who knows a new instance's address can read its public content. Check that content may be shared before the first save. If protection is needed, configure password or signature access through [JSON endpoint management]({{DOCS_BASE_URL}}/en/json-endpoint-management) first. The product editor updates content only, without access-protection controls.

## Edit and save in the console

1. Open the JSON Endpoints product console and the target instance's details.
2. Check the instance name, share path, and Public or Protected status, then edit the JSON.
3. In code mode, move focus out of the text box and resolve parsing errors before selecting Save.
4. After success, read the content again or request the share URL with the correct credentials to confirm publication.

The editor supports visual and code modes. Prefer an object or array at the root. Existing string, number, or other scalar roots can appear as `{}` in the editor. Check actual content through the API before treating that display as the saved value.

Parsing errors do not disable the outer Save button, which can submit the previous valid draft instead of the current invalid text. Quick templates replace the draft immediately without confirmation. Closing details, changing instances, or reloading discards unsaved changes; copy drafts you need first.

Saving replaces the entire JSON document rather than merging fields. A later save can overwrite another editor's changes. After a timeout or interrupted connection, keep a draft copy, then close and reopen details to check the saved content. Reopen details after a load failure. The top-level refresh reloads only instances, not editor content.

## Choose an access method

| Entry point              | Authentication and result                                                    | Usage                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Product console          | Sign-in session; view and save the whole document                            | Does not use the product key metering API                                  |
| Product key API          | Instance product key; returns content and instance/path metadata             | Reads, updates, and clears count toward product usage                      |
| Share URL `/v1/json/...` | Public, static password, or Ed25519 signature according to endpoint settings | Does not use product key metering; access counts differ from product usage |

Build share URLs from your deployment's API service address and the displayed path. A protected URL requires password or signature headers; simply opening it in a browser does not test authenticated access. Shared JSON content is at `data.data` in the standard response envelope. Product key reads return content at `data.jsonContent`.

## Use the product key API

Keep the key on a trusted backend and call your deployment's API service. A sign-in token, AccessKey, or relay token cannot replace a product key.

```http
GET /v1/products/json-endpoints
Authorization: Bearer <PRODUCT_API_KEY>
```

Check HTTP status and the response business code. On success, `data` includes `jsonContent`, `instanceId`, `publicUrl`, `isPublic`, and `lastUpdated`. Access-statistics updates can also change `lastUpdated`; it is not a content version number.

| Operation       | Method and body                                                           | Result                                                                          |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Read            | `GET /v1/products/json-endpoints`                                         | Content and metadata                                                            |
| Replace content | `PUT /v1/products/json-endpoints` with `{"jsonContent":{"enabled":true}}` | Replaces content, preserving access protection                                  |
| Clear content   | `DELETE /v1/products/json-endpoints`, no body needed                      | Sets content to `{}` and returns `data.success: true`; instance and keys remain |

Updates and clears also require replay-protection signing. The key alone is insufficient for writes. The console handles signing automatically. For a custom integration:

1. Call `GET /v1/auth/replay-signing-session` on the same API service. Read `data.sessionId` and `data.signingKey` and manage session expiry using the returned expiry information.
2. Generate a fresh nonce and current Unix timestamp in seconds for each request. Using the signing key's original string as the HMAC-SHA256 key, compute a hexadecimal signature of `nonce + timestamp + pathname + body` with no separators. `pathname` is the actual API path. `body` is the request JSON object serialized by `JSON.stringify`, or an empty string when no body is sent.
3. Include `X-Replay-Session-Id`, `X-Nonce`, `X-Timestamp`, and `X-Sign` as well as the product key. Use a consistent client fingerprint for the signing-session request and business request. Renew expired sessions and use a new nonce for every retry.

Timestamps allow five minutes of clock skew in either direction. Signing depends on Redis; writes are rejected when that service is unavailable. This HMAC replay protection for product writes differs from Ed25519 signing for shared reads.

## Usage, disabling, and deletion

The account's JSON Endpoint product instances share daily quota, counted by the server's calendar date. Free quota, overage settings, and unit prices follow the current product configuration. Requests can still accumulate at a zero unit price. Metered execution failures enter a quota refund process that can be delayed. Key request counts, shared access counts, and billed product calls are separate metrics.

Disabling an instance blocks product key requests and product-console content management. It does not close the share URL. To withdraw public content, configure protection or delete the endpoint through JSON endpoint management, then test the original URL. Data already downloaded or cached by callers cannot be recalled.

Deleting the product instance revokes its keys and removes the associated endpoint, with no console recovery. Product API `DELETE` only clears content and has different consequences. Deleting an associated endpoint directly in JSON endpoint management also makes product content unavailable, but does not delete the product instance; return to the product console if that must also be removed. Legacy endpoints are not converted into product instances automatically.

## Troubleshooting

| Symptom                                         | Action                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved content differs from the entered text     | Check code-mode parsing errors, move focus out, fix errors, save, and read again                                                                         |
| Disabled instance still has a working share URL | Disabling restricts product entry points; protect or delete the endpoint to withdraw sharing                                                             |
| Write reports missing replay-protection headers | Product keys do not bypass replay protection; use the console or implement the signing-session flow                                                      |
| Shared content cannot be read                   | Check the API address, username or root path, and password/signature configuration                                                                       |
| Details fail to load but the instance remains   | The associated endpoint may have been deleted, the instance may be disabled, or permissions may be missing; check management state before retrying saves |

Related: [JSON endpoint management]({{DOCS_BASE_URL}}/en/json-endpoint-management), [API documentation]({{DOCS_BASE_URL}}/en/api-documentation).
