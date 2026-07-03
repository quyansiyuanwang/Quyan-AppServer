# Auth Center Browser / SPA Example

Use this example when the integrating application is a browser-first app, SPA, or other public client.

Related pages:

- **Setup first:** [`Auth Center App Management`](/en/auth-center-app-management)
- **Backend version:** [`Auth Center Node SDK`](/en/auth-center-node-sdk)
- **Current:** `Browser / SPA Example`

## Important browser guidance

For browser or SPA integrations:

- register the app as a **public client**
- enable `authorization_code`
- enable PKCE
- do not embed a client secret in frontend code
- do not treat browser storage as a secure place for long-lived refresh tokens

A common production pattern is:

1. browser starts the authorization request with PKCE
2. auth center returns an authorization code
3. your backend exchanges the code
4. your backend stores the refresh token securely
5. browser receives only the short-lived session it needs

## Minimal PKCE helpers

```ts
function base64UrlEncode(input: ArrayBuffer) {
  const bytes = new Uint8Array(input)
  let text = ''
  bytes.forEach((value) => {
    text += String.fromCharCode(value)
  })
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(text: string) {
  const data = new TextEncoder().encode(text)
  return crypto.subtle.digest('SHA-256', data)
}

export async function createPkcePair() {
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const challenge = base64UrlEncode(await sha256(verifier))
  return { verifier, challenge }
}
```

## Build the authorization URL

```ts
export async function buildAuthorizeUrl() {
  const clientId = 'ac_public_example123'
  const redirectUri = 'https://spa.example.com/auth/callback'
  const baseUrl = 'http://localhost:10001'
  const { verifier, challenge } = await createPkcePair()

  sessionStorage.setItem('auth_center_pkce_verifier', verifier)

  const url = new URL('/auth-center/authorize', baseUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'profile')
  url.searchParams.set('state', crypto.randomUUID())
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return url.toString()
}
```

## Handle the callback in the browser

```ts
export function readAuthCallback() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const verifier = sessionStorage.getItem('auth_center_pkce_verifier')

  if (!code || !verifier) {
    throw new Error('Missing code or PKCE verifier')
  }

  return { code, state, verifier }
}
```

## Exchange the code through your backend

Do **not** place client secret logic or refresh token storage in the browser.

```ts
export async function exchangeCodeWithBackend(payload: {
  code: string
  state: string | null
  verifier: string
}) {
  const response = await fetch('/api/auth-center/session/exchange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Failed to exchange auth code')
  }

  return response.json()
}
```

A typical backend handler would:

- call `POST /auth-center/token`
- store the refresh token server-side or in an HTTP-only cookie strategy
- return only the short-lived app session or minimum token information to the browser

## Local JWT validation in browser-only scenarios

If a browser-only integration must validate the JWT locally, it can use the JWKS document. But this should be treated as a UI/session optimization, not a substitute for backend authorization.

```ts
import jwtDecode from 'jwt-decode'

export async function readJwtKid(token: string) {
  const headerPart = token.split('.')[0]
  if (!headerPart) throw new Error('Invalid JWT')
  const json = JSON.parse(atob(headerPart.replace(/-/g, '+').replace(/_/g, '/')))
  return json.kid as string | undefined
}

export async function fetchJwks(baseUrl: string) {
  const response = await fetch(`${baseUrl}/auth-center/.well-known/jwks.json`)
  if (!response.ok) throw new Error('Failed to load JWKS')
  return response.json()
}
```

In most real deployments, the backend should remain the trust boundary.

## What not to do

- do not put `client_secret` in SPA code
- do not persist long-lived refresh tokens in localStorage unless you fully accept the risk
- do not use `client_credentials` from a public browser app
- do not assume `client_credentials` returns a refresh token

## Recommended architecture

```text
Browser -> /auth-center/authorize with PKCE
Browser <- redirect with code
Browser -> Your Backend /exchange
Your Backend -> Auth Center /token
Your Backend stores refresh token securely
Your Backend -> Browser session / short token view
```

## Recommended follow-up reading

- `Auth Center App Management`
- `Auth Center Node SDK`
- `Auth Center Python SDK`
