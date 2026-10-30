# Auth Center Node SDK

Best for Node.js backends that want to trust this platform as an auth center.

Related pages:

- **Current:** Auth Center Node SDK
- **Switch stack:** [Auth Center Python SDK]({{DOCS_BASE_URL}}/en/auth-center-python-sdk)
- **Browser flow:** [Browser SPA example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example)

## When to use this page

Use this template when your system:

- stores a `client_secret` on the backend
- exchanges authorization codes or refresh tokens with the auth center
- verifies JWT access tokens locally with JWKS
- needs a machine-to-machine `client_credentials` example

## Before you begin

This page provides backend functions to copy, not a published package or a complete login callback and application-session implementation. Use the [SPA example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example) for browser applications; never ship a client secret to a browser.

1. Create an enabled, approved confidential client in [Auth Center application management]({{DOCS_BASE_URL}}/en/auth-center-client-management), and store its ID and secret securely.
2. Enable the grants you use: `authorization_code` for user login, plus `refresh_token` if refreshing is required. Enable `client_credentials` separately for machine calls.
3. Register the exact callback address and required scopes. Save a random `state` and PKCE verifier when starting authorization. Check `state` at the callback before exchanging the code with the matching redirect URI and verifier. The exchange function does not replace these steps.
4. Obtain the API base URL and expected issuer from the deployment administrator. The localhost values below are for local development; use the deployment's HTTPS address in production. `AUTH_CENTER_BASE_URL` is the API root, without an additional `/v1` or `/auth-center` suffix. `AUTH_CENTER_ISSUER` is configured independently and must exactly match the expected `iss`.

The token endpoint returns the token object directly on success; JWKS success uses `{ code, message, data }`. Keep their parsing separate. `expires_in`, scopes, and refresh-token availability depend on current client settings; `3600` in the JSON example is illustrative. Only a user authorization-code flow with the refresh grant enabled returns a refresh token.

## Environment variables

```env
AUTH_CENTER_BASE_URL=http://localhost:10001
AUTH_CENTER_CLIENT_ID=ac_live_example123
AUTH_CENTER_CLIENT_SECRET=ac_secret_example456
AUTH_CENTER_REDIRECT_URI=https://example.com/auth/callback
AUTH_CENTER_ISSUER=http://localhost:10001/auth-center
```

## Install dependencies

Use Node.js with native `fetch` and `AbortSignal.timeout`; the repository runtime requirements provide a suitable version. Run these commands in the example directory:

```bash
npm init -y
npm pkg set type=module
npm install jsonwebtoken dotenv
```

Keep the resulting lockfile and maintain dependencies through your application workflow. These commands do not install a separate Auth Center npm SDK.

## 1. Fetch JWKS

```js
export async function fetchJwks(baseUrl) {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/v1/auth-center/.well-known/jwks.json`,
    { signal: AbortSignal.timeout(15000) },
  )
  if (!response.ok) {
    throw new Error(`Failed to load JWKS: ${response.status}`)
  }
  const payload = await response.json()
  if (payload.code !== 0 || !Array.isArray(payload.data?.keys)) {
    throw new Error('Invalid JWKS response')
  }
  return payload.data
}
```

## 2. Verify access tokens locally

This example converts the JWKS RSA key to PEM with Node's built-in `crypto` support and then verifies the JWT.

```js
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

function jwkToPublicKey(jwk) {
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  return keyObject.export({ type: 'spki', format: 'pem' })
}

export async function verifyAccessToken({ token, jwks, issuer, audience }) {
  if (
    typeof issuer !== 'string' ||
    !issuer.trim() ||
    typeof audience !== 'string' ||
    !audience.trim()
  ) {
    throw new Error('Expected issuer and audience are required')
  }

  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Invalid JWT format')
  }

  const kid = decoded.header?.kid
  if (decoded.header?.alg !== 'RS256' || typeof kid !== 'string' || !kid) {
    throw new Error('Expected RS256 JWT with a valid kid')
  }

  const jwk = jwks.keys.find(
    (item) => item.kid === kid && item.kty === 'RSA' && item.alg === 'RS256' && item.use === 'sig',
  )
  if (!jwk) {
    throw new Error(`Unable to find JWKS key for kid=${kid}`)
  }

  const publicKey = jwkToPublicKey(jwk)

  const claims = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer,
    audience,
  })
  if (
    typeof claims === 'string' ||
    typeof claims.exp !== 'number' ||
    claims.token_use !== 'access_token'
  ) {
    throw new Error('Invalid access token claims')
  }
  return claims
}
```

The function above verifies the signature, issuer, audience, expiry, and token use, but does not check the scopes required by your application. Before authorizing an operation using the returned claims, check that its required scopes are present.

## 3. Exchange authorization code for tokens

```js
export async function exchangeAuthorizationCode({
  baseUrl,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/auth-center/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || 'Token exchange failed')
  }

  return payload
}
```

Expected result:

```json
{
  "access_token": "jwt...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh...",
  "scope": "profile email"
}
```

## 4. Refresh the short-lived access token

```js
export async function refreshAccessToken({ baseUrl, clientId, clientSecret, refreshToken }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/auth-center/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || 'Refresh failed')
  }

  return payload
}
```

## 5. Server-to-server with `client_credentials`

```js
export async function getMachineToken({ baseUrl, clientId, clientSecret, scope }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/auth-center/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || 'Machine token request failed')
  }

  return payload
}
```

Important:

- the response contains an `access_token`
- the response does **not** contain a `refresh_token`

## 6. Combined example

Combine the functions and import statements from sections 1–5 into `auth-center-client.js` alongside the combined example, and install the dependencies above. Set the environment variables for your deployment and keep the `.env` file containing your client secret out of version control. The authorization code and PKCE verifier are placeholders: replace them with the code returned by a real authorization and the verifier saved for that same flow. Validate `state` in the callback before exchanging the code; this example does not implement the complete callback.

```js
import 'dotenv/config'
import {
  exchangeAuthorizationCode,
  fetchJwks,
  refreshAccessToken,
  verifyAccessToken,
} from './auth-center-client.js'

const requiredEnv = (name) => {
  const value = process.env[name]
  if (!value?.trim()) throw new Error('Missing environment variable: ' + name)
  return value
}

const baseUrl = requiredEnv('AUTH_CENTER_BASE_URL')
const clientId = requiredEnv('AUTH_CENTER_CLIENT_ID')
const clientSecret = requiredEnv('AUTH_CENTER_CLIENT_SECRET')
const issuer = requiredEnv('AUTH_CENTER_ISSUER')

const code = 'returned_authorization_code'
const codeVerifier = 'saved_verifier_from_this_authorization_flow'

const tokenSet = await exchangeAuthorizationCode({
  baseUrl,
  clientId,
  clientSecret,
  code,
  redirectUri: requiredEnv('AUTH_CENTER_REDIRECT_URI'),
  codeVerifier,
})

const jwks = await fetchJwks(baseUrl)
const claims = await verifyAccessToken({
  token: tokenSet.access_token,
  jwks,
  issuer,
  audience: clientId,
})

console.log('Token verified')

if (tokenSet.refresh_token) {
  const refreshed = await refreshAccessToken({
    baseUrl,
    clientId,
    clientSecret,
    refreshToken: tokenSet.refresh_token,
  })

  // Persist refreshed.refresh_token securely; the previous refresh token has been rotated.
}
```

The JWKS response uses `{ code, message, data }`; the example reads `data.keys`. Set `AUTH_CENTER_ISSUER` to the exact configured token issuer (`iss`); do not infer it from the endpoint path.

## Verification limits and token updates

Local JWT verification establishes the signature and checked claims. It does not query whether the client is disabled, the user is unavailable, consent is withdrawn, or the stored token has been revoked. Define your own current-state checks and local-session invalidation policy; a valid signature does not establish current access authority. Fetch JWKS only from a trusted, preconfigured deployment, never from a URL supplied by an unverified token.

The verified `scope` claim is a space-delimited string. Match complete scope names, not substrings. The expected `aud` is your client ID. A user token's `sub` identifies the user; a machine token's `sub` identifies the client and has no user `uid`. A machine token is not a user login credential. This page does not handle ID Tokens or promise that Auth Center tokens can call arbitrary platform APIs.

A successful refresh replaces the refresh token. Serialize refreshes for a client session, store the returned token securely, and stop using the previous value. Returned scopes are recalculated from current consent and client configuration; check required scopes again. Refreshing does not automatically revoke previously issued access tokens. The example comment identifies where storage is needed but does not implement persistence.

The JWKS function fetches keys on every call and implements neither caching nor automatic rotation recovery. Production integrations can use an expiring cache. On an unknown `kid`, refresh from the same trusted address with bounded retries, then reject if the key remains unknown. Development backends using ephemeral signing keys change keys on restart, which can invalidate verification of old tokens.

## Common failures and recovery

| Symptom                                                  | Check and recovery                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client authentication failure or unavailable application | Check ID, current secret, confidential client type, approval, and enabled state. Machine calls also require their grant to be enabled.                      |
| Invalid authorization code or refresh token              | Check expiry, reuse, client binding, exact redirect URI, and PKCE verifier; authorize again if recovery is impossible.                                      |
| Invalid or insufficient scope                            | Request only configured scopes, inspect the response, and authorize each operation. Omitting scope uses the client's configured scopes.                     |
| Unknown `kid` or issuer/audience mismatch                | Check the trusted JWKS address, configured issuer, client ID, and key rotation. Do not disable verification.                                                |
| Timeout, non-JSON response, or network failure           | Check API root, proxy, and connectivity. The examples raise exceptions; map them to your application's failure responses without logging tokens or secrets. |

Code-exchange and refresh functions do not retry automatically. A timeout or disconnect does not prove that the server did not process the request. Authorize again if the new tokens cannot be recovered. Bound machine-token retries according to the error instead of retrying indefinitely.

## Recommended follow-up reading

- [Manage Auth Center applications]({{DOCS_BASE_URL}}/en/auth-center-client-management)
- [Auth Center Python SDK]({{DOCS_BASE_URL}}/en/auth-center-python-sdk)
- [Browser SPA example]({{DOCS_BASE_URL}}/en/auth-center-browser-spa-example)
