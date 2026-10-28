# OAuth authorization-code example

This example uses the authorization-code flow with PKCE (S256), then retrieves the user's profile from a backend service.

## Before you begin

1. Create an application in [OAuth app management](/en/oauth-app-management), register `http://127.0.0.1:3000/oauth/callback`, select the `profile` scope, and submit it for review. Authorization is available after approval.
2. Confirm the identity-site URL and API base URL. The browser visits `/oauth/authorize` on the identity site; the backend calls `/v1/oauth/token` on the API. These can be different sites.
3. Use Node.js 20 or later. Confidential clients need a client secret; public clients omit it.

## Run locally

Create an empty directory and install the dependencies:

```bash
npm install express express-session dotenv
```

Create `.env` and replace the placeholders with your configuration. Use a long, randomly generated `SESSION_SECRET` and keep this file out of version control.

```env
AUTH_FRONTEND_URL=https://auth.example.com
APPSERVER_BASE_URL=https://api.example.com
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://127.0.0.1:3000/oauth/callback
SESSION_SECRET=replace_with_a_long_random_secret
```

For a public client, remove `CLIENT_SECRET`. Save the following as `index.mjs`, run `node index.mjs`, and open `http://127.0.0.1:3000/login`.

```js
import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import session from 'express-session'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
const authBaseUrl = required('AUTH_FRONTEND_URL')
const apiBaseUrl = required('APPSERVER_BASE_URL')
const clientId = required('CLIENT_ID')
const redirectUri = required('REDIRECT_URI')
const clientSecret = process.env.CLIENT_SECRET
const app = express()

// The default MemoryStore is for local development only.
app.use(
  session({
    secret: required('SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 10 * 60 * 1000 },
  }),
)

app.get('/login', (req, res, next) => {
  req.session.regenerate((error) => {
    if (error) return next(error)
    const state = crypto.randomBytes(32).toString('base64url')
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    req.session.oauth = { state, verifier }

    const url = new URL('/oauth/authorize', authBaseUrl)
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
      if (saveError) return next(saveError)
      res.redirect(url.toString())
    })
  })
})

app.get('/oauth/callback', async (req, res) => {
  const flow = req.session.oauth
  delete req.session.oauth
  if (
    !flow ||
    typeof req.query.state !== 'string' ||
    req.query.state !== flow.state ||
    typeof req.query.code !== 'string' ||
    !req.query.code
  ) {
    return res.status(400).send('Invalid or expired authorization response')
  }

  try {
    const body = {
      grant_type: 'authorization_code',
      client_id: clientId,
      code: req.query.code,
      redirect_uri: redirectUri,
      code_verifier: flow.verifier,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }
    const tokenResponse = await fetch(new URL('/v1/oauth/token', apiBaseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const token = await tokenResponse.json()
    if (!tokenResponse.ok || !token.access_token)
      return res.status(502).send('Token exchange failed')

    const profileResponse = await fetch(new URL('/v1/users/me', apiBaseUrl), {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    })
    const profile = await profileResponse.json()
    if (!profileResponse.ok || profile.code !== 0)
      return res.status(502).send('Profile request failed')
    // Establish your own application session here; do not expose or log the tokens.
    return res.send('Authorization succeeded')
  } catch {
    return res.status(502).send('Authorization service unavailable')
  }
})

app.listen(3000, '127.0.0.1', () => console.log('Open http://127.0.0.1:3000/login'))
```

After authorization, the backend checks the one-time `state`, exchanges the code using the session's `code_verifier`, and requests the current user's profile. The example displays only success or failure; tokens are not returned to the browser.

## Deployment and troubleshooting

- This example is for local verification. For production, use HTTPS, persistent session storage, and secure cookies; configure trusted proxies appropriately for your deployment. The default in-memory session store is not suitable for production.
- `Invalid or expired authorization response`: restart sign-in, allow session cookies, and use the same browser session that started the flow.
- Token exchange fails: check approval, client type and secret, the exact registered callback URI, and the PKCE values for the same authorization attempt.
- Profile lookup fails: confirm the application can request `profile`, the user granted it, and the account and resource permissions allow access.
- Do not log authorization codes, tokens, client secrets, session cookies, or PKCE verifiers when troubleshooting.

## Related documentation

- [OAuth app management](/en/oauth-app-management)
- [API documentation](/en/api-documentation)
- [Node SDK](/en/node-sdk)
- [Python SDK](/en/python-sdk)
