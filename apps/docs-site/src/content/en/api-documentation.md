# API documentation

Learn about endpoint addresses, authentication, request examples, and error handling. Consult the API reference for each endpoint’s fields and permissions.

## What you will see

### Endpoint tab

- Base URL
- Provider URL
- Balance URL
- Platform-balance URL
- Copy buttons
- Full endpoint path toggle

### Pricing tab

- Filterable pricing list
- Model or provider views
- Refresh action
- Custom multiplier / token-unit toggles

## Base URLs

Example production endpoints:

```text
API Base URL: https://api.qysyw.cn
Swagger:      https://api.qysyw.cn/docs
OpenAPI JSON: https://api.qysyw.cn/docs/openapi.json
```

Swagger is suitable for inspection and quick testing. For real integration work, the templates below are usually more valuable.

## AI relay quick start

Use the **AI Relay Console**, not the browser-login API, when you need to call an AI model. The shortest path is:

1. Open **Relay token management**, select **Create token**, choose available channels or an automatic proxy pool, and save the token.
2. Copy the **Relay Base URL** from the top of the creation drawer or the endpoint tab in **API documentation**. It is the public relay address for your deployment and can differ from the admin site and backend API address.
3. Keep the token in a server-side environment variable and send it as `Authorization: Bearer <relay_token>` to relay endpoints.
4. Call `/v1/models` first to see the models available to this token, then choose a matching request format.

Replace `https://relay.example.com` below with the Relay Base URL displayed by the console. Do not guess it or substitute an admin-site domain.

```bash
# List the models available to this token
curl "https://relay.example.com/v1/models" \
  -H "Authorization: Bearer <relay_token>"

# OpenAI Chat Completions-compatible request
curl "https://relay.example.com/v1/chat/completions" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-model",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

A Relay Token is only for relay requests, not for signing in to the admin site. Its channels, enabled models, request formats, quotas, IP allowlist, and status determine whether a request can run. For `401`, `403`, or unavailable-model errors, inspect those settings in Relay token management first.

## Unified response format

Most backend APIs follow a consistent wrapper:

```json
{
  "code": 0,
  "message": "Success",
  "data": {}
}
```

Recommended interpretation:

- `code === 0`: success
- `code !== 0`: business failure
- `message`: log or display text
- `data`: actual payload

### TypeScript unwrap helper

```ts
export interface ApiResponse<T> {
  code: number
  message: string
  data?: T
}

export function unwrapApi<T>(response: ApiResponse<T>): T {
  if (response.code !== 0) {
    throw new Error(response.message || `API failed: ${response.code}`)
  }
  return response.data as T
}
```

## Choosing an authentication method

| Scenario                           | Recommended method | Notes                                        |
| ---------------------------------- | ------------------ | -------------------------------------------- |
| Logged-in browser user             | JWT                | Best for first-party user actions            |
| Third-party delegated access       | OAuth 2.0          | Best for open-platform integrations          |
| Backend script / cron / server app | Access Key         | Best for non-interactive programmatic access |
| Gateway / relay forwarding         | Relay Token        | Best for proxy and relay topologies          |

Before making a request, confirm that the token has the required permissions. OAuth tokens also need the appropriate scopes.

## OpenAI image-edit relay

When calling the OpenAI-compatible `/v1/images/edits` endpoint with a Relay Token, send multiple reference images as repeated `image[]` fields. The relay also accepts repeated legacy `image` fields and normalizes them to `image[]` before forwarding, while preserving image order, masks, and other form fields.

```bash
curl -X POST "https://relay.example.com/v1/images/edits" \
	-H "Authorization: Bearer <relay_token>" \
	-F "model=gpt-image-2" \
	-F "image[]=@first.png" \
	-F "image[]=@second.png" \
	-F "prompt=Combine the subjects from both reference images into a new image"
```

New integrations should always use `image[]`. Whether a selected model actually understands or combines multiple references still depends on that model and its upstream channel.

## OpenAI text relay formats

Relay manages the two OpenAI v1 text APIs as separate formats:

- **OpenAI Chat Completions**: `/v1/chat/completions`, with a `messages` request body.
- **OpenAI Responses**: `/v1/responses`, with an `input` request body.

Before calling either API, both the Relay Token's channel and the selected model must explicitly enable that format. Legacy OpenAI entries remain compatible as Chat Completions only; Responses are never enabled automatically.

### OpenAI Responses example

```bash
curl "https://relay.example.com/v1/responses" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-model",
    "input": "Hello"
  }'
```

Other compatible formats (Anthropic or Gemini) are available only when explicitly enabled for the token's channels. Use the API documentation page in the console as the source of truth for paths and request fields.

## Minimal curl examples

### 1. JWT-authenticated request

```bash
curl -X GET "https://api.qysyw.cn/v1/users/me" \
	-H "Authorization: Bearer <access_token>"
```

### 2. Access Key request

```bash
curl -X GET "https://api.qysyw.cn/v1/users/me" \
	-H "Authorization: Bearer <access_key>"
```

> Whether a specific endpoint accepts Access Key authentication still depends on endpoint security and backend policy.

### 3. Paginated list example

This endpoint lists OAuth applications for review and requires the appropriate review permission.

```bash
curl -G "https://api.qysyw.cn/v1/oauth-clients/review" \
	-H "Authorization: Bearer <access_token>" \
	--data-urlencode "page=1" \
	--data-urlencode "pageSize=20" \
	--data-urlencode "reviewStatus=pending"
```

## TypeScript SDK example

For browser and Node.js users, a lightweight SDK layer is usually more useful than repeated raw `fetch` calls.

### 1. Generic request helper

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOptions {
  method?: HttpMethod
  token?: string
  body?: unknown
}

const API_BASE_URL = 'https://api.qysyw.cn'

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  })

  const json = await response.json()
  if (!response.ok || json.code !== 0)
    throw new Error(json.message || `Request failed: ${response.status}`)
  return json.data as T
}
```

### 2. OAuth app review list example

```ts
export interface OAuthReviewItem {
  id: string
  name: string
  clientId: string
  reviewStatus: 'draft' | 'pending' | 'approved' | 'rejected'
  reviewComment?: string
}

export interface OAuthReviewListResponse {
  items: OAuthReviewItem[]
  total: number
  page: number
  pageSize: number
}

export async function listOAuthAppsForReview(token: string) {
  return apiRequest<OAuthReviewListResponse>('/v1/oauth-clients/review?page=1&pageSize=20', {
    token,
  })
}
```

### 3. Review action example

```ts
export async function reviewOAuthApp(
  token: string,
  id: string,
  reviewStatus: 'approved' | 'rejected',
  reviewComment?: string,
) {
  return apiRequest(`/v1/oauth-clients/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    token,
    body: {
      reviewStatus,
      reviewComment,
    },
  })
}
```

## Python example

Backend integrators often benefit more from a practical Python sample than from a plain parameter table.

```python
import requests

API_BASE_URL = "https://api.qysyw.cn"
ACCESS_TOKEN = "<access_token>"

response = requests.get(
		f"{API_BASE_URL}/v1/oauth-clients/review",
		headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
		params={"page": 1, "pageSize": 20, "reviewStatus": "pending"},
		timeout=15,
)
response.raise_for_status()

payload = response.json()
if payload["code"] != 0:
		raise RuntimeError(payload["message"])

for item in payload["data"]["items"]:
		print(item["name"], item["reviewStatus"])
```

## OAuth authorization-code demo

Before using this flow, create an application, register its callback URI, and obtain approval. See the [OAuth example](/en/oauth-demo) for the complete flow.

### Step 1: Redirect to the authorization page

```text
GET https://auth.qysyw.cn/oauth/authorize
	?response_type=code
	&client_id=oc_live_xxx
	&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fcallback
	&scope=profile%20email
	&state=random-csrf-token
	&code_challenge=pkce-challenge
	&code_challenge_method=S256
```

The authorization page is hosted by the identity site. `https://api.qysyw.cn/v1/oauth/authorize` is the authenticated API called by that page and should not be opened directly in a browser address bar.

### Step 2: Exchange the code on the backend

```bash
curl -X POST "https://api.qysyw.cn/v1/oauth/token" \
	-H "Content-Type: application/json" \
	-d '{
		"grant_type": "authorization_code",
		"client_id": "oc_live_xxx",
		"client_secret": "oc_secret_xxx",
		"code": "returned_code",
		"redirect_uri": "https://demo.example.com/callback",
		"code_verifier": "pkce-verifier"
	}'
```

## Pagination guidance

Pagination parameters vary by endpoint; consult its API reference. Common parameters include:

- `page` is the page number, usually starting at `1`
- `pageSize` is the number of rows per page
- the backend may enforce a maximum, such as `pageSize <= 100`

Recommended usage:

```ts
const page = 1
const pageSize = 20
```

## Generated OpenAPI specification access

`GET /docs/openapi.json` returns the raw generated OpenAPI document without the standard response envelope. Trusted local access retains the `local-or-jwt` authentication behavior. Remote JWT access requires `DEBUG_OPENAPI_READ`; with IAM enforcement, eligibility must come from a real deployment-wide group and the request must allow `quyan:system:GetOpenApiSpecification` on `acs:platform:*:platform:system/openapi-spec`.

The path and Action are fixed by the server. Query parameters and headers cannot select another file or grant access. If authorization or the current role session becomes invalid during the read, the document is withheld. A matching Deny overrides Allow.

## Error handling guidance

Handle failed responses and decide whether to retry based on the error.

```ts
try {
  const data = await listOAuthAppsForReview(token)
  console.log(data.items)
} catch (error) {
  console.error('Load failed:', error)
  // Recommended: toast, retry, fallback message, telemetry
}
```

### Common `code` values

`code` is the business-level status returned inside the response body (see "Unified response format" above) — it is separate from the HTTP status code. A `200 OK` HTTP response can still carry a non-zero `code` describing a business failure.

| `code` | Meaning                            | Typical response                                       |
| ------ | ---------------------------------- | ------------------------------------------------------ |
| `0`    | Success                            | Use `data` as-is                                       |
| `1001` | Authentication failed              | Prompt re-login                                        |
| `1002` | Request validation failed          | Fix the request body/params, do not retry              |
| `1003` | Resource not found                 | Do not retry; surface a not-found state                |
| `1004` | Permission denied                  | Do not retry; the token lacks the required permission  |
| `1006` | Token expired due to a data update | Refresh the token, then retry once                     |
| `1013` | Token expired                      | Refresh the token, then retry once                     |
| `1014` | Token invalid or forged            | Do not retry; force re-login                           |
| `1017` | Replay protection failed           | Fetch a fresh signing session and retry once           |
| `1018` | Two-factor verification required   | Complete the 2FA challenge, then retry                 |
| `1048` | Password encryption key is stale   | Fetch the public key again, re-encrypt, and retry once |
| `1429` | Rate limited (too many requests)   | Back off using the suggested retry delay               |

The full list lives in `CustomCode` (`packages/shared/src/custom-code.ts`) and grows over time — treat unrecognized codes as generic business failures rather than assuming a specific meaning.

### Retry guidance

- Only retry on codes that represent a transient state (token refresh, replay-protection session renewal, rate limiting). Retrying `1002`/`1003`/`1004`/`1014` will fail identically every time since the request itself is the problem.
- For `1429` (rate limited), respect any suggested retry-after delay in the response rather than retrying immediately.
- Cap automatic retries at 1-2 attempts; surface the error to the user or calling system after that instead of looping.

## Recommended reading order

1. Start here for base URLs and auth strategy.
2. Use Swagger to confirm exact fields.
3. Continue with `oauth-app-management` for OAuth onboarding.
4. Read `access-key-management` or `relay-token-management` for programmatic credentials.

## Related pages

- [OAuth app management]({{DOCS_BASE_URL}}/en/oauth-app-management)
- [Access key management]({{DOCS_BASE_URL}}/en/access-key-management)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
- [JSON endpoint management]({{DOCS_BASE_URL}}/en/json-endpoint-management)
