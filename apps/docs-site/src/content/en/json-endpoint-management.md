# JSON endpoint management

Use JSON endpoint management to create, edit, and delete shared JSON documents and configure public, static-password, or Ed25519 access. For product instances and product keys, also see [JSON Endpoints]({{DOCS_BASE_URL}}/en/developer-product-json-endpoint).

## Open the page and obtain permissions

Sign in to the core management site and open JSON endpoint management (`/content/json-endpoints`). The page entry requires `json_endpoint:read`. Seeing a list or Edit button does not grant permission to submit changes.

| Operation                       | Product permission and scope                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| View your endpoints             | `json_endpoint:read`                                                                                                                     |
| Create your endpoint            | `json_endpoint:create`                                                                                                                   |
| Edit your endpoint              | `json_endpoint:update`                                                                                                                   |
| Delete your endpoint            | `json_endpoint:delete`                                                                                                                   |
| Use or change a root slug       | Additional `json_endpoint:root_slug`                                                                                                     |
| Manage another user's endpoints | Legacy authorization uses `json_endpoint:manage`; IAM enforcement still requires specific action/resource grants within the same account |

In IAM enforcement mode, listing, details, creation, update, deletion, owner options, and root slugs use separate actions, described below. Ask an administrator for task-specific grants. Management access does not mean access across all accounts.

## Create and edit endpoints

1. Select Create and enter a name, URL slug, optional description, and JSON content. The form defaults to public with content `{}`.
2. Names are 1–100 characters. Slugs are 1–100 lowercase letters, digits, underscores, or hyphens. Descriptions are up to 500 characters. With management permission, select an owner; with root-slug permission, choose a global path.
3. Check the URL preview and access mode. For protection, turn off public access and complete password or signature settings.
4. Select Confirm. Check the resulting list entry, then test the URL using its actual access method.

Edit an existing endpoint to change its name, description, content, or access settings. The slug and owner cannot be changed. Switching root-slug mode changes the URL without redirecting the old URL. If creation reports a slug conflict, choose another slug; deleted endpoints can still reserve their slug.

The editor supports visual and code modes. In code mode, move focus out and fix parsing errors before confirming. Parsing errors do not disable the outer save action, which can submit the previous valid content. Quick templates directly replace the draft. Prefer object or array roots. String, number, or other scalar roots can appear as `{}`; check actual content through the API first.

Editing uses the last loaded list data without fetching fresh details when opened. Refresh before editing shared documents. Saving updates the whole document and does not merge draft versions. Closing the drawer clears unsaved content; copy it first if needed. Clearing the description omits that field on save and does not guarantee removal of an existing description.

Desktop provides View JSON, copy URL, Edit, and Delete. View JSON shows loaded management data; it does not make a new shared request or validate password/signature access. On mobile, selecting a row opens editing without the desktop list's view, copy, or delete buttons. Use desktop for those operations.

There is no pagination or automatic refresh. The title count reflects currently loaded visible entries. The management-only owner filter reloads the list. A failed load can retain old data; refresh successfully before acting. An empty list alone does not establish that the deployment has no endpoints.

## Configure access protection

- **Public**: anyone with the URL can read. Saving public mode clears the previous password or public-key configuration. Switching back to protected mode requires configuration again.
- **Static password**: turn off public access, select static password, and set a password of 4–100 characters. A blank password preserves the existing one when editing within password mode. Switching from public or signature mode requires a new password. Passwords are not displayed again. Callers send `X-Access-Password`, not a password in the URL.
- **Ed25519 signature**: turn off public access, select signature mode, and enter an Ed25519 SPKI PEM public key or generate a key pair in the browser. Switching mode removes the other mode's credentials. Coordinate callers before replacing a public key.

The caller retains the private key. After generation, copy or download the PKCS#8 PEM private key before closing the dialog; it cannot be retrieved afterward. Generation fills the public-key field but does not apply it until Confirm saves the endpoint. Browser generation requires a secure context and Ed25519 Web Crypto support. If the private key is lost, generate a new pair, update the endpoint, and distribute the new private key.

Protection restricts shared reads. Management APIs still require authorization, and data already downloaded or cached cannot be recalled. Opening a protected URL does not show a web sign-in form; callers must send the required headers.

## Delete and confirm outcomes

Select Delete in the desktop list and confirm. The endpoint stops serving shared content, with no page recovery action. If a request times out or reports an error, the operation may have finished. Refresh and check the original URL before repeating creation or deletion.

Deleting a product-associated endpoint leaves its product instance in place, but the instance's content reads and edits fail. Deleting the entire product instance revokes its keys and removes its endpoint. To restrict sharing only, configure access protection. Disabling a product instance does not close the share URL.

## Endpoint URLs

Regular endpoints scope a slug to its owner:

```text
GET /v1/json/{username}/{slug}
```

An endpoint with root-slug permission uses the global form:

```text
GET /v1/json/{slug}
```

Root slugs resolve only from the global URL. Namespaced URLs resolve only non-root slugs. Combine the path with your deployment’s API address and prefer the copied page URL. Update callers after switching root mode; old paths do not redirect.

## Access modes

| Mode              | Use case                                      | Request method             |
| ----------------- | --------------------------------------------- | -------------------------- |
| Public            | Content intended for open distribution        | Direct `GET`               |
| Static password   | Simple shared protection                      | `X-Access-Password` header |
| Ed25519 signature | Service-to-service or replay-protected access | Signature headers          |

## Ed25519 signing format

Signature access protects `GET` requests. UTF-8 encode these five lines, then sign them with the Ed25519 private key:

```text
GET
<pathname>
<canonical-query>
<unix-seconds>
<nonce>
```

- `pathname`: for example `/v1/json/alice/config`, without the origin or query string.
- `canonical-query`: decode every query parameter, encode each key and value with `encodeURIComponent`, join each pair as `key=value`, sort the complete pairs lexicographically, then join them with `&`. Use an empty line when there is no query.
- `unix-seconds`: current Unix time in seconds. The server accepts a five-minute clock skew in either direction.
- `nonce`: a fresh base64url random string of 16–256 characters for every request. The server rejects reuse within an endpoint’s five-minute reservation window. Generate a new value for retries too.
- Encode the signature as base64url, not regular base64.

Join the five lines with four newline characters and no trailing newline. Preserve repeated query parameters and empty values. With no query, keep the third line empty. Signature access depends on Redis and rejects requests when it is unavailable.

Send all three headers:

```text
X-Json-Timestamp: <unix-seconds>
X-Json-Nonce: <nonce>
X-Json-Signature: <base64url-ed25519-signature>
```

## Node.js 20+ example

Save the PKCS#8 PEM private key downloaded from the management UI in the caller's protected filesystem, then set:

```text
JSON_ENDPOINT_URL=https://api.example.com/v1/json/alice/config?locale=en
JSON_ENDPOINT_PRIVATE_KEY_PATH=/secure/path/json-endpoint.ed25519.pem
```

Save the following code as `signed-request.mjs`, then run `node signed-request.mjs` in a terminal with the environment variables set. The `.mjs` extension tells Node.js to run it as an ES module. Replace the example URL and private-key path with your own values.

```js
import { readFile } from 'node:fs/promises'
import { createPrivateKey, randomBytes, sign } from 'node:crypto'

const endpoint = new URL(process.env.JSON_ENDPOINT_URL)
const privateKeyPem = await readFile(process.env.JSON_ENDPOINT_PRIVATE_KEY_PATH, 'utf8')

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&')
}

const timestamp = String(Math.floor(Date.now() / 1000))
const nonce = randomBytes(24).toString('base64url')
const payload = [
  'GET',
  endpoint.pathname,
  canonicalQuery(endpoint.searchParams),
  timestamp,
  nonce,
].join('\n')

const signature = sign(
  null,
  Buffer.from(payload, 'utf8'),
  createPrivateKey(privateKeyPem),
).toString('base64url')
const response = await fetch(endpoint, {
  headers: {
    'X-Json-Timestamp': timestamp,
    'X-Json-Nonce': nonce,
    'X-Json-Signature': signature,
  },
})

if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
const result = await response.json()
if (result.code !== 0) throw new Error(result.message || 'API request failed')
console.log(result.data.data)
```

## Browser Web Crypto example

Browser callers must satisfy the target service's CORS policy and run in a secure context with Ed25519 Web Crypto support. Never embed a private key in a public web page; load it only from user-controlled secure storage or an explicit one-time import flow. The `privateKeyPem` value below is a placeholder: replace it with a securely imported PKCS#8 PEM private key and use your actual endpoint URL before running the example.

```js
const endpoint = new URL('https://api.example.com/v1/json/alice/config?locale=en')
const privateKeyPem = '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, '')
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function base64Url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&')
}

const privateKey = await crypto.subtle.importKey(
  'pkcs8',
  pemToArrayBuffer(privateKeyPem),
  { name: 'Ed25519' },
  false,
  ['sign'],
)
const timestamp = String(Math.floor(Date.now() / 1000))
const nonceBytes = crypto.getRandomValues(new Uint8Array(24))
const nonce = base64Url(nonceBytes)
const payload = [
  'GET',
  endpoint.pathname,
  canonicalQuery(endpoint.searchParams),
  timestamp,
  nonce,
].join('\n')
const signature = base64Url(
  await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(payload)),
)

const response = await fetch(endpoint, {
  headers: {
    'X-Json-Timestamp': timestamp,
    'X-Json-Nonce': nonce,
    'X-Json-Signature': signature,
  },
})
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
const result = await response.json()
if (result.code !== 0) throw new Error(result.message || 'API request failed')
console.log(result.data.data)
```

## Management API and granular authorization

Management uses `/v1/json-endpoints`: `GET` lists and `POST` creates; `GET`, `PUT`, and `DELETE` on `/{id}` read details, update, and delete. Updates and deletion require management authorization, not the shared password or Ed25519 signature. The console signs replay-protected management requests automatically. Machine integrations must follow the API contract.

In IAM enforcement mode, `quyan:json_endpoint:ListEndpoints` controls list visibility. List responses contain JSON content, so grant it as content-reading access. Details separately require `GetEndpoint`, modifications `UpdateEndpoint`, and deletion `DeleteEndpoint`. Endpoint resources use `acs:json-endpoint:*:<accountId>:endpoint/<ownerUserId>/<endpointId>`. Delegation works within an account, not across accounts.

Creation checks `CreateEndpoint` on the owner's user resource, `acs:quyan:*:<accountId>:user/<ownerUserId>`. Creating a root slug also needs `SetRootSlug` on that user resource. Changing root-slug mode for an existing endpoint additionally checks `SetRootSlug` on the endpoint resource. Owner options have separate `ListEndpointOwners` authorization. Role-session expiry, revocation, identity disabling, or policy changes can remove previously available access. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management).

## Responses, access statistics, and troubleshooting

Successful shared reads use the standard response envelope. JSON content is at `data.data`, alongside `slug`, `ownerUsername`, `publicUrl`, and `lastUpdated`. Product key reads instead use `data.jsonContent`; use the correct parser for each.

After shared authentication passes, access count and last-access time are recorded asynchronously. They are not unique visitors, a complete audit trail, or billable call counts. Statistics updates can also change `lastUpdated`, so that time alone does not establish a content change. Sharing and management do not use product key call metering; product key reads and writes follow product billing rules.

| Symptom                                                 | Action                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Failed list load leaves entries visible                 | They may be old; refresh successfully before editing. Opening Edit does not fetch new details                              |
| Saved JSON differs from the text                        | Fix code-mode parsing errors, save, and read actual content through the API                                                |
| Password access fails                                   | Send `X-Access-Password`, not a product key or signature private key                                                       |
| Signature fails or nonce is reused                      | Check the actual path, all query parameters, clock, public key, and base64url encoding. Generate a new nonce every request |
| Signature service is unavailable                        | Ask an administrator to check Redis; unavailable signing services do not permit access                                     |
| Save or delete reports conflict or unavailable resource | Keep the draft, refresh to check concurrent changes and current grants, then retry. The error does not prove absence       |
| Original share URL is missing                           | Check deletion, root-mode changes, username, and slug                                                                      |

## Related pages

- [JSON Endpoints]({{DOCS_BASE_URL}}/en/developer-product-json-endpoint)
- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
