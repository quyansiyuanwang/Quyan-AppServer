# 认证中心 Node SDK

适合把本平台当作统一认证中心使用的 Node.js 后端服务。

相关页面：

- **当前页：** 认证中心 Node SDK
- **切换语言栈：** [认证中心 Python SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-python-sdk)
- **前端场景：** [浏览器单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)

## 适用场景

当你的系统：

- 在后端安全保存 `client_secret`
- 需要和认证中心交换授权码或刷新令牌
- 需要通过 JWKS 在本地校验 JWT 访问令牌
- 需要机器间 `client_credentials` 示例

就可以直接使用本页模板。

## 使用前准备

本页提供可复制的后端接入函数，不是已发布的软件包，也不包含完整登录回调或业务会话管理。浏览器应用应使用[单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)，不要向浏览器分发客户端密钥。

1. 在[认证中心应用管理]({{DOCS_BASE_URL}}/zh-CN/auth-center-client-management)创建并启用已获审核通过的机密客户端，安全保存客户端 ID 和密钥。
2. 启用实际使用的授权类型：用户登录使用 `authorization_code`，需要刷新时同时启用 `refresh_token`；机器调用单独启用 `client_credentials`。
3. 注册精确的回调地址和所需 scope。发起授权时保存随机 `state` 和 PKCE verifier，回调先核对 `state`，再用同一次流程的授权码、回调地址和 verifier 交换令牌。这里的交换函数不能替代这些步骤。
4. 从部署管理员取得 API 基址及预期签发者。下面的 localhost 仅用于本地开发；生产使用部署提供的 HTTPS 地址。`AUTH_CENTER_BASE_URL` 是 API 根地址，不要额外包含 `/v1` 或 `/auth-center`；`AUTH_CENTER_ISSUER` 则是独立配置，必须与预期的 `iss` 完全一致。

令牌端点的成功响应是直接的令牌对象，JWKS 成功响应是 `{ code, message, data }`。请勿混用解析方式。`expires_in`、scope 和是否返回刷新令牌取决于当前客户端配置，后文 JSON 中的 `3600` 是示例值。只有启用了刷新授权的用户授权码流程才返回刷新令牌。

## 环境变量

```env
AUTH_CENTER_BASE_URL=http://localhost:10001
AUTH_CENTER_CLIENT_ID=ac_live_example123
AUTH_CENTER_CLIENT_SECRET=ac_secret_example456
AUTH_CENTER_REDIRECT_URI=https://example.com/auth/callback
AUTH_CENTER_ISSUER=http://localhost:10001/auth-center
```

## 安装依赖

使用支持原生 `fetch` 和 `AbortSignal.timeout` 的 Node.js，运行时版本可按仓库要求选择。在示例目录执行：

```bash
npm init -y
npm pkg set type=module
npm install jsonwebtoken dotenv
```

安装后保留锁文件，按应用的依赖维护流程更新。下文不是独立 npm SDK 的安装说明。

## 1. 获取 JWKS

```js
export async function fetchJwks(baseUrl) {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/v1/auth-center/.well-known/jwks.json`,
    { signal: AbortSignal.timeout(15000) },
  )
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
  if (
    typeof issuer !== 'string' ||
    !issuer.trim() ||
    typeof audience !== 'string' ||
    !audience.trim()
  ) {
    throw new Error('Expected issuer and audience are required')
  }

  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('JWT 格式无效')
  }

  const kid = decoded.header?.kid
  if (decoded.header?.alg !== 'RS256' || typeof kid !== 'string' || !kid) {
    throw new Error('JWT 算法不是 RS256 或缺少有效 kid')
  }

  const jwk = jwks.keys.find(
    (item) => item.kid === kid && item.kty === 'RSA' && item.alg === 'RS256' && item.use === 'sig',
  )
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

上面的函数验证签名、签发者、受众、过期时间和令牌用途，但不会检查业务所需的 scope。请在使用返回的 claims 授权操作之前，单独检查 scope 是否包含该操作要求的值。

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
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/auth-center/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
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
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/auth-center/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
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
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/auth-center/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
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

将第 1–5 节的函数及 import 语句合并保存为 `auth-center-client.js`，与组合示例放在同一目录，并安装上述依赖。填写本部署的环境变量；不要提交包含客户端密钥的 `.env`。示例中的授权码和 PKCE verifier 是占位符，必须替换为同一次真实授权返回的授权码和发起时保存的 verifier。交换前还需在回调中校验 `state`；此处未实现完整的授权回调。

```js
import 'dotenv/config'
import {
  exchangeAuthorizationCode,
  fetchJwks,
  refreshAccessToken,
  verifyAccessToken,
} from './auth-center-client.js'

const requiredEnv = (name) => {
  const value = process.env[name]
  if (!value?.trim()) throw new Error('Missing environment variable: ' + name)
  return value
}

const baseUrl = requiredEnv('AUTH_CENTER_BASE_URL')
const clientId = requiredEnv('AUTH_CENTER_CLIENT_ID')
const clientSecret = requiredEnv('AUTH_CENTER_CLIENT_SECRET')
const issuer = requiredEnv('AUTH_CENTER_ISSUER')

const code = 'returned_authorization_code'
const codeVerifier = 'saved_verifier_from_this_authorization_flow'

const tokenSet = await exchangeAuthorizationCode({
  baseUrl,
  clientId,
  clientSecret,
  code,
  redirectUri: requiredEnv('AUTH_CENTER_REDIRECT_URI'),
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

## 校验边界与令牌更新

本地 JWT 校验只证明签名和所检查的声明有效，不会实时查询客户端是否停用、用户是否失效、授权是否撤销或令牌记录是否被撤销。应用需要自行确定实时状态检查和本地会话失效策略；不能把“验签通过”等同于当前仍获准访问。只从预先配置的可信部署读取 JWKS，不要根据未验证令牌中的 URL 自动下载密钥。

验证后的 `scope` 是空格分隔的字符串，应按完整 scope 名称检查，不能用子字符串包含判断。`aud` 期望值是当前客户端 ID。用户令牌的 `sub` 表示用户，机器令牌的 `sub` 表示客户端 ID，机器令牌没有用户 `uid`；机器令牌不能作为用户登录凭据。本页不处理 ID Token，也不承诺认证中心令牌可直接调用任意平台 API。

成功刷新会替换刷新令牌；请按客户端会话串行刷新，安全保存返回的新令牌，后续不再使用旧值。刷新后的 scope 按当前授权和客户端配置重新计算，应用应重新检查所需 scope。刷新本身不会自动撤销之前签发的访问令牌。示例的注释仅提示保存位置，未实现持久化。

JWKS 示例每次调用都请求公钥，没有实现缓存或自动轮换恢复。生产接入可使用有期限的缓存；遇到未知 `kid` 时，从相同可信地址有限刷新后重试校验，仍未知则拒绝。开发环境使用临时签名密钥时，后端重启会更换密钥，旧令牌可能不再通过校验。

## 常见失败与恢复

| 现象                           | 检查与处理                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 客户端认证失败或应用不可用     | 核对 ID、最新密钥、机密客户端类型、审核及启用状态；机器流程还须启用对应授权类型。                           |
| 授权码或刷新令牌无效           | 检查过期、重复使用、客户端归属、精确回调地址和 PKCE verifier；无法恢复时重新授权。                          |
| scope 无效或不足               | 只申请客户端已配置的 scope，检查返回值并按操作授权；省略 scope 会采用客户端配置的范围。                     |
| 未知 `kid`、签发者或受众不匹配 | 核对可信 JWKS 地址、部署签发者、客户端 ID 和密钥轮换；不要关闭校验来解决。                                  |
| 超时、非 JSON 响应或网络错误   | 检查 API 基址、反向代理和网络。示例会抛出异常，调用方须转换为应用自己的失败响应，不要把令牌或密钥写入日志。 |

授权码和刷新请求不做自动重试。超时或网络中断不能证明服务端未处理；返回的新令牌无法恢复时应重新授权。机器令牌请求也应按错误类型有限重试，避免无界循环。

## 推荐继续阅读

- [认证中心应用管理]({{DOCS_BASE_URL}}/zh-CN/auth-center-client-management)
- [认证中心 Python SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-python-sdk)
- [浏览器单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)
