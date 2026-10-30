# Node.js API example

Call Quyan APIs from a Node.js service or background job with a copyable `fetch` wrapper. No platform-specific SDK package is required.

## Prerequisites

Use Node.js 22.12 or later and pnpm. Run these examples on the server.

This example starts with an authorized credential; it does not log in, exchange authorization codes, or refresh tokens. Use a login access token for this deployment, or a third-party OAuth access token with the scopes below. Account AccessKeys work only where the service permits them. Relay Tokens and OJ API Keys are separate credentials.

| Request                                          | Purpose                                               | OAuth scope    | Action under IAM enforcement     |
| ------------------------------------------------ | ----------------------------------------------------- | -------------- | -------------------------------- |
| `GET /v1/users/me`                               | Profile of the current credential's user              | `profile`      | `quyan:user:GetCurrentUser`      |
| `GET /v1/balance/transactions?limit=20&offset=0` | First page of the current user's balance transactions | `balance:read` | `quyan:balance:ListTransactions` |

Both operations target the current identity's user resource. Scopes do not replace resource authorization, and a matching Deny can reject the request. Run the profile request first; enable the optional transaction request only when authorized.

## 1. Create the example directory

```text
example/
├─ package.json
├─ .env
├─ .gitignore
├─ appserver-client.mjs
└─ index.mjs
```

`package.json`:

```json
{
  "name": "quyan-api-example",
  "private": true,
  "scripts": {
    "dev": "node --env-file=.env index.mjs"
  }
}
```

## 2. Configure the address and credential

Replace both placeholders in `.env`. Use the API origin for your deployment, without `/v1`, and use HTTPS in production. Missing configuration fails before an anonymous request or guessed address is used.

```env
APPSERVER_BASE_URL=https://api.example.com
ACCESS_TOKEN=replace_with_authorized_access_token
```

Add to `.gitignore`:

```gitignore
.env
node_modules/
```

## 3. Save the request wrapper

Save as `appserver-client.mjs`:

```js
export class AppServerApiError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message)
    this.name = 'AppServerApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

const DEFAULT_TIMEOUT_MS = 15000

export async function callAppServer({
  baseUrl,
  token,
  path,
  query = {},
  method = 'GET',
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!baseUrl?.trim() || !token?.trim()) {
    throw new Error('Set APPSERVER_BASE_URL and ACCESS_TOKEN')
  }
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    throw new Error('APPSERVER_BASE_URL must be an HTTP(S) origin')
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('APPSERVER_BASE_URL must be an HTTP(S) origin')
  }
  if (typeof path !== 'string' || !path.startsWith('/v1/')) {
    throw new Error('Use an API path beginning with /v1/')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive number')
  }
  const url = new URL(path, base)
  if (url.origin !== base.origin) throw new Error('Unexpected API origin')
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('Query values must be strings, numbers, or booleans')
    }
    url.searchParams.set(key, String(value))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let status
  let requestId
  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token.trim()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    status = response.status
    requestId = response.headers.get('x-request-id') || undefined
    let payload
    try {
      payload = await response.json()
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new AppServerApiError('Response is not valid JSON', { status, requestId })
    }
    const isEnvelope =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof payload.code === 'number'
    const code = isEnvelope ? payload.code : undefined
    if (!response.ok || !isEnvelope || code !== 0) {
      throw new AppServerApiError('API request failed', { status, code, requestId })
    }
    return { data: payload.data, requestId }
  } catch (error) {
    if (error instanceof AppServerApiError) throw error
    throw new AppServerApiError(
      controller.signal.aborted ? 'Request timed out' : 'Request could not complete',
      { status, requestId },
    )
  } finally {
    clearTimeout(timer)
  }
}
```

Success requires HTTP 2xx, a JSON object, and numeric `code: 0`; the result is `{ data, requestId }`. A business failure throws even with HTTP 200. The default 15-second timeout covers waiting for the response and reading JSON. Network failures do not fabricate HTTP 408 or 500. Query values support strings, numbers, and booleans; null and undefined are omitted.

## 4. Call and run

Save as `index.mjs`:

```js
import { callAppServer, AppServerApiError } from './appserver-client.mjs'

try {
  const options = {
    baseUrl: process.env.APPSERVER_BASE_URL,
    token: process.env.ACCESS_TOKEN,
  }
  const { data: profile } = await callAppServer({
    ...options,
    path: '/v1/users/me',
  })
  if (!profile || typeof profile.id !== 'string') {
    throw new Error('Unexpected profile data')
  }
  console.log('Profile request succeeded')

  // Optional: requires balance:read for an OAuth token.
  // const { data: history } = await callAppServer({
  //   ...options,
  //   path: '/v1/balance/transactions',
  //   query: { limit: 20, offset: 0 },
  // })
  // console.log('Records on this page:', history.records.length)
} catch (error) {
  console.error(error.message)
  if (error instanceof AppServerApiError) {
    console.error(
      JSON.stringify({
        status: error.status,
        code: error.code,
        requestId: error.requestId,
      }),
    )
  }
  process.exitCode = 1
}
```

Run from the example directory:

```bash
pnpm dev
```

Success prints `Profile request succeeded` without personal information; failure prints diagnostics and exits with a nonzero status. No Node.js dependencies need installing. Existing environment variables override `.env`; check the shell environment when changing deployments.

## Transaction pagination and writes

When the optional transaction call is enabled, `history.records` is only the current page and `history.total` is the matching total. Use `offset: 20` for the next page and increment by page size; the first page is not complete history.

The wrapper does not refresh credentials or retry. Before adding a write endpoint, check API requirements for permissions, replay protection, and two-factor verification; these interactions are not implemented here. If a network failure or timeout leaves a write outcome unknown, query its result before retrying with an idempotency mechanism supported by that endpoint.

## Troubleshooting

| Symptom or business code             | What to check                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Missing configuration or invalid URL | Check `.env`; use the API HTTP(S) origin without `/v1`, a path, query, or embedded credentials               |
| Non-JSON, 3xx, or HTML               | Check for a frontend, documentation, or redirecting address; the template does not follow redirects          |
| `1001`, `1014`, or HTTP 401          | Check credential type, environment, validity, and the `Authorization` header                                 |
| `1006`                               | User state changed; authenticate again                                                                       |
| `1013`                               | Refresh the expired token through its own authentication flow; authenticate again if refresh fails           |
| `1004` or HTTP 403                   | Check OAuth scopes, action/resource grants, account or role state, and explicit Deny                         |
| `1429` or HTTP 429                   | Reduce request frequency and use server rate-limit information before deciding to retry                      |
| Timeout or connection failure        | Check the network and service; no HTTP status does not establish that the server did not process the request |

Error output contains a general message, HTTP status, business code, and request ID when supplied by the server. Do not paste credentials, full responses, or personal information into public logs.

## Related pages

- [API documentation]({{DOCS_BASE_URL}}/en/api-documentation)
- [API reference]({{SWAGGER_DOCS_URL}})
- [Python API example]({{DOCS_BASE_URL}}/en/python-sdk)
- [OAuth authorization-code example]({{DOCS_BASE_URL}}/en/oauth-demo)
- [AccessKey management]({{DOCS_BASE_URL}}/en/access-key-management)
