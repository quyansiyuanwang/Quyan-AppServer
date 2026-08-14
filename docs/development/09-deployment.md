# 09 — 构建与部署

## 构建流程

### 后端构建

```bash
# 标准构建
pnpm --filter @appserver/backend build

# 构建步骤：
# 1. type-check (tsc --noEmit)
# 2. clean (rimraf dist/)
# 3. build:info:inject (注入构建信息)
# 4. compile (esbuild)
# 5. copy:static (复制 JSON/HTML/CSS 到 dist/)
```

**构建工具：esbuild**

- 入口：`src/main.ts`
- 输出：`dist/index.cjs` (CommonJS)
- 原生模块标记为 external：Prisma client, Sharp
- 路径别名通过 `tsc-alias` 在构建时解析

**生产构建**：

```bash
pnpm --filter @appserver/backend build:prod
# NODE_ENV=production
```

### 前端构建

```bash
# 标准构建
pnpm --filter @appserver/frontend build

# 构建步骤：
# 1. type:generate (生成路由类型)
# 2. type-check (vue-tsc)
# 3. compile (vite build)
```

**构建工具：Rolldown-Vite**

- 目标：ES2018 (Chrome 63+)
- 压缩：Terser（生产环境移除 console/debugger）
- 代码分割：按 node_modules 自动分包
- Gzip 压缩：>10KB 的文件
- 混淆：javascript-obfuscator（生产环境）
- 分析报告：`stats.html`

**生产构建**：

```bash
pnpm --filter @appserver/frontend build:production
```

### Monorepo 构建

```bash
# 构建所有项目
pnpm run build

# 完整构建（含 OpenAPI 生成）
pnpm run build:full
# = openapi:gen:all + build
```

## 运行

### 后端开发模式

```bash
pnpm run dev:backend
# nodemon 监听 src/ 和 prisma/schema.prisma
# 文件变更 → openapi:generate → bun src/main.ts
```

### 后端生产模式

```bash
# 直接运行
pnpm --filter @appserver/backend start:prod

# 或通过 PM2
pnpm --filter @appserver/backend pm2:start:prod
```

### 前端开发模式

```bash
pnpm run dev:frontend
# Vite dev server (port 5173)
# /api/* 请求代理到 localhost:10001
```

### 多域名本地开发

多域名 SPA 与中心认证使用 `*.qysyw.test`。开发者无需手动编辑 hosts 或维护本地证书：

`pnpm run dev` 会先自动执行 `local:setup`，随后启动 backend、frontend 和 docs-site；停止该开发命令或任一服务异常退出后，会自动执行 `local:teardown`。首次运行仍可能出现 mkcert、UAC 或 `sudo` 提示。

```powershell
# 首次需要安装 mkcert；脚本会按当前平台请求 hosts 写入权限
pnpm run local:setup

# 移除本项目添加的 hosts 记录和本地证书（不会移除 mkcert 根证书）
pnpm run local:teardown

# 只移除 hosts 记录，保留本地证书
node scripts/setup-local-domains.mjs --uninstall
```

`local:setup` 会在 hosts 文件中维护一个专用标记区块，并生成 `apps/frontend/.certs/` 中的本地 HTTPS 证书。重复执行可安全更新该区块；卸载不会修改其他项目的 hosts 记录或系统信任根。脚本在 Windows 通过 UAC、在 macOS/Linux 通过 `sudo` 写入 hosts，但始终以开发者自己的用户身份安装并生成 `mkcert` 证书，确保浏览器能信任它。请直接执行 `pnpm run local:setup`，不要以 `sudo pnpm` 启动。`mkcert` 未安装时会给出当前平台的安装提示。证书文件存在时，前端 Vite 配置会自动启用 HTTPS。

启动前端后，请从站点注册表中的完整域名访问，例如 `https://www.<LOCAL_ROOT_DOMAIN>:5173/`、`https://terminal.<LOCAL_ROOT_DOMAIN>:5173/` 或 `https://management.<LOCAL_ROOT_DOMAIN>:5173/`；`localhost` 与未注册 hostname 会显示拒绝页面，这是多域名隔离的预期行为。

原版单域名前端使用独立的 `legacy.<LOCAL_ROOT_DOMAIN>` Host，不由多域名 Vite 进程提供。先启动当前分支的前端于 `5173`，再在 `origin/master` 的独立工作树中使用同一套本地证书启动前端于 `5174`。原版工作树设置 `VITE_HTTPS_KEY_PATH` 和 `VITE_HTTPS_CERT_PATH` 指向生成的证书，并设置 `VITE_MULTI_DOMAIN_ENTRY_ORIGIN=https://www.<LOCAL_ROOT_DOMAIN>:5173`；多域名工作树可选设置 `VITE_LEGACY_APP_ORIGIN=https://legacy.<LOCAL_ROOT_DOMAIN>:5174`。

如果本机设置了 HTTP(S) 代理，必须将本地域名绕过代理。Windows Schannel 还可能需要关闭本地开发证书的吊销检查：

```powershell
$env:NO_PROXY = 'localhost,127.0.0.1,.<LOCAL_ROOT_DOMAIN>'
$env:no_proxy = $env:NO_PROXY
curl.exe --noproxy '*' --ssl-no-revoke -I https://www.<LOCAL_ROOT_DOMAIN>:5173/
```

不要用 `http://` 访问 HTTPS Vite 端口；否则会得到 `HTTP/0.9` 或类似协议错误。

本地前端仍通过 Vite 的 `/api` 代理访问 `http://localhost:10001`。若需要验证 API host-only Cookie 或真实跨源部署行为，应使用独立的本地 HTTPS 反向代理，而不是把 API 域名指向 Vite。

### 多域名路由与迁移

前端按完整 hostname 动态挂载对应 app，只注册该站点所属的路由。`ai.console`、`developer.console` 与 `ram.console` 是用户控制台；`terminal` 是云终端的唯一用户入口，默认显示 `/overview`，工作区与订阅页分别为 `/workspace` 和 `/subscriptions`。`kv.console`、`short-link.console`、`secret.console`、`status.console`、`verification.console`、`ip-geolocation.console`、`push.console` 与 `oj.console` 是独立产品入口，并分别使用其能力路径。开发者产品目录不再提供入口；OJ Submitter 的 API 密钥、用量和定价统一由 `oj.console` 的 `/api-keys`、`/usage` 和 `/pricing` 承载。`management`、`ai.management`、`developer.management`、`terminal.management` 面向运营管理。站点选择器仅显示当前用户拥有任一功能权限的入口，路由和服务端授权仍独立生效。活动域名的旧路径可临时 `302` 到规范 origin/path 并保留 query string；停用的 `console`、`terminal.console` 与 `developer` 域名、未知 hostname 均拒绝访问。

`legacy.<SITE_ROOT_DOMAIN>` 是唯一例外：它由 `origin/master` 的独立静态前端构建提供完整的单域名 UI，而不是多域名构建注册的 profile。两个版本均在已登录用户的侧栏登出入口之前显示版本切换按钮。新版使用受控的单一路径映射回原版；原版把当前安全路径交给新版主站，由新版迁移规则解析最终 Host。切换保留普通 query string 与 hash，但会删除 token、refresh token 和未验证回跳参数。生产反向代理必须将 `legacy.<SITE_ROOT_DOMAIN>` 指向原版静态构建，其余已注册 Host 指向多域名构建；留空的 CORS 与中央登录白名单会自动包含其精确 Origin。

前端构建使用闭合站点注册表：`SITE_ROOT_DOMAIN` 明确指定该构件的站点族根域，`VITE_PUBLIC_SITE_HOST` 明确指定公共站 hostname。浏览器仅接受公共站以及目录中声明的 `<prefix>.<SITE_ROOT_DOMAIN>`；例如 `noexist.qysyw.cn` 不会被推断为新站点，而是显示 404。EO 仍必须将已注册的根域及站点子域实际绑定到静态构件，并为深链配置 SPA fallback。后端不会根据任意请求 Origin 自动放行认证和 CORS；新增根域时，将它追加到 `ADDITIONAL_ROOT_DOMAINS`（或设为主 `ROOT_DOMAIN`），服务端会生成该根域全部站点的精确 CORS 与中央登录 Origin，不接受通配符。

构建仍输出一个可部署构件，但浏览器会先按完整 hostname 解析 profile，再异步挂载该 profile 的应用根和路由树。公共站与认证站使用轻量根，不加载业务壳；业务站只注册当前 profile 的业务路由。禁止在启动、登录完成或空闲回调中预加载全部业务页面；仅可在用户明确指向的下一目标上进行按需预加载。

SPA 的迁移守卫覆盖本地开发和边缘 SPA fallback，并在浏览器可见时保留 query string 与 hash。HTTP 请求不包含 hash，因此生产部署仍应优先在边缘层完成路径和 query 的迁移，避免用户下载错误站点的应用壳层。不得把认证 token、refresh token 或不受验证的回跳 URL 放入迁移地址。

## PM2 部署

### 配置文件

`apps/backend/ecosystem.config.cjs`：

```javascript
module.exports = {
  apps: [
    {
      name: 'backend',
      script: './dist/index.cjs',
      interpreter: 'bun',
      instances: 1,
      exec_mode: 'cluster',
      wait_ready: true,
      listen_timeout: 8000,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        ENV_FILE_PATH: '/home/service/Quyan-Backend/.env',
      },
    },
  ],
}
```

### PM2 命令

```bash
# 启动
pnpm --filter @appserver/backend pm2:start          # 开发
pnpm --filter @appserver/backend pm2:start:prod     # 生产

# 监控
pnpm --filter @appserver/backend pm2:status          # 状态
pnpm --filter @appserver/backend pm2:logs            # 日志

# 管理
pnpm --filter @appserver/backend pm2:stop            # 停止
pnpm --filter @appserver/backend pm2:restart         # 重启
pnpm --filter @appserver/backend pm2:delete          # 删除

# 重建（清旧构建 + 生产构建 + 启动）
pnpm --filter @appserver/backend pm2:rebuild
# = pm2:delete + build:prod + pm2:start:prod
```

### 优雅关闭

服务监听 `SIGTERM`/`SIGINT`：

1. 关闭 HTTP 服务器（12 分钟强制超时）
2. 清理连接（Redis 等）
3. 在 PM2 集群模式下发送 `ready` 信号

### 服务超时配置

- `keepAliveTimeout`: 65 秒
- `headersTimeout`: 66 秒
- `requestTimeout`: 10 分钟

## 环境变量

### 域名、Cookie 与 CORS 上线清单

部署前先确定一个站点族根域，例如 `qysyw.example.com`。同一份前端构件由完整 hostname 选择对应应用，至少应为实际启用的站点配置 DNS 和 HTTPS：

- 公共与认证：`www.<ROOT_DOMAIN>`、`auth.<ROOT_DOMAIN>`。
- 账户与用户控制台：`account`、`chat`、`terminal`、`ai.console`、`developer.console`、`ram.console`。
- 产品控制台：`kv.console`、`short-link.console`、`secret.console`、`status.console`、`verification.console`、`ip-geolocation.console`、`push.console`、`oj.console`。
- 运营：`management`、`ai.management`、`developer.management`、`terminal.management`。
- API：`api.<ROOT_DOMAIN>`，只承载后端接口，不部署前端 SPA。

所有 SPA hostname 指向同一静态前端构件，并为未知的应用内路径返回该构件的 `index.html`（SPA fallback）。不要把 `api.<ROOT_DOMAIN>` 指向前端静态站，也不要把 `/relay/tokens`、`/relay/settings` 这类前端路径代理到后端；只有 `/relay/proxy/*` 是中转 API 路径。`api.<ROOT_DOMAIN>` 承载 `/v1/*`、`/auth-center/*`、`/docs/*` 和 `/relay/proxy/*`，并保留 `Host`、`X-Forwarded-Proto` 与真实客户端 IP 链；SPA 域名不代理这些后端路径。

可从 [`deployment/nginx/appserver-spa.conf.example`](../../deployment/nginx/appserver-spa.conf.example) 复制 Nginx 路由边界。替换示例域名、静态目录、证书和后端地址后，用 `nginx -t` 验证并 reload；该示例特意不代理宽泛的 `/relay/` 或 `/services`，从而避免页面深链直接显示后端 JSON。完整的多域名、Cookie 和精确 CORS 配置见 [14-domain-deployment.md](./14-domain-deployment.md)。

后端使用 HttpOnly Cookie 保存刷新令牌和认证会话 ID，浏览器侧只在内存中保存 access token。Cookie 跨同一站点族的认证跳转需要父域作用域，生产环境推荐：

```bash
ROOT_DOMAIN=qysyw.example.com
AUTH_REFRESH_COOKIE_DOMAIN=.qysyw.example.com
AUTH_SESSION_COOKIE_DOMAIN=.qysyw.example.com
AUTH_REFRESH_COOKIE_SAMESITE=strict
AUTH_SESSION_COOKIE_SAMESITE=strict
```

留空两个 `*_COOKIE_DOMAIN` 时，当前后端也会默认使用 `.${ROOT_DOMAIN}`。仅当登录页面与 API 处于不同**站点**时才使用 `SameSite=none`；这要求 HTTPS，并应只与精确 CORS Origin 一起使用。不要用 `*`，不要把刷新令牌写入前端环境变量、localStorage 或反向代理日志。

`CORS_ALLOWED_ORIGINS` 和 `CENTRAL_LOGIN_ALLOWED_ORIGINS` 都必须是逗号分隔的精确 origin，例如：

```bash
CORS_ALLOWED_ORIGINS=https://www.qysyw.example.com,https://auth.qysyw.example.com,https://ai.console.qysyw.example.com,https://ai.management.qysyw.example.com
CENTRAL_LOGIN_ALLOWED_ORIGINS=https://www.qysyw.example.com,https://auth.qysyw.example.com,https://ai.console.qysyw.example.com,https://ai.management.qysyw.example.com
```

如果预发布站使用 `auth.staging.qysyw.example.com` 这类两级子域，必须显式配置实际 Origin，不能依赖 `ROOT_DOMAIN=qysyw.example.com` 的默认一层域名推导：

```bash
CORS_ALLOWED_ORIGINS=https://staging.qysyw.example.com,https://auth.staging.qysyw.example.com
CENTRAL_LOGIN_ALLOWED_ORIGINS=https://staging.qysyw.example.com,https://auth.staging.qysyw.example.com
```

修改 CORS 或中央登录白名单后重启后端；浏览器请求会从这些站点直接发送到 `https://api.qysyw.example.com`。

若所有站点均为本应用的同一根域，推荐两项留空，由 `ROOT_DOMAIN`（以及可选 `ADDITIONAL_ROOT_DOMAINS`）自动生成完整的精确第一方 origin 清单。新增第二个根域时，将其加入 `ADDITIONAL_ROOT_DOMAINS`，不要手工添加通配符。每次域名、Cookie 或 CORS 变更后，依次验证：登录后从 `auth` 返回业务站、刷新页面后的 Cookie 会话恢复、登出后 Cookie 清除，以及浏览器 Network 面板中跨域请求具有 `Access-Control-Allow-Credentials: true` 和精确的 `Access-Control-Allow-Origin`。

### 后端 (`.env`)

```bash
# 服务器
PORT=10001
NODE_ENV=production
ROOT_DOMAIN=md.qysyw.cn
# 同一 API 还需服务其他根域时，使用逗号分隔的可信根域列表。
ADDITIONAL_ROOT_DOMAINS=qysyw.cn,md.qysyw.cn

# 数据库
DATABASE_URL=mysql://user:password@localhost:3306/database

# JWT (>= 64 字符)
JWT_ACCESS_SECRET=<64+字符>
JWT_REFRESH_SECRET=<64+字符>
JWT_ACCESS_EXPIRES_IN=5        # 开发：5 秒
JWT_REFRESH_EXPIRES_IN=28800   # 开发：8 小时

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# CORS and central login continuation: leave blank to derive every exact first-party
# origin from ROOT_DOMAIN. Overrides must remain exact Origins; wildcards are rejected.
CORS_ALLOWED_ORIGINS=
CENTRAL_LOGIN_ALLOWED_ORIGINS=
CENTRAL_LOGIN_FLOW_TTL_SECONDS=600
# These production defaults derive from ROOT_DOMAIN. Set only to override them.
WEBAUTHN_RP_ID=
WEBAUTHN_ORIGIN=
FRONTEND_BASE_URL=
AUTH_CENTER_ISSUER=

# 安全 (>= 64 字符，必须与 JWT 密钥不同)
REPLAY_SIGNING_MASTER_SECRET=<64+字符>
SUPPORT_AI_CONFIG_MASTER_SECRET=<64+字符，独立于 JWT 与重放保护密钥>
SUPPORT_KNOWLEDGE_URL=https://<docs-domain>/support-knowledge.json
SUPPORT_KNOWLEDGE_CACHE_TTL_SECONDS=300
TWO_FACTOR_TRUSTED_DEVICE_SECRET=<64+字符>
```

### 前端 (`.env`)

```bash
# 浏览器请求统一发送到公共 API 域名，不能回退到当前 SPA host。
VITE_BACKEND_URL=https://api.qysyw.example
# ai.qysyw.example forwards requests to api.qysyw.example/relay/proxy.
VITE_AI_PROXY_URL=https://ai.qysyw.example
VITE_RELAY_PUBLIC_BASE_URL=https://ai.qysyw.example
VITE_RECAPTCHA_SITE_KEY=
VITE_TURNSTILE_SITE_KEY=
```

### 生产环境建议

```bash
# 正式环境：浏览器直接调用受 CORS 保护的公共 API。
# PLATFORM_ROOT_DOMAIN=qysyw.cn SITE_ROOT_DOMAIN=qysyw.cn VITE_PUBLIC_SITE_HOST=www.qysyw.cn pnpm --filter @appserver/frontend run build:production
# 预览环境：同样调用受 CORS 保护的公共 API。
# PLATFORM_ROOT_DOMAIN=qysyw.cn SITE_ROOT_DOMAIN=staging.qysyw.cn VITE_PUBLIC_SITE_HOST=staging.qysyw.cn pnpm --filter @appserver/frontend run build:staging

# 生产环境调整
JWT_ACCESS_EXPIRES_IN=900        # 15 分钟
JWT_REFRESH_EXPIRES_IN=604800    # 7 天
NODE_ENV=production
```

## 预提交验证

```bash
cd AppServerMonorepo
pnpm run precommit
```

执行步骤：

1. `openapi:gen:all` — OpenAPI 生成流水线
2. `validate:permissions` — 权限一致性校验
3. `lint:check` — 所有项目 ESLint 检查
4. `format:check` — 所有项目 Prettier 检查
5. `type-check` — 所有项目 TypeScript 类型检查

## 后端脚本

| 脚本                                           | 用途                                        |
| ---------------------------------------------- | ------------------------------------------- |
| `relay-token:backfill-used-quota`              | 回填 relay token 已用配额（`--apply` 执行） |
| `trusted-device:cleanup-legacy`                | 清理旧版信任设备记录                        |
| `balance:cleanup-consumption-older-than-month` | 清理超过 1 个月的消费记录（`--apply` 执行） |
| `generate-operation-ids`                       | 生成操作 ID                                 |

## 部署检查清单

- [ ] 所有环境变量已配置（特别是 3 个安全密钥 >= 64 字符）
- [ ] 数据库迁移已运行 (`pnpm run db:migrate`)
- [ ] Prisma client 已生成 (`pnpm run db:generate`)
- [ ] 生产构建成功 (`pnpm run build:full`)
- [ ] 后端与 docs-site 已配置 `ROOT_DOMAIN`；前端已配置 `PLATFORM_ROOT_DOMAIN`、`SITE_ROOT_DOMAIN` 与 `VITE_PUBLIC_SITE_HOST`
- [ ] 根域及每个 SPA host 都已在边缘层绑定到静态构件；根域可直接作为公共站点，未知 host 被拒绝
- [ ] 每个 SPA host 都有 HTTPS、SPA fallback 和深链刷新验证；`docs`、`api`、`ai` 不指向 SPA
- [ ] 已知旧路径和错误 hostname 返回保留 query 的临时迁移；SPA fallback 保留 hash，未知 hostname 与未知路径保持拒绝
- [ ] CORS 与 `CENTRAL_LOGIN_ALLOWED_ORIGINS` 只包含精确 origin，未使用通配符
- [ ] refresh/session Cookie 使用 `.${ROOT_DOMAIN}`（或显式的更窄作用域）；URL 中不含 access token、refresh token 或裸 return URL
- [ ] JWT 过期时间已调整为生产值
- [ ] Redis 连接可访问
- [ ] PM2 配置正确（`ecosystem.config.cjs`）
