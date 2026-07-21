# JSON endpoint management

JSON endpoints publish accessible JSON content. An endpoint can be public, protected with a static password, or protected with an Ed25519 signature.

## Endpoint URLs

Regular endpoints scope a slug to its owner:

```text
GET /v1/json/{username}/{slug}
```

An endpoint with root-slug permission uses the global form:

```text
GET /v1/json/{slug}
```

Root slugs resolve only from the global URL. Namespaced URLs resolve only non-root slugs.

## Access modes

| Mode              | Use case                                      | Request method             |
| ----------------- | --------------------------------------------- | -------------------------- |
| Public            | Content intended for open distribution        | Direct `GET`               |
| Static password   | Simple shared protection                      | `X-Access-Password` header |
| Ed25519 signature | Service-to-service or replay-protected access | Signature headers          |

For signature access, the management UI stores only the Ed25519 SPKI PEM **public key**. The caller must retain the private key and must never upload it or put it in frontend configuration.

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
- `nonce`: a new base64url random string for every request. Use at least 16 characters. A nonce is single-use within an endpoint.
- Encode the signature as base64url, not regular base64.

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

This code runs directly on Node.js 20+:

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
console.log(await response.json())
```

## Browser Web Crypto example

Browser callers must satisfy the target service's CORS policy. Never embed a private key in a public web page; load it only from user-controlled secure storage or an explicit one-time import flow.

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
console.log(await response.json())
```

## Required permissions

| Action                        | Required permission       |
| ----------------------------- | ------------------------- |
| View endpoints                | `JSON_ENDPOINT_READ`      |
| Create endpoint               | `JSON_ENDPOINT_CREATE`    |
| Edit endpoint                 | `JSON_ENDPOINT_UPDATE`    |
| Delete endpoint               | `JSON_ENDPOINT_DELETE`    |
| Use a root slug               | `JSON_ENDPOINT_ROOT_SLUG` |
| Manage other users' endpoints | `JSON_ENDPOINT_MANAGE`    |

## Related pages

- `api-documentation`
- `article-management`
