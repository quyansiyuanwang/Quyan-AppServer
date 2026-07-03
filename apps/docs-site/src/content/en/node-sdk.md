# Node SDK

Best for Node.js backends, TypeScript / JavaScript integrations, and server-side jobs.

<div class="docs-jump-grid">
  <a class="docs-jump-card current" href="/en/node-sdk">
    <span class="docs-jump-eyebrow">Current page</span>
    <strong>Node SDK</strong>
    <span>Call the API from a Node.js service with one shared place for auth, errors, and response unwrapping.</span>
  </a>
  <a class="docs-jump-card" href="/en/python-sdk">
    <span class="docs-jump-eyebrow">Switch stack</span>
    <strong>Python SDK</strong>
    <span>Use this version when the integrator is a Python backend, script, or automation worker.</span>
  </a>
  <a class="docs-jump-card" href="/en/oauth-demo">
    <span class="docs-jump-eyebrow">Third-party login</span>
    <strong>OAuth Demo</strong>
    <span>Continue there if you need authorization-code flow, redirect URIs, or PKCE.</span>
  </a>
</div>

## Smallest use case

If you do not need OAuth login and only want to call a business API from your backend, start here.

## Suggested structure

```text
ServerSDK/sdks/oauth/node/
├─ package.json
├─ .env
└─ src/index.mjs
```

## `package.json`

```json
{
  "name": "quyan-oauth-sdk-node",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node index.js"
  }
}
```

## `.env`

```env
APPSERVER_BASE_URL=http://localhost:10001
ACCESS_TOKEN=your_access_token
```

## `index.js`

```js
import "dotenv/config";

const apiBaseUrl = process.env.APPSERVER_BASE_URL;
const accessToken = process.env.ACCESS_TOKEN;

const response = await fetch(new URL("/api/user/profile", apiBaseUrl), {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

const data = await response.json();
console.log(JSON.stringify(data, null, 2));
```

## Run it

```bash
pnpm install
pnpm dev
```

## Suggested practices

- Keep tokens in environment variables, not in source files.
- Add a small shared error-handling layer around `fetch`.
- Normalize the `{ code, message, data }` response shape in one place.

## Suggested helper wrapper

```js
export async function callApi(path, token, init = {}) {
  const response = await fetch(`http://localhost:10001${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const payload = await response.json();

  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `Request failed: ${response.status}`);
  }

  return payload.data;
}
```

## Full shared response-unwrapping helper

If the service will call more than one endpoint, extract the client into a reusable file such as `appserver-client.js`.

### `appserver-client.js`

```js
export class AppServerApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppServerApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? -1;
    this.payload = options.payload;
    this.requestId = options.requestId;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

function joinUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new AppServerApiError("Response is not valid JSON", {
      status: response.status,
      payload: text,
      requestId: response.headers.get("x-request-id") || undefined,
    });
  }
}

async function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function callAppServer({
  baseUrl,
  path,
  token,
  method = "GET",
  headers = {},
  query,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const url = new URL(joinUrl(baseUrl, path));

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  const requestHeaders = {
    Accept: "application/json",
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const response = await withTimeout(
    (signal) =>
      fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      }),
    timeoutMs,
  ).catch((error) => {
    if (error?.name === "AbortError") {
      throw new AppServerApiError(`Request timeout after ${timeoutMs}ms`, {
        status: 408,
      });
    }

    throw error;
  });

  const payload = await parseJsonSafe(response);
  const requestId = response.headers.get("x-request-id") || undefined;

  if (!response.ok) {
    throw new AppServerApiError(
      payload?.message || `HTTP request failed with status ${response.status}`,
      {
        status: response.status,
        code: payload?.code,
        payload,
        requestId,
      },
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new AppServerApiError("Response payload is empty", {
      status: response.status,
      payload,
      requestId,
    });
  }

  if (payload.code !== 0) {
    throw new AppServerApiError(payload.message || "Business request failed", {
      status: response.status,
      code: payload.code,
      payload,
      requestId,
    });
  }

  return {
    data: payload.data,
    message: payload.message,
    code: payload.code,
    requestId,
    raw: payload,
  };
}

export async function getUserProfile({ baseUrl, token }) {
  const result = await callAppServer({
    baseUrl,
    path: "/api/user/profile",
    token,
  });

  return result.data;
}
```

### `index.js`

```js
import "dotenv/config";
import { callAppServer, getUserProfile } from "./appserver-client.js";

const baseUrl = process.env.APPSERVER_BASE_URL;
const accessToken = process.env.ACCESS_TOKEN;

const profile = await getUserProfile({
  baseUrl,
  token: accessToken,
});

console.log("profile =>", profile);

const usage = await callAppServer({
  baseUrl,
  path: "/api/user/balance-history",
  token: accessToken,
  query: { page: 1, pageSize: 20 },
});

console.log("balance history =>", usage.data);
```

### What this version fixes

- unwraps `{ code, message, data }` in one place
- checks both HTTP status and business `code`
- throws one consistent error type for timeout, invalid JSON, and business failures
- keeps `requestId` for log tracing

## Common issues

### 401 response

- token expired
- token belongs to another environment
- missing `Authorization` header

### 403 response

- authenticated but not permitted
- token lacks the required access scope or role

## Recommended follow-up reading

- `API Documentation`
- Swagger
- `OAuth Demo` if you later need third-party login

<div class="docs-jump-grid">
  <a class="docs-jump-card" href="/en/python-sdk">
    <span class="docs-jump-eyebrow">Next</span>
    <strong>Open Python SDK</strong>
    <span>Compare the Python version if your team maintains multiple backend stacks.</span>
  </a>
  <a class="docs-jump-card" href="/en/oauth-demo">
    <span class="docs-jump-eyebrow">Extended flow</span>
    <strong>Open OAuth Demo</strong>
    <span>Continue there if you also need third-party login or authorization-code flow.</span>
  </a>
</div>
