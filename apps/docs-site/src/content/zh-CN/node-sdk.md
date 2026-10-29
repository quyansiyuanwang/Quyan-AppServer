# Node SDK

适合：Node.js 服务端、TypeScript / JavaScript API 集成、后台任务调用。

本页提供基于 Node.js `fetch` 的 API 调用示例和可自行维护的封装代码；无需安装平台专用 SDK 包。

<div class="docs-jump-grid">
  <a class="docs-jump-card current" href="/zh-CN/node-sdk">
    <span class="docs-jump-eyebrow">当前页</span>
    <strong>Node SDK</strong>
    <span>直接从 Node.js 服务端调用 API，并统一处理鉴权、异常与响应解包。</span>
  </a>
  <a class="docs-jump-card" href="/zh-CN/python-sdk">
    <span class="docs-jump-eyebrow">切换语言栈</span>
    <strong>Python SDK</strong>
    <span>如果你的接入方是 Python 服务、脚本或自动化任务，请跳到这个模板。</span>
  </a>
  <a class="docs-jump-card" href="/zh-CN/oauth-demo">
    <span class="docs-jump-eyebrow">第三方登录</span>
    <strong>OAuth Demo</strong>
    <span>需要做授权码流程、回调地址、PKCE 或第三方登录时，从这里继续。</span>
  </a>
</div>

## 最小使用场景

如果你不是做 OAuth 登录，而只是想从服务端直接调用业务 API，那么可以先从这个模板开始。运行以下命令需要 Node.js 20 或更高版本及 pnpm。

## 推荐目录

```text
example/
├─ package.json
├─ .env
└─ index.js
```

## `package.json`

```json
{
  "name": "quyan-oauth-sdk-node",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node index.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  }
}
```

示例使用已获得授权的访问令牌；第三方 OAuth 令牌访问用户资料需要 `profile` scope，访问余额记录需要 `balance:read` scope。具体资源权限仍由服务端控制。请将 `.env` 排除在版本控制之外。

## `.env`

将示例地址和令牌替换为当前部署的 API 基础地址及已获授权的访问令牌。

```env
APPSERVER_BASE_URL=http://localhost:10001
ACCESS_TOKEN=your_access_token
```

## `index.js`

```js
import 'dotenv/config'

const apiBaseUrl = process.env.APPSERVER_BASE_URL
const accessToken = process.env.ACCESS_TOKEN

const response = await fetch(new URL('/v1/users/me', apiBaseUrl), {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
})

const data = await response.json()
console.log(JSON.stringify(data, null, 2))
```

## 运行方式

```bash
pnpm install
pnpm dev
```

## 建议做法

- 把 token 放在环境变量里，不要写死进代码。
- 给 `fetch` 外层补一层统一错误处理。
- 对 `code`、`message`、`data` 结构做统一解包。

## 建议封装一个小型调用器

```js
export async function callApi(path, token, init = {}) {
  const response = await fetch(`http://localhost:10001${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  const payload = await response.json()

  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `Request failed: ${response.status}`)
  }

  return payload.data
}
```

## 完整版统一响应解包工具

如果你的服务端会调用多个接口，请将以下调用器保存为与 `index.js` 同目录的 `appserver-client.js`，并将前面的 `index.js` 替换为下方完整版，再运行示例。

### `appserver-client.js`

```js
export class AppServerApiError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'AppServerApiError'
    this.status = options.status ?? 500
    this.code = options.code ?? -1
    this.payload = options.payload
    this.requestId = options.requestId
  }
}

const DEFAULT_TIMEOUT_MS = 15000

function joinUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString()
}

async function parseJsonSafe(response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    throw new AppServerApiError('Response is not valid JSON', {
      status: response.status,
      payload: text,
      requestId: response.headers.get('x-request-id') || undefined,
    })
  }
}

async function withTimeout(promise, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await promise(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export async function callAppServer({
  baseUrl,
  path,
  token,
  method = 'GET',
  headers = {},
  query,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const url = new URL(joinUrl(baseUrl, path))

  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  const requestHeaders = {
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  }

  const { response, payload } = await withTimeout(async (signal) => {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    const payload = await parseJsonSafe(response)
    return { response, payload }
  }, timeoutMs).catch((error) => {
    if (error?.name === 'AbortError') {
      throw new AppServerApiError(`Request timeout after ${timeoutMs}ms`, {
        status: 408,
      })
    }

    throw error
  })

  const requestId = response.headers.get('x-request-id') || undefined

  if (!response.ok) {
    throw new AppServerApiError(
      payload?.message || `HTTP request failed with status ${response.status}`,
      {
        status: response.status,
        code: payload?.code,
        payload,
        requestId,
      },
    )
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppServerApiError('Response payload is not a JSON object', {
      status: response.status,
      payload,
      requestId,
    })
  }

  if (payload.code !== 0) {
    throw new AppServerApiError(payload.message || 'Business request failed', {
      status: response.status,
      code: payload.code,
      payload,
      requestId,
    })
  }

  return {
    data: payload.data,
    message: payload.message,
    code: payload.code,
    requestId,
    raw: payload,
  }
}

export async function getUserProfile({ baseUrl, token }) {
  const result = await callAppServer({
    baseUrl,
    path: '/v1/users/me',
    token,
  })

  return result.data
}
```

### `index.js`

```js
import 'dotenv/config'
import { callAppServer, getUserProfile } from './appserver-client.js'

const baseUrl = process.env.APPSERVER_BASE_URL
const accessToken = process.env.ACCESS_TOKEN

const profile = await getUserProfile({
  baseUrl,
  token: accessToken,
})

console.log('profile =>', profile)

const usage = await callAppServer({
  baseUrl,
  path: '/v1/balance/transactions',
  token: accessToken,
  query: { limit: 20, offset: 0 },
})

console.log('balance history =>', usage.data)
```

### 这个版本解决了什么

- 自动解包 `{ code, message, data }`
- 同时检查 HTTP 状态码和业务 `code`
- 为超时、非 JSON 响应、业务错误统一抛出异常
- 保留 `requestId`，方便后续排查日志

## 常见问题

### 返回 401

- token 已过期
- token 不属于当前环境
- 请求头没有带上 `Authorization`

### 返回 403

- 当前账号无权限
- token 已登录，但没有目标资源访问范围

## 推荐联动阅读

- [API 文档](/zh-CN/api-documentation)
- [API 参考]({{SWAGGER_DOCS_URL}})
- [OAuth 授权码示例](/zh-CN/oauth-demo)（用于第三方登录）

<div class="docs-jump-grid">
  <a class="docs-jump-card" href="/zh-CN/python-sdk">
    <span class="docs-jump-eyebrow">下一步</span>
    <strong>查看 Python SDK</strong>
    <span>对照另一套语言模板，统一团队内部接入规范。</span>
  </a>
  <a class="docs-jump-card" href="/zh-CN/oauth-demo">
    <span class="docs-jump-eyebrow">扩展场景</span>
    <strong>进入 OAuth Demo</strong>
    <span>如果不仅是调 API，还要做第三方登录或授权码流程，就继续这里。</span>
  </a>
</div>
