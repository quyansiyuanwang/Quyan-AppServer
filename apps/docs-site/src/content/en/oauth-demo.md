# OAuth authorization-code example

Use this local Node.js example to complete an authorization-code flow with PKCE (S256), then retrieve the current user's profile from the server. It displays only the outcome. It does not establish a business login session, save access tokens, or return them to the browser.

## Before you begin

1. Create an application in [OAuth app management](/en/oauth-app-management), register `http://127.0.0.1:3000/oauth/callback`, select `profile`, and submit it for review. Its status must be `approved`.
2. Confirm the identity and API origins, using only the scheme, host, and optional port. The browser visits `/oauth/authorize` on the identity site; the server calls `/v1/oauth/token` and `/v1/users/me` on the API site. Do not use console or documentation site addresses.
3. Use Node.js 22.12 or later and a browser that can reach the identity site. Confidential applications need a Client Secret; public applications omit it. The public-client demonstration also exchanges tokens through the local server; it is not a browser-only SPA example.
4. The user must be able to grant `profile` and have the account and resource permissions needed to retrieve their profile. Scopes do not replace endpoint authorization.

## Configure and start

Install dependencies in an empty directory:

```bash
npm install express express-session dotenv
```

Generate a random session secret and put the output in `SESSION_SECRET` below:

```bash
node --input-type=module -e "import crypto from 'node:crypto'; console.log(crypto.randomBytes(32).toString('hex'))"
```

Create `.env` and replace the placeholders. Keep this file and application secrets out of version control. For public applications, remove `CLIENT_SECRET`. For confidential applications, keep it and supply a valid secret.

```env
AUTH_FRONTEND_URL=https://auth.example.com
APPSERVER_BASE_URL=https://api.example.com
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
SESSION_SECRET=replace_with_generated_value
```

Both origins require HTTPS, with HTTP allowed only on loopback. Do not include a path, query, fragment, or username and password. The example listens on `127.0.0.1:3000` and constructs a fixed callback URI in code. Make sure that port is free.

Save the following as `index.mjs`:

```js
import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import session from 'express-session'

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
const origin = (name) => {
  const url = new URL(required(name))
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(`${name} must be an HTTPS origin (HTTP is allowed only on loopback)`)
  return url.origin
}
const authOrigin = origin('AUTH_FRONTEND_URL')
const apiOrigin = origin('APPSERVER_BASE_URL')
const clientId = required('CLIENT_ID')
const clientSecret = process.env.CLIENT_SECRET?.trim()
const sessionSecret = required('SESSION_SECRET')
if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 random bytes')
}
const localOrigin = 'http://127.0.0.1:3000'
const redirectUri = `${localOrigin}/oauth/callback`
const flowLifetimeMs = 10 * 60 * 1000
const requestTimeoutMs = 15_000
const requestJson = async (pathname, options = {}) => {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Upstream request timed out'))
      controller.abort()
    }, requestTimeoutMs)
  })
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(new URL(pathname, apiOrigin), {
          ...options,
          redirect: 'error',
          signal: controller.signal,
        })
        const data = await response.json()
        return { response, data }
      })(),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}
// This single-process registry makes each flow consumable only once.
const pendingStates = new Set()
const app = express()
app.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  next()
})
// MemoryStore and HTTP cookies are for this loopback demonstration only.
app.use(
  session({
    name: 'oauth_demo_session',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: flowLifetimeMs },
  }),
)

app.get('/login', (req, res, next) => {
  if (req.session.oauth) pendingStates.delete(req.session.oauth.state)
  req.session.regenerate((error) => {
    if (error) return next(error)
    const state = crypto.randomBytes(32).toString('base64url')
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    req.session.oauth = { state, verifier }
    pendingStates.add(state)
    setTimeout(() => pendingStates.delete(state), flowLifetimeMs).unref()
    const url = new URL('/oauth/authorize', authOrigin)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    req.session.save((saveError) => {
      if (saveError) {
        pendingStates.delete(state)
        return next(saveError)
      }
      res.redirect(url.toString())
    })
  })
})

app.get('/oauth/callback', async (req, res, next) => {
  const flow = req.session.oauth
  if (
    !flow ||
    typeof req.query.state !== 'string' ||
    req.query.state !== flow.state ||
    !pendingStates.delete(flow.state)
  )
    return res.status(400).send('Invalid or expired authorization response; restart at /login')

  // Consume synchronously above, then persist removal before any token request.
  delete req.session.oauth
  try {
    await new Promise((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    )
  } catch (error) {
    return next(error)
  }
  if (req.query.error !== undefined) {
    return res.status(400).send('Authorization was not granted; restart at /login')
  }
  if (typeof req.query.code !== 'string' || !req.query.code.trim()) {
    return res.status(400).send('Missing authorization code; restart at /login')
  }

  let stage = 'Token exchange'
  try {
    const { response: tokenResponse, data: token } = await requestJson('/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: req.query.code,
        redirect_uri: redirectUri,
        code_verifier: flow.verifier,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }),
    })
    if (
      !tokenResponse.ok ||
      !token ||
      Array.isArray(token) ||
      typeof token.access_token !== 'string' ||
      !token.access_token.trim() ||
      typeof token.token_type !== 'string' ||
      token.token_type.toLowerCase() !== 'bearer'
    )
      throw new Error('Invalid token response')

    stage = 'Profile request'
    const { response: profileResponse, data: profile } = await requestJson('/v1/users/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    if (
      !profileResponse.ok ||
      !profile ||
      Array.isArray(profile) ||
      profile.code !== 0 ||
      typeof profile.data?.id !== 'string' ||
      !profile.data.id
    )
      throw new Error('Invalid profile response')

    // A real application establishes its own user session here.
    // This demo discards the profile and tokens without returning or logging them.
    return res.send('Authorization succeeded')
  } catch {
    return res.status(502).send(`${stage} failed; restart at /login`)
  }
})

app.use((error, req, res, next) => {
  res.status(500).send('Local session failed; restart at /login')
})
app.listen(3000, '127.0.0.1', () => console.log(`Open ${localOrigin}/login`))
```

Start the server:

```bash
node index.mjs
```

Open `http://127.0.0.1:3000/login` in your browser, sign in on the identity site, and approve authorization. A successful callback displays `Authorization succeeded`. Start and finish in the same browser with the same hostname; do not replace `127.0.0.1` with `localhost`.

## Flow and response formats

1. `/login` regenerates the local session, generates random state, a PKCE verifier, and an S256 challenge, then saves the session before redirecting.
2. The callback checks both session and state and consumes the attempt before network requests. Each attempt is processed at most once, including duplicate or concurrent callbacks. User denial does not call the token endpoint.
3. The server sends JSON to `POST /v1/oauth/token` with the code, exact callback URI, and verifier, plus the Client Secret for confidential applications. Successful token responses use OAuth fields such as `access_token` and `token_type`, without the general business envelope.
4. The server calls `GET /v1/users/me` with the Bearer token. This endpoint uses the business envelope: check HTTP status, numeric `code: 0`, and profile data. HTTP 200 alone is insufficient.

Each upstream request has its own 15-second timeout, including response-body reading. The whole flow does not have a combined 15-second limit. The example rejects upstream redirects and does not automatically retry token exchange or profile lookup. Pending authorization attempts expire after 10 minutes, and session cookies also use a 10-minute lifetime. Restarting the local server invalidates unfinished attempts. Opening `/login` again in the same session replaces the previous attempt.

## Troubleshooting

| Message or symptom                          | What to check                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid configuration at startup            | Check origins, Client ID, and session secret; use the random-secret command above                                                       |
| `Invalid or expired authorization response` | Check cookies, browser session, and hostname; restart at `/login` instead of refreshing or reusing callbacks                            |
| `Authorization was not granted`             | The user denied access or the authorization server returned an error; confirm intent and configuration before restarting                |
| `Missing authorization code`                | The callback has no valid code; restart authorization at `/login`                                                                       |
| `Token exchange failed`                     | Check approval, client type and secret, exact callback, and PKCE; network errors, timeouts, non-JSON responses, and redirects also fail |
| `Profile request failed`                    | Check `profile` consent and account and resource permissions; investigate HTTP and business errors, then restart                        |
| `Local session failed`                      | Local session storage failed; fix the runtime environment and restart                                                                   |

A consumed attempt is not restored. If token exchange times out or disconnects, the local error cannot prove whether the server issued tokens. Do not resend the same authorization code. The example does not display raw upstream responses. Investigate through controlled server diagnostics without logging codes, tokens, secrets, session cookies, or verifiers.

## Changes required for production

The in-memory session store and one-time state set support only local, single-process verification. Production requires HTTPS, secure cookies, trusted proxies configured for the actual topology, persistent sessions, and authorization transaction storage with atomic consumption across instances and expiry cleanup. Manage business user sessions separately from temporary OAuth attempts.

If tokens must be retained, store them securely on the server and handle expiry, refresh rotation, and revocation. The example does not do those steps automatically. Never package Client Secrets into browsers or user devices.

## Related documentation

- [OAuth app management](/en/oauth-app-management)
- [API documentation](/en/api-documentation)
- [Node.js API examples](/en/node-sdk)
- [Python API examples](/en/python-sdk)
