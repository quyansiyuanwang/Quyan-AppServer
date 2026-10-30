# OAuth 授权码示例

通过此 Node.js 本地示例完成一次授权码与 PKCE（S256）流程，再由服务端读取当前用户资料。示例只显示操作结果，不会建立业务登录态，也不会保存或向浏览器返回访问令牌。

## 使用前提

1. 在 [OAuth 应用管理](/zh-CN/oauth-app-management)创建应用，登记 `http://127.0.0.1:3000/oauth/callback`，选择 `profile` Scope 并提交审核。状态必须为 `approved`。
2. 确认认证站和 API 站的源地址，均只填写协议、域名及可选端口。浏览器访问认证站 `/oauth/authorize`，服务端请求 API 站 `/v1/oauth/token` 和 `/v1/users/me`；不要填写控制台或文档站地址。
3. 准备 Node.js 22.12 或更新版本，以及可以访问认证站的浏览器。机密应用需要 Client Secret；公开应用不填写该项。此公开应用演示也通过本地服务端兑换令牌，不是纯浏览器 SPA 示例。
4. 用户需能授权 `profile`，并具备读取当前用户资料所需的账户和资源权限。Scope 不替代接口授权。

## 配置并启动

在空目录安装依赖：

```bash
npm install express express-session dotenv
```

生成随机会话密钥，将输出保存到下面的 `SESSION_SECRET`：

```bash
node --input-type=module -e "import crypto from 'node:crypto'; console.log(crypto.randomBytes(32).toString('hex'))"
```

创建 `.env` 并替换占位值。此文件和应用密钥不得提交到版本库。公开应用请删除 `CLIENT_SECRET`；机密应用需保留并填写有效密钥。

```env
AUTH_FRONTEND_URL=https://auth.example.com
APPSERVER_BASE_URL=https://api.example.com
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
SESSION_SECRET=replace_with_generated_value
```

两个站点地址要求 HTTPS，HTTP 仅允许回环地址。不要附加路径、查询参数、片段或用户名密码。示例固定监听 `127.0.0.1:3000`，回调地址由代码固定生成；确认该端口未被占用。

将以下代码保存为 `index.mjs`：

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

启动服务：

```bash
node index.mjs
```

在浏览器打开 `http://127.0.0.1:3000/login`，登录认证站并确认授权。回调成功后显示 `Authorization succeeded`。开始和回调必须使用同一浏览器、同一主机名；不要将 `127.0.0.1` 换成 `localhost`。

## 流程及返回格式

1. `/login` 重建本地会话，生成随机 `state`、PKCE verifier 和 S256 challenge，并在跳转前保存会话。
2. 回调同时核对会话和 `state`，在发起网络请求前消费授权尝试。同一尝试最多处理一次，包括重复或并发回调。用户拒绝时不调用令牌接口。
3. 服务端向 `POST /v1/oauth/token` 发送 JSON，包含授权码、精确回调地址和 verifier；机密应用还发送 Client Secret。令牌接口成功响应是 OAuth 格式的 `access_token`、`token_type` 等字段，不使用通用业务响应包装。
4. 使用 Bearer 令牌调用 `GET /v1/users/me`。此接口使用业务响应包装，需同时检查 HTTP 状态、数字 `code: 0` 及资料内容，不能只看 HTTP 200。

每个上游请求各自有 15 秒超时，包含响应体读取；整个流程不是合计 15 秒。示例拒绝跟随上游重定向，不自动重试授权码兑换或资料读取。待处理授权尝试有效期为 10 分钟，会话 Cookie 也使用 10 分钟有效期；重启本地服务会使未完成的尝试失效。在同一会话重新打开 `/login` 会替换上次尝试。

## 故障排查

| 提示或现象                                  | 处理方法                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 启动时提示配置无效                          | 检查站点源地址、Client ID 和会话密钥；密钥需使用上面的随机生成结果                                |
| `Invalid or expired authorization response` | 检查 Cookie、浏览器会话及主机名，从 `/login` 重新开始；不要刷新或复用回调地址                     |
| `Authorization was not granted`             | 用户拒绝或授权端返回错误，确认意图和应用配置后重新开始                                            |
| `Missing authorization code`                | 回调缺少有效授权码，从 `/login` 重新授权                                                          |
| `Token exchange failed`                     | 检查审核状态、客户端类型与密钥、回调精确匹配及 PKCE；网络、超时、非 JSON 或重定向响应也会导致失败 |
| `Profile request failed`                    | 检查 `profile` 授权和账户、资源权限；检查 HTTP 和业务错误，修正后重新开始                         |
| `Local session failed`                      | 本地会话读写失败，修复运行环境后重新开始                                                          |

授权尝试消费后不会恢复。令牌交换超时或断线时，无法仅凭本地错误判断服务端是否已签发令牌；不要重复发送同一授权码。示例不展示上游原始响应，请通过受控的服务端排查渠道定位问题，不记录授权码、令牌、密钥、会话 Cookie 或 verifier。

## 用于生产前的调整

此示例的内存会话和一次性状态集合只适用于单进程本地验证。生产部署需要 HTTPS、安全 Cookie、按实际代理拓扑设置的可信代理、持久会话存储，以及跨实例原子消费且带过期清理的授权事务存储。将业务用户会话与临时 OAuth 尝试分开管理。

如需保留令牌，由服务端安全保存并处理过期、刷新轮换和撤销；示例不会自动完成这些步骤。不要把 Client Secret 打包到浏览器或用户设备中。

## 相关文档

- [OAuth 应用管理](/zh-CN/oauth-app-management)
- [API 文档](/zh-CN/api-documentation)
- [Node.js API 调用示例](/zh-CN/node-sdk)
- [Python API 调用示例](/zh-CN/python-sdk)
