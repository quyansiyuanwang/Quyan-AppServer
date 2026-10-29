# OAuth 授权码示例

本示例演示如何使用授权码和 PKCE（S256）让用户授权，再由服务端读取用户资料。

## 开始前

1. 在[OAuth 应用管理](/zh-CN/oauth-app-management)中创建应用，登记 `http://127.0.0.1:3000/oauth/callback`，选择 `profile` scope 并提交审核。应用通过审核后才能授权。
2. 确认认证站地址和 API 地址。浏览器访问认证站的 `/oauth/authorize`；服务端请求 API 地址的 `/v1/oauth/token`。两者可能位于不同站点。
3. 准备 Node.js 20 或更新版本。机密客户端需要客户端密钥；公开客户端不填写该密钥。

## 本地运行

在空目录创建示例文件，安装依赖：

```bash
npm install express express-session dotenv
```

创建 `.env`，将占位值替换为实际配置。`SESSION_SECRET` 应为随机生成的长字符串；不要将此文件提交到版本库。

```env
AUTH_FRONTEND_URL=https://auth.example.com
APPSERVER_BASE_URL=https://api.example.com
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://127.0.0.1:3000/oauth/callback
SESSION_SECRET=replace_with_a_long_random_secret
```

公开客户端请删除 `CLIENT_SECRET`。将以下代码保存为 `index.mjs`，执行 `node index.mjs`，然后打开 `http://127.0.0.1:3000/login`。

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

浏览器完成授权后，服务端核对一次性 `state`，使用保存在会话中的 `code_verifier` 换取令牌，再以该令牌请求当前用户资料。示例只显示成功或失败，令牌不返回浏览器。

## 部署与故障排查

- 此示例仅适合本地验证：上线前使用 HTTPS、持久会话存储及安全 Cookie，并根据部署的可信代理配置处理 HTTPS；默认内存会话存储不适合生产。
- `invalid or expired authorization response`：重新开始登录，确认浏览器允许会话 Cookie，且回调属于发起授权的同一会话。
- 令牌交换失败：确认应用已通过审核、客户端类型和密钥正确、回调地址完全一致，并使用同一次授权生成的 PKCE 值。
- 资料读取失败：确认应用获准使用 `profile` scope，用户已授权，且账户和资源权限允许访问。修正后从 `/login` 重新开始授权；令牌交换成功后授权码已使用，刷新回调地址不能重复使用它。令牌交换请求中断、结果不确定时也应重新开始。
- 使用服务端日志排查时不要记录授权码、令牌、客户端密钥、会话 Cookie 或 PKCE verifier。

## 相关文档

- [OAuth 应用管理](/zh-CN/oauth-app-management)
- [API 文档](/zh-CN/api-documentation)
- [Node SDK](/zh-CN/node-sdk)
- [Python SDK](/zh-CN/python-sdk)
