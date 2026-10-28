# 认证中心 Node SDK

适合把本平台当作统一认证中心使用的 Node.js 后端服务。

相关页面：

- **当前页：** `认证中心 Node SDK`
- **切换语言栈：** [`认证中心 Python SDK`](/zh-CN/auth-center-python-sdk)
- **前端场景：** [`Browser / SPA 示例`](/zh-CN/auth-center-browser-spa-example)

## 适用场景

当你的系统：

- 在后端安全保存 `client_secret`
- 需要和认证中心交换授权码或刷新令牌
- 需要通过 JWKS 在本地校验 JWT 访问令牌
- 需要机器间 `client_credentials` 示例

就可以直接使用本页模板。

## 环境变量

```env
AUTH_CENTER_BASE_URL=http://localhost:10001
AUTH_CENTER_CLIENT_ID=ac_live_example123
AUTH_CENTER_CLIENT_SECRET=ac_secret_example456
AUTH_CENTER_REDIRECT_URI=https://example.com/auth/callback
AUTH_CENTER_ISSUER=http://localhost:10001/auth-center
```

## 依赖示例

```json
{
  "name": "auth-center-node-demo",
  "private": true,
  "type": "module",
  "dependencies": {
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.4.5"
  }
}
```

以下示例默认使用现代 Node.js 自带的 `fetch`。如果运行时较旧，请自行补充 fetch polyfill。

## 1. 获取 JWKS

```js
export async function fetchJwks(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/auth-center/.well-known/jwks.json`)
  if (!response.ok) {
    throw new Error(`加载 JWKS 失败: ${response.status}`)
  }
  const payload = await response.json()
  if (payload.code !== 0 || !Array.isArray(payload.data?.keys)) {
    throw new Error('Invalid JWKS response')
  }
  return payload.data
}
```

## 2. 本地校验访问令牌

下面示例使用 Node 内置 `crypto` 把 JWKS 中的 RSA 公钥转换为 PEM，再用 `jsonwebtoken` 完成校验。

```js
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

function jwkToPublicKey(jwk) {
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  return keyObject.export({ type: 'spki', format: 'pem' })
}

export async function verifyAccessToken({ token, jwks, issuer, audience }) {
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('JWT 格式无效')
  }

  const kid = decoded.header?.kid
  if (!kid) {
    throw new Error('JWT Header 缺少 kid')
  }

  const jwk = jwks.keys.find((item) => item.kid === kid)
  if (!jwk) {
    throw new Error(`JWKS 中找不到 kid=${kid} 对应的公钥`)
  }

  const publicKey = jwkToPublicKey(jwk)

  const claims = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer,
    audience,
  })
  if (
    typeof claims === 'string' ||
    typeof claims.exp !== 'number' ||
    claims.token_use !== 'access_token'
  ) {
    throw new Error('Invalid access token claims')
  }
  return claims
}
```

## 3. 用授权码换取令牌

```js
export async function exchangeAuthorizationCode({
  baseUrl,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  const response = await fetch(`${baseUrl}/v1/auth-center/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || '授权码换取令牌失败')
  }

  return payload
}
```

典型返回：

```json
{
  "access_token": "jwt...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh...",
  "scope": "profile email"
}
```

## 4. 刷新短期访问令牌

```js
export async function refreshAccessToken({ baseUrl, clientId, clientSecret, refreshToken }) {
  const response = await fetch(`${baseUrl}/v1/auth-center/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || '刷新令牌失败')
  }

  return payload
}
```

## 5. `client_credentials` 机器间调用

```js
export async function getMachineToken({ baseUrl, clientId, clientSecret, scope }) {
  const response = await fetch(`${baseUrl}/v1/auth-center/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.scope || payload?.message || '获取机器令牌失败')
  }

  return payload
}
```

注意：

- 返回值里有 `access_token`
- **不会**返回 `refresh_token`

## 6. 组合示例

```js
import 'dotenv/config'
import {
  exchangeAuthorizationCode,
  fetchJwks,
  refreshAccessToken,
  verifyAccessToken,
} from './auth-center-client.js'

const baseUrl = process.env.AUTH_CENTER_BASE_URL
const clientId = process.env.AUTH_CENTER_CLIENT_ID
const clientSecret = process.env.AUTH_CENTER_CLIENT_SECRET
const issuer = process.env.AUTH_CENTER_ISSUER

const code = 'returned_authorization_code'
const codeVerifier = 'pkce-verifier'

const tokenSet = await exchangeAuthorizationCode({
  baseUrl,
  clientId,
  clientSecret,
  code,
  redirectUri: process.env.AUTH_CENTER_REDIRECT_URI,
  codeVerifier,
})

const jwks = await fetchJwks(baseUrl)
const claims = await verifyAccessToken({
  token: tokenSet.access_token,
  jwks,
  issuer,
  audience: clientId,
})

console.log('Token verified')

if (tokenSet.refresh_token) {
  const refreshed = await refreshAccessToken({
    baseUrl,
    clientId,
    clientSecret,
    refreshToken: tokenSet.refresh_token,
  })

  // Persist refreshed.refresh_token securely; the previous refresh token has been rotated.
}
```

请求 JWKS 返回 `{ code, message, data }`，示例取出 `data.keys`。令牌签发者以部署配置为准；`AUTH_CENTER_ISSUER` 必须与令牌中的 `iss` 完全一致，不要从接口路径推断。

## 推荐做法

- 对 JWKS 做短时缓存，遇到未知 `kid` 时再重新拉取
- 校验 `issuer`、`audience`、`exp` 以及需要的 scope
- 刷新令牌和客户端密钥只保存在服务端
- 怀疑泄露时立即轮换客户端密钥
- 不要编写依赖 `client_credentials` 返回刷新令牌的逻辑

授权码只能使用一次，成功刷新会轮换刷新令牌。网络中断或超时后，不要假定请求未被处理；如果无法恢复新令牌，需要重新授权。

## 推荐继续阅读

- `认证中心应用管理`
- `认证中心 Python SDK`
- `Browser / SPA 示例`
