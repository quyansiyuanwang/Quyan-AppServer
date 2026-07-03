# Auth Center Node SDK

Best for Node.js backends that want to trust this platform as an auth center.

Related pages:

- **Current:** `Auth Center Node SDK`
- **Switch stack:** [`Auth Center Python SDK`](/en/auth-center-python-sdk)
- **Browser flow:** [`Browser / SPA Example`](/en/auth-center-browser-spa-example)

## When to use this page

Use this template when your system:

- stores a `client_secret` on the backend
- exchanges authorization codes or refresh tokens with the auth center
- verifies JWT access tokens locally with JWKS
- needs a machine-to-machine `client_credentials` example

## Environment variables

```env
AUTH_CENTER_BASE_URL=http://localhost:10001
AUTH_CENTER_CLIENT_ID=ac_live_example123
AUTH_CENTER_CLIENT_SECRET=ac_secret_example456
AUTH_CENTER_REDIRECT_URI=https://example.com/auth/callback
AUTH_CENTER_ISSUER=http://localhost:10001/auth-center
```

## Install packages

```json
{
  "name": "auth-center-node-demo",
  "private": true,
  "type": "module",
  "dependencies": {
    "jsonwebtoken": "^9.0.2"
  }
}
```

The examples below use native `fetch` from modern Node.js. If your runtime is older, add a fetch polyfill.

## 1. Fetch JWKS

```js
export async function fetchJwks(baseUrl) {
  const response = await fetch(`${baseUrl}/auth-center/.well-known/jwks.json`);
  if (!response.ok) {
    throw new Error(`Failed to load JWKS: ${response.status}`);
  }
  return response.json();
}
```

## 2. Verify access tokens locally

This example converts the JWKS RSA key to PEM with Node's built-in `crypto` support and then verifies the JWT.

```js
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

function base64UrlToBuffer(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function jwkToPublicKey(jwk) {
  const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
  return keyObject.export({ type: "spki", format: "pem" });
}

export async function verifyAccessToken({ token, jwks, issuer, audience }) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid JWT format");
  }

  const kid = decoded.header?.kid;
  if (!kid) {
    throw new Error("JWT header missing kid");
  }

  const jwk = jwks.keys.find((item) => item.kid === kid);
  if (!jwk) {
    throw new Error(`Unable to find JWKS key for kid=${kid}`);
  }

  const publicKey = jwkToPublicKey(jwk);

  return jwt.verify(token, publicKey, {
    algorithms: [jwk.alg || "RS256"],
    issuer,
    audience,
  });
}
```

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
  const response = await fetch(`${baseUrl}/auth-center/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.scope || payload?.message || "Token exchange failed",
    );
  }

  return payload;
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
export async function refreshAccessToken({
  baseUrl,
  clientId,
  clientSecret,
  refreshToken,
}) {
  const response = await fetch(`${baseUrl}/auth-center/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || "Refresh failed");
  }

  return payload;
}
```

## 5. Server-to-server with `client_credentials`

```js
export async function getMachineToken({
  baseUrl,
  clientId,
  clientSecret,
  scope,
}) {
  const response = await fetch(`${baseUrl}/auth-center/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.scope || payload?.message || "Machine token request failed",
    );
  }

  return payload;
}
```

Important:

- the response contains an `access_token`
- the response does **not** contain a `refresh_token`

## 6. Combined example

```js
import "dotenv/config";
import {
  exchangeAuthorizationCode,
  fetchJwks,
  refreshAccessToken,
  verifyAccessToken,
} from "./auth-center-client.js";

const baseUrl = process.env.AUTH_CENTER_BASE_URL;
const clientId = process.env.AUTH_CENTER_CLIENT_ID;
const clientSecret = process.env.AUTH_CENTER_CLIENT_SECRET;
const issuer = process.env.AUTH_CENTER_ISSUER;

const code = "returned_authorization_code";
const codeVerifier = "pkce-verifier";

const tokenSet = await exchangeAuthorizationCode({
  baseUrl,
  clientId,
  clientSecret,
  code,
  redirectUri: process.env.AUTH_CENTER_REDIRECT_URI,
  codeVerifier,
});

const jwks = await fetchJwks(baseUrl);
const claims = await verifyAccessToken({
  token: tokenSet.access_token,
  jwks,
  issuer,
  audience: clientId,
});

console.log("verified claims =>", claims);

if (tokenSet.refresh_token) {
  const refreshed = await refreshAccessToken({
    baseUrl,
    clientId,
    clientSecret,
    refreshToken: tokenSet.refresh_token,
  });

  console.log("refreshed access token =>", refreshed.access_token);
}
```

## Recommended practices

- cache JWKS for a short period and reload on unknown `kid`
- verify `issuer`, `audience`, `exp`, and expected scopes
- treat refresh tokens as secrets and store them server-side only
- rotate client secrets if exposure is suspected
- never expect a refresh token from `client_credentials`

## Recommended follow-up reading

- `Auth Center App Management`
- `Auth Center Python SDK`
- `Auth Center Browser / SPA Example`
