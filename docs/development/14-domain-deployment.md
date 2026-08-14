# 14 - 多域名部署指南

本指南说明 AppServer 在一个根域名下部署多个前端站点、公共 API 网关和中央登录时的域名、反向代理、Cookie 与 CORS 配置。示例使用 `qysyw.example`；请将其替换为实际的受控域名。

## 1. 域名清单

所有下列 SPA 域名应指向同一份前端构建产物。它们通过 Host 区分站点配置，而不是通过不同的静态目录区分：

```text
www.qysyw.example                 公共站点
auth.qysyw.example                认证中心
account.qysyw.example             账户中心
chat.qysyw.example                聊天
terminal.qysyw.example            云终端
ai.console.qysyw.example          AI 中转控制台
developer.console.qysyw.example   开发者控制台
ram.console.qysyw.example         RAM 控制台
kv.console.qysyw.example          KV 产品控制台
short-link.console.qysyw.example  短链产品控制台
secret.console.qysyw.example      密钥产品控制台
status.console.qysyw.example      状态页产品控制台
verification.console.qysyw.example 验证产品控制台
ip-geolocation.console.qysyw.example IP 定位产品控制台
push.console.qysyw.example        推送产品控制台
oj.console.qysyw.example          OJ 产品控制台
management.qysyw.example          核心管理站
ai.management.qysyw.example       AI 中转运营站
developer.management.qysyw.example 开发者运营站
terminal.management.qysyw.example 云终端运营站
api.qysyw.example                 后端 API，供浏览器、服务端和外部 API 调用
```

生产环境应为这些 host 签发覆盖所有名称的证书，例如包含 `*.qysyw.example` 和 `*.console.qysyw.example`、`*.management.qysyw.example` 的证书。DNS 不应把 `api.qysyw.example` 指向前端静态站。

## 2. 前端构建

前端浏览器请求必须显式使用公共 API 域名，不能回退到当前 SPA 或认证站点：

```bash
PLATFORM_ROOT_DOMAIN=qysyw.example
SITE_ROOT_DOMAIN=qysyw.example
VITE_PUBLIC_SITE_HOST=www.qysyw.example
VITE_BACKEND_URL=https://api.qysyw.example
# The AI gateway forwards this traffic to api.qysyw.example/relay/proxy.
VITE_AI_PROXY_URL=https://ai.qysyw.example
VITE_RELAY_PUBLIC_BASE_URL=https://ai.qysyw.example
pnpm --filter @appserver/frontend run build:production
```

`VITE_*` 会被打包进浏览器，因此不能包含密钥。`PLATFORM_ROOT_DOMAIN` 只描述 API、Cookie 与公共基础设施域；`SITE_ROOT_DOMAIN` 只描述当前 SPA 站群。`api.<PLATFORM_ROOT_DOMAIN>` 是公开 API 边界而非内部拓扑；所有认证、配置、业务和 Relay 请求都应发送到它。SPA 域名不再代理 `/v1/*`、`/auth-center/*`、`/docs/*` 或 `/relay/proxy/*`。

## 3. Nginx 路由边界

后端网关分别使用 [`deployment/nginx/appserver-api.conf.example`](../../deployment/nginx/appserver-api.conf.example) 与 [`deployment/nginx/appserver-ai.conf.example`](../../deployment/nginx/appserver-ai.conf.example)。后端命名空间只配置在 `api` 虚拟主机，SPA 虚拟主机只返回前端资源：

```nginx
server {
  server_name api.qysyw.example;
  location ^~ /v1/          { proxy_pass http://appserver_backend; }
  location ^~ /auth-center/ { proxy_pass http://appserver_backend; }
  location ^~ /docs/        { proxy_pass http://appserver_backend; }
  location ^~ /relay/proxy/ { proxy_pass http://appserver_backend; }
}

server {
  server_name www.qysyw.example auth.qysyw.example;
  location / { try_files $uri $uri/ /index.html; }
}

server {
  server_name ai.qysyw.example;
  location / { proxy_pass http://appserver_backend/relay/proxy/; }
}
```

不得使用 `location /relay/` 或 `location /services` 代理到后端。`/relay/tokens`、`/relay/settings` 和 `/services` 分别是 AI 控制台、AI 运营站和开发者运营站的页面路径；错误地代理它们会直接显示后端 JSON，例如 `Resource not found` 或“旧 DeveloperProject API 已停用”。修改后执行 `nginx -t`，再 reload，并在每个 SPA hostname 上直接刷新一个深链验证 fallback。

`api.qysyw.example` 是纯后端虚拟主机。`ai.qysyw.example` 只转发 Relay 路径到 `api.qysyw.example/relay/proxy/*`；它不提供 SPA 静态资源。两个网关都必须透传 `Host`、`X-Forwarded-Proto` 和真实客户端 IP；后端的 `TRUST_PROXY_HOPS` 必须等于实际可信反代层数。

## 4. 后端 Cookie 与 CORS

同一根域下的中央登录使用 HttpOnly refresh/session Cookie，access token 只保存在浏览器内存。生产环境的后端 `.env` 至少配置：

```bash
NODE_ENV=production
ROOT_DOMAIN=qysyw.example
TRUST_PROXY_HOPS=1

# 留空会从 ROOT_DOMAIN 生成全部已知一方 SPA origin 的精确列表。
CORS_ALLOWED_ORIGINS=
CENTRAL_LOGIN_ALLOWED_ORIGINS=

AUTH_REFRESH_COOKIE_NAME=refresh_token
AUTH_REFRESH_COOKIE_DOMAIN=.qysyw.example
AUTH_REFRESH_COOKIE_SAMESITE=strict
AUTH_SESSION_COOKIE_NAME=auth_session_id
AUTH_SESSION_COOKIE_DOMAIN=.qysyw.example
AUTH_SESSION_COOKIE_SAMESITE=strict
TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN=.qysyw.example
TWO_FACTOR_TRUSTED_DEVICE_COOKIE_SAMESITE=strict
```

所有 SPA 与 API 都在同一站点下时，`SameSite=strict` 是首选。只有在确实需要来自外部站点的嵌入式登录或跨站 Cookie 时才使用 `SameSite=none`；此时必须使用 HTTPS，且 Cookie 会带 `Secure`。不要使用 `CORS_ALLOWED_ORIGINS=*`，也不要在该变量中使用 wildcard 或 regex，凭据请求必须返回单个精确 Origin。

若需显式覆盖 CORS 白名单，应列出协议、host 和端口：

```bash
CORS_ALLOWED_ORIGINS=https://www.qysyw.example,https://auth.qysyw.example,https://ai.console.qysyw.example,https://ai.management.qysyw.example
CENTRAL_LOGIN_ALLOWED_ORIGINS=https://www.qysyw.example,https://auth.qysyw.example,https://ai.console.qysyw.example,https://ai.management.qysyw.example
```

预发布环境若使用 `auth.staging.qysyw.example` 这类两级子域，它不属于默认从 `qysyw.example` 推导的一层站点列表。必须将实际部署的每个 SPA Origin 显式加入两项白名单，例如：

```bash
CORS_ALLOWED_ORIGINS=https://staging.qysyw.example,https://auth.staging.qysyw.example,https://ai.console.staging.qysyw.example
CENTRAL_LOGIN_ALLOWED_ORIGINS=https://staging.qysyw.example,https://auth.staging.qysyw.example,https://ai.console.staging.qysyw.example
```

该配置使 `https://auth.staging.qysyw.example` 可以携带 Cookie 调用 `https://api.qysyw.example`；两项都必须配置，并在修改后重启后端。

本地多域名开发时使用 `ROOT_DOMAIN=qysyw.test`，前端站点运行在 `https://*.qysyw.test:5173`，后端默认会生成带 `:5173` 的精确 origin。不要混用生产 Cookie 和本地域名。

## 5. 上线检查

1. 每个 SPA hostname 返回前端 `index.html`，并能刷新 `/overview`、`/relay/tokens`、`/relay/settings`、`/services`。
2. `api.<root-domain>` 不返回前端静态文件；`/v1/health` 等后端接口可达。
3. 登录后确认 `refresh_token`、`auth_session_id` 为 `HttpOnly`、`Secure`，Domain 与 SameSite 符合上面的设置。
4. 由浏览器验证 OPTIONS 和携带 Cookie 的 `/v1/auth/refresh`，响应仅回显允许的精确 Origin。
5. 使用无痕窗口验证中央登录返回、登出以及受保护页面的跳转。
