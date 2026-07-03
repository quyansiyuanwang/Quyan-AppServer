# API documentation

This page should be more than an address list. It works best as an **integration hub + SDK reference + runnable example center** so an external developer can move from “I see the endpoint” to “I can ship the integration”.

## What this page should answer

1. **Which base URL should I call?**
2. **Should I use JWT, OAuth, Access Key, or Relay Token?**
3. **Do you provide copy-paste curl / TypeScript / Python examples?**
4. **How should I structure response parsing, pagination, and error handling?**

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

## Recommended documentation structure

A usable API documentation page should contain at least:

- **Endpoint addresses**
- **Authentication guidance**
- **Request examples**
- **Response examples**
- **Error handling notes**
- **SDK samples**
- **A minimal runnable demo**

## Base URLs

Example production endpoints:

```text
API Base URL: https://api.qysyw.cn
Swagger:      https://api.qysyw.cn/docs
OpenAPI JSON: https://api.qysyw.cn/docs/openapi.json
```

Swagger is suitable for inspection and quick testing. For real integration work, the templates below are usually more valuable.

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
  code: number;
  message: string;
  data?: T;
}

export function unwrapApi<T>(response: ApiResponse<T>): T {
  if (response.code !== 0) {
    throw new Error(response.message || `API failed: ${response.code}`);
  }
  return response.data as T;
}
```

## Choosing an authentication method

| Scenario                           | Recommended method | Notes                                        |
| ---------------------------------- | ------------------ | -------------------------------------------- |
| Logged-in browser user             | JWT                | Best for first-party user actions            |
| Third-party delegated access       | OAuth 2.0          | Best for open-platform integrations          |
| Backend script / cron / server app | Access Key         | Best for non-interactive programmatic access |
| Gateway / relay forwarding         | Relay Token        | Best for proxy and relay topologies          |

If this page is intended for external integrators, each authentication mode should ideally include at least one curl sample and one SDK example.

## Minimal curl examples

### 1. JWT-authenticated request

```bash
curl -X GET "https://api.qysyw.cn/users/profile" \
	-H "Authorization: Bearer <access_token>"
```

### 2. Access Key request

```bash
curl -X GET "https://api.qysyw.cn/system/config" \
	-H "Authorization: Bearer <access_key>"
```

> Whether a specific endpoint accepts Access Key authentication still depends on endpoint security and backend policy.

### 3. Paginated list example

```bash
curl -G "https://api.qysyw.cn/oauth-clients/review" \
	-H "Authorization: Bearer <access_token>" \
	--data-urlencode "page=1" \
	--data-urlencode "pageSize=20" \
	--data-urlencode "reviewStatus=pending"
```

## TypeScript SDK example

For browser and Node.js users, a lightweight SDK layer is usually more useful than repeated raw `fetch` calls.

### 1. Generic request helper

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
}

const API_BASE_URL = "https://api.qysyw.cn";

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const json = await response.json();
  if (json.code !== 0) throw new Error(json.message || "Request failed");
  return json.data as T;
}
```

### 2. OAuth app review list example

```ts
export interface OAuthReviewItem {
  id: string;
  name: string;
  clientId: string;
  reviewStatus: "draft" | "pending" | "approved" | "rejected";
  reviewComment?: string;
}

export interface OAuthReviewListResponse {
  items: OAuthReviewItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listOAuthAppsForReview(token: string) {
  return apiRequest<OAuthReviewListResponse>(
    "/oauth-clients/review?page=1&pageSize=20",
    {
      token,
    },
  );
}
```

### 3. Review action example

```ts
export async function reviewOAuthApp(
  token: string,
  id: string,
  reviewStatus: "approved" | "rejected",
  reviewComment?: string,
) {
  return apiRequest(`/oauth-clients/${id}/review`, {
    method: "POST",
    token,
    body: {
      reviewStatus,
      reviewComment,
    },
  });
}
```

## Python example

Backend integrators often benefit more from a practical Python sample than from a plain parameter table.

```python
import requests

API_BASE_URL = "https://api.qysyw.cn"
ACCESS_TOKEN = "<access_token>"

response = requests.get(
		f"{API_BASE_URL}/oauth-clients/review",
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

If the docs site is meant to feel like a real open-platform documentation center, it should include at least one full authorization-code flow example.

### Step 1: Redirect to the authorization page

```text
GET https://api.qysyw.cn/oauth/authorize
	?response_type=code
	&client_id=oc_live_xxx
	&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fcallback
	&scope=profile%20email
	&state=random-csrf-token
	&code_challenge=pkce-challenge
	&code_challenge_method=S256
```

### Step 2: Exchange the code on the backend

```bash
curl -X POST "https://api.qysyw.cn/oauth/token" \
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

The documentation should explicitly tell integrators that:

- `page` is the page number, usually starting at `1`
- `pageSize` is the number of rows per page
- the backend may enforce a maximum, such as `pageSize <= 100`

Recommended usage:

```ts
const page = 1;
const pageSize = 20;
```

## Error handling guidance

Documentation should not only show success cases. It should also show how failures are handled.

```ts
try {
  const data = await listOAuthAppsForReview(token);
  console.log(data.items);
} catch (error) {
  console.error("Load failed:", error);
  // Recommended: toast, retry, fallback message, telemetry
}
```

## Minimum demo checklist for the docs site

Recommended follow-up additions:

1. **curl demos** for quick validation
2. **TypeScript demos** for frontend and Node.js projects
3. **Python demos** for backend scripts and ops tooling
4. **Full OAuth flow demos** for open-platform consumers
5. **Error-code and retry guidance** for production-grade integration

## Recommended reading order

1. Start here for base URLs and auth strategy.
2. Use Swagger to confirm exact fields.
3. Continue with `oauth-app-management` for OAuth onboarding.
4. Read `access-key-management` or `relay-token-management` for programmatic credentials.

## Related pages

- `oauth-app-management`
- `access-key-management`
- `relay-token-management`
- `json-endpoint-management`
