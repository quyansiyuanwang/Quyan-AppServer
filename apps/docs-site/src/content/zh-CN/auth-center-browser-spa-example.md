# 认证中心 Browser / SPA 示例

当接入应用是浏览器优先应用、SPA 或其他公共客户端时，请使用这个示例。

相关页面：

- **先做配置：** [`认证中心应用管理`](/zh-CN/auth-center-app-management)
- **后端版本：** [`认证中心 Node SDK`](/zh-CN/auth-center-node-sdk)
- **当前页：** `Browser / SPA 示例`

## 浏览器场景的重要原则

对于浏览器或 SPA 接入：

- 应注册为**公共客户端**
- 启用 `authorization_code`
- 启用 PKCE
- 不要把 `client_secret` 写进前端代码
- 不要把长期刷新令牌当作可安全存储在浏览器中的内容

常见生产架构是：

1. 浏览器发起带 PKCE 的授权请求
2. 认证中心回调授权码
3. 你的后端交换授权码
4. 你的后端安全保存刷新令牌
5. 浏览器只拿到自己需要的短期会话信息

## 最小 PKCE 工具函数

```ts
function base64UrlEncode(input: ArrayBuffer) {
  const bytes = new Uint8Array(input);
  let text = "";
  bytes.forEach((value) => {
    text += String.fromCharCode(value);
  });
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(text: string) {
  const data = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", data);
}

export async function createPkcePair() {
  const verifier =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}
```

## 生成授权地址

```ts
export async function buildAuthorizeUrl() {
  const clientId = "ac_public_example123";
  const redirectUri = "https://spa.example.com/auth/callback";
  const baseUrl = "http://localhost:10001";
  const { verifier, challenge } = await createPkcePair();

  sessionStorage.setItem("auth_center_pkce_verifier", verifier);

  const url = new URL("/auth-center/authorize", baseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", crypto.randomUUID());
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}
```

## 浏览器回调处理

```ts
export function readAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = sessionStorage.getItem("auth_center_pkce_verifier");

  if (!code || !verifier) {
    throw new Error("缺少 code 或 PKCE verifier");
  }

  return { code, state, verifier };
}
```

## 通过你自己的后端交换授权码

不要把客户端密钥逻辑或刷新令牌存储逻辑放进浏览器。

```ts
export async function exchangeCodeWithBackend(payload: {
  code: string;
  state: string | null;
  verifier: string;
}) {
  const response = await fetch("/api/auth-center/session/exchange", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("授权码交换失败");
  }

  return response.json();
}
```

一个典型后端处理器会：

- 调用 `POST /auth-center/token`
- 把刷新令牌保存在服务端或 HTTP-only Cookie 体系里
- 只返回浏览器真正需要的短期会话信息

## 浏览器本地 JWT 校验

如果浏览器场景必须本地读取 JWT，也可以读取 JWKS。但这更适合作为前端会话辅助，而不是取代后端授权边界。

```ts
export async function readJwtKid(token: string) {
  const headerPart = token.split(".")[0];
  if (!headerPart) throw new Error("JWT 无效");
  const json = JSON.parse(
    atob(headerPart.replace(/-/g, "+").replace(/_/g, "/")),
  );
  return json.kid as string | undefined;
}

export async function fetchJwks(baseUrl: string) {
  const response = await fetch(`${baseUrl}/auth-center/.well-known/jwks.json`);
  if (!response.ok) throw new Error("加载 JWKS 失败");
  return response.json();
}
```

在大多数正式部署中，后端仍应是可信边界。

## 不建议这样做

- 不要把 `client_secret` 打包进 SPA
- 不要把长期刷新令牌明文持久化到 localStorage，除非你完全接受风险
- 不要在公共浏览器应用里使用 `client_credentials`
- 不要假设 `client_credentials` 会返回刷新令牌

## 推荐架构

```text
浏览器 -> /auth-center/authorize + PKCE
浏览器 <- redirect 返回 code
浏览器 -> 你的后端 /exchange
你的后端 -> Auth Center /token
你的后端安全保存 refresh token
你的后端 -> 浏览器返回短期会话 / 展示所需信息
```

## 推荐继续阅读

- `认证中心应用管理`
- `认证中心 Node SDK`
- `认证中心 Python SDK`
