# Node.js API 调用示例

从 Node.js 服务或后台任务调用曲研 API。本页提供可复制的 `fetch` 封装，无需安装平台专用 SDK。

## 使用前提

使用 Node.js 22.12 或更高版本，以及 pnpm。以下示例在服务端运行。

本页使用已获得授权的访问凭证，不执行登录、授权码交换或刷新流程。可使用当前部署的登录访问令牌；第三方 OAuth 访问令牌还需要下列 scope。账号 AccessKey 仅能用于服务端允许的接口，不能把 Relay Token 或 OJ API Key 当作这里的访问令牌。

| 请求                                             | 用途                     | OAuth scope    | IAM 强制模式下的动作             |
| ------------------------------------------------ | ------------------------ | -------------- | -------------------------------- |
| `GET /v1/users/me`                               | 当前凭证对应的用户资料   | `profile`      | `quyan:user:GetCurrentUser`      |
| `GET /v1/balance/transactions?limit=20&offset=0` | 当前用户的第一页余额流水 | `balance:read` | `quyan:balance:ListTransactions` |

两项操作都针对当前身份的用户资源；scope 不替代资源授权，匹配的 Deny 仍可拒绝请求。先运行资料请求，确有流水授权时再启用代码中的可选请求。

## 1. 创建示例目录

```text
example/
├─ package.json
├─ .env
├─ .gitignore
├─ appserver-client.mjs
└─ index.mjs
```

`package.json`：

```json
{
  "name": "quyan-api-example",
  "private": true,
  "scripts": {
    "dev": "node --env-file=.env index.mjs"
  }
}
```

## 2. 配置地址和凭证

在 `.env` 中替换下列占位值。基础地址填写当前部署的 API 源站，不附加 `/v1`；生产调用使用 HTTPS。模板不会猜测地址或在缺少凭证时匿名请求。

```env
APPSERVER_BASE_URL=https://api.example.com
ACCESS_TOKEN=replace_with_authorized_access_token
```

在 `.gitignore` 中加入：

```gitignore
.env
node_modules/
```

## 3. 保存请求封装

保存为 `appserver-client.mjs`：

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

封装要求 HTTP 2xx、JSON 对象和数值型 `code: 0` 同时成立，返回 `{ data, requestId }`。业务失败即使 HTTP 为 200 也会抛错。默认 15 秒超时覆盖等待响应与读取 JSON；网络失败不会伪造 HTTP 408 或 500。查询参数支持字符串、数字和布尔值，忽略 `null`、`undefined`。

## 4. 调用并运行

保存为 `index.mjs`：

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

在示例目录运行：

```bash
pnpm dev
```

成功时输出 `Profile request succeeded`，不打印个人资料；失败时输出诊断信息并以非零状态退出。无需安装 Node.js 依赖。已有同名环境变量优先于 `.env`，切换部署时先检查终端环境。

## 流水分页与写操作

启用可选流水请求后，`history.records` 只是当前页，`history.total` 是匹配总数。下一页将 `offset` 改为 `20`，之后按页大小递增；不要把第一页当作完整历史。

封装不自动刷新凭证或重试。添加写接口前先核对 API 参考中的权限、重放保护和二次验证要求；当前示例未实现这些交互。网络中断或超时导致写入结果未知时，先查询结果，再按接口支持的幂等机制决定是否重试。

## 常见问题

| 现象或业务码               | 处理方法                                                                          |
| -------------------------- | --------------------------------------------------------------------------------- |
| 缺少配置或 URL 格式错误    | 检查 `.env`；地址应为 API 的 HTTP(S) 源站，不带 `/v1`、路径、查询参数或用户名密码 |
| 非 JSON、3xx 或 HTML 页面  | 检查是否误填前端、文档站或需要跳转的地址；模板不自动跟随重定向                    |
| `1001`、`1014` 或 HTTP 401 | 检查凭证类型、环境、有效性及 `Authorization` 请求头                               |
| `1006`                     | 用户状态已变更，需要重新认证                                                      |
| `1013`                     | 访问令牌已过期；通过对应认证流程刷新，失败后重新认证                              |
| `1004` 或 HTTP 403         | 检查 OAuth scope、动作与资源授权、账号或角色状态以及显式 Deny                     |
| `1429` 或 HTTP 429         | 降低调用频率，按服务端限流信息等待后再决定是否重试                                |
| 超时或连接失败             | 检查网络和服务状态；没有 HTTP 状态不代表服务端未处理请求                          |

错误日志仅输出概括信息、HTTP 状态、业务码及服务端返回的请求 ID。不要把访问令牌、完整响应或个人资料粘贴到公开日志。

## 相关页面

- [API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)
- [API 参考]({{SWAGGER_DOCS_URL}})
- [Python API 调用示例]({{DOCS_BASE_URL}}/zh-CN/python-sdk)
- [OAuth 授权码示例]({{DOCS_BASE_URL}}/zh-CN/oauth-demo)
- [AccessKey 管理]({{DOCS_BASE_URL}}/zh-CN/access-key-management)
