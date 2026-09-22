# 本地开发与启动模式

本文档描述在本地把仓库跑起来的最小路径、两种启动模式的差别，以及每个常见报错对应的修复命令。

## 目标路径

```bash
pnpm install            # 安装依赖
pnpm run setup          # 幂等初始化（可重复执行）
pnpm run dev            # 多域名 HTTPS 启动（首次需要 mkcert 与写入 hosts 的权限）
pnpm run dev:localhost  # 或者：免特权单站点，只服务 http://localhost:5173
```

`pnpm run setup` 依次完成：

1. **工具链检查**：Node（`engines.node`）、pnpm（`packageManager`）、Bun、mkcert（可选）、`node_modules`。
2. **环境文件**：`apps/*/.env` 缺失时从 `.env.example` 生成，后端填充互不相同的随机开发密钥，并为多域名模式设置 `AUTH_REFRESH_COOKIE_DOMAIN=.${ROOT_DOMAIN}`。**已存在的文件不会被覆盖**，只提示缺失的必需键；`--force-env` 才重建（旧文件备份为 `.env.bak`）。
3. **生成物**：Prisma Client（落后于 `prisma/schema.prisma` 时）与前端 API 客户端 `apps/frontend/src/client`（缺失或落后于 `apps/frontend/swagger.json` 时；使用已提交的规范，无需后端先运行）。
4. **依赖服务**：检测 `DATABASE_URL` 指向的 MySQL 与 `REDIS_HOST/REDIS_PORT` 的可连接性；MySQL 不可用时给出建库语句并以非零状态退出。
5. **数据库**：`prisma migrate deploy` + `prisma db seed`（均可重复执行）。

常用开关：`pnpm run setup --skip-db`、`--skip-seed`、`--skip-openapi`、`--force-env`、`--force-openapi`；`pnpm run doctor`（等价 `setup --check`）只读诊断并报告修复命令。

## 两种启动模式

| 项目         | 多域名 HTTPS `pnpm run dev`（默认）        | 免特权单站点 `pnpm run dev:localhost`      |
| ------------ | ------------------------------------------ | ------------------------------------------ |
| 站点拓扑     | `https://<前缀>.qysyw.test:5173` 全部站点  | 单一注册站点，`http://localhost:5173`      |
| 站点注册表   | 与生产一致的闭合注册表                     | 只有被别名的站点，其它 hostname 仍拒绝     |
| Cookie       | 域级（`Domain=.qysyw.test`），跨子站可用   | 主机级（不写 `Domain`）                    |
| 环境要求     | 首次需要 mkcert 与写入 hosts 的权限        | 无（不需要 mkcert、hosts 改动或管理员）    |
| 能力边界     | 与生产一致，覆盖全部能力                   | Passkey、社交 OAuth 回跳、扫码登录与站点切换不可用 |
| 适用         | 认证、Cookie、多站点跳转与部署行为验证     | 后端/前端日常开发、无管理员权限的机器      |

`pnpm run dev:domains` 与 `pnpm run dev` 是同一个多域名生命周期脚本的别名；差别只在命令语义。

### 站点入口（如何区分站点）

多域名模式下每个站点有独立 hostname，路由树只注册该站点所属的路由组。常用入口（`LOCAL_ROOT_DOMAIN` 默认 `qysyw.test`，端口 `5173`）：

| 站点                     | 入口                                         |
| ------------------------ | -------------------------------------------- |
| 公共站                   | `https://www.qysyw.test:5173/`                |
| 认证站（登录）           | `https://auth.qysyw.test:5173/login`          |
| 账号站                   | `https://account.qysyw.test:5173/overview`    |
| 云终端                   | `https://terminal.qysyw.test:5173/overview`   |
| 对话站                   | `https://chat.qysyw.test:5173/overview`       |
| AI 控制台                | `https://ai.console.qysyw.test:5173/overview` |
| 运营管理                 | `https://management.qysyw.test:5173/overview` |
| 各产品控制台             | `https://<产品前缀>.console.qysyw.test:5173/` |

完整主机清单以 `packages/shared/src/developer-product.ts` 的产品目录为产品来源派生：`apps/frontend/src/config/first-party-hosts.ts` 是前端侧清单（由测试锁定与共享目录一致），后端 `src/config/env/domain.ts` 直接引用共享目录，`scripts/setup-local-domains.mjs` 据此生成 hosts 与证书。`pnpm run local:setup -- --dry-run` 只预览将要写入的主机名而不改动系统。

`qysyw.test` 裸域名不是注册站点：公共站使用 `www.qysyw.test`，未注册 hostname 显示拒绝页面。免特权模式则相反——只有 `localhost`、`127.0.0.1`、`::1` 可用，其余 hostname 一律拒绝；其默认路径由 `.env.localhost` 的 `VITE_DEV_SITE_PROFILE` 决定（默认 `management-core`，即进入后落在 `/overview`）。

### 免特权单站点模式如何工作

- 前端以 `vite --mode localhost` 启动，读取 `apps/frontend/.env.localhost`：`VITE_DEV_SINGLE_SITE=true`、`VITE_DEV_SITE_PROFILE=management-core`、`VITE_HTTPS_ENABLED=false`。
- `src/config/dev-single-site.ts` 在 `import.meta.env.DEV` 且显式开启标志时，把被别名的站点映射到浏览器当前 origin，并把 identity 路由组并入其路由树，使登录页与业务页同源可用。生产构建（`DEV === false`）永远走闭合的多域名注册表。
- `scripts/dev-local-backend.mjs` 仅为后端子进程注入 `CORS_ALLOWED_ORIGINS`、`FRONTEND_BASE_URL` 与三个 Cookie 域为空（主机级 Cookie）。**.env 文件保持不变**，因此两种模式可以交替使用。
- 切换默认站点：编辑 `apps/frontend/.env.localhost` 的 `VITE_DEV_SITE_PROFILE`，可填注册站点 id（如 `account`）或其主机前缀（如 `management`、`terminal`）。该文件只被 `pnpm run dev:localhost` 读取，不影响多域名模式。

### 多域名模式与 mkcert

`pnpm run dev`（别名 `pnpm run dev:domains`）会调用 `scripts/setup-local-domains.mjs`：该脚本只在 hosts 区块与证书**需要变化**时请求提权与重签证书，已配置时直接跳过，重复执行不会再次弹出 UAC/`sudo`。退出运行后 hosts 记录与证书会保留，需要清理时执行 `pnpm run local:teardown`；`--force` 可强制重写 hosts 并重签证书。

Windows 的 DNS 客户端**会静默忽略一行中第 10 个及之后的主机名**，因此管理区块按每行最多 9 个主机名分组写入（`scripts/lib/dev-env.mjs` 的 `MAX_HOSTS_PER_LINE`）；手工把这一行合并成长行会让后面十几个站点无法解析，而 hosts 文件看起来仍然正确。

## 常见问题

| 现象                                                        | 原因与处理                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `未找到 Bun`（setup 报告 FAIL）                             | 后端 dev/构建使用 Bun：`powershell -c "irm bun.sh/install.ps1 \| iex"`（macOS/Linux 用官方安装脚本）。                  |
| `MySQL 无法连接`                                            | 启动本机 MySQL 8；首次需建库：`mysql -u root -p -e "CREATE DATABASE QysywDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`（测试库同理，名称必须包含 `test`）。 |
| `数据库迁移失败` 且提示库不存在                             | 先按上一条建库，再执行 `pnpm run setup`；不要改用 `db push` 绕过迁移。                                                 |
| Redis 连接失败（WARN）                                      | 缓存、限流与强制下线能力降级；启动本机 Redis 7 后重启。                                                                |
| `端口被占用：5173/10001/4173`                               | `netstat -ano \| findstr :5173` 找到 PID 后 `taskkill /T /F /PID <PID>`；macOS/Linux 用 `lsof -i :5173`。               |
| 访问 `http://localhost:5173` 被拒绝                         | 默认的 `pnpm run dev` 是多域名模式，必须用 `https://<前缀>.qysyw.test:5173` 访问；要单站点请改用 `pnpm run dev:localhost`。 |
| 浏览器提示某站点“关闭了连接”（`ERR_CONNECTION_CLOSED`）    | URL 少了 `https://`：把明文 HTTP 发给 TLS 端口时服务端只能直接断开。补全 `https://<前缀>.qysyw.test:5173/`。           |
| 部分站点“找不到服务器 / 无法解析”（前面几个却正常）        | hosts 区块被合并成了单行，Windows 只取前 9 个主机名；执行 `pnpm run local:setup` 重新分行写入。                        |
| 多域名模式下浏览器提示证书错误                              | 重新执行 `pnpm run local:setup --force`，并确认 `apps/frontend/.certs/` 下证书存在；`localhost` 不是多域名模式的入口。  |
| HTTPS 页面提示 `HTTP/0.9` 或协议错误                        | 用 `http://` 访问了 HTTPS 端口；改用 `https://`（同上一条的不同浏览器措辞）。                                          |
| 本机配置了代理导致本地站点无法访问                          | 将 `localhost,127.0.0.1,.qysyw.test` 加入 `NO_PROXY`；脚本会在检测到代理时给出提示。                                   |
| 登录 `admin / admin123` 失败（旧数据库）                    | 旧版种子写入 `md5(md5(password))`，当前登录协议无法校验；重新执行 `pnpm run db:seed`，脚本会把遗留哈希修复为 bcrypt（不会覆盖开发者自行修改的密码）。 |
| 前端首次启动很慢                                            | 首次需要生成 `src/client`（数百个文件），仅在客户端缺失或落后于 `swagger.json` 时发生；之后启动会跳过。                |
| 上一轮进程残留占用端口                                      | 正常 Ctrl+C 会连带结束子进程树；若被强制结束，按上面的 `taskkill /T /F` 清理残留。                                     |

## 验证范围建议

改动本地编排脚本或前端启动模式时，最小验证集合：

```bash
pnpm --filter @quyan/frontend test -- tests/node/config/dev-command.node.test.ts tests/node/config/dev-single-site.node.test.ts tests/node/config/first-party-hosts.node.test.ts tests/node/config/site-registry.node.test.ts
pnpm --filter @quyan/frontend type-check
pnpm --filter @quyan/backend test -- tests/unit/config/auth-central-login-origins.unit.test.ts
pnpm run check:env-examples
node scripts/setup-dev.mjs --check
node scripts/setup-local-domains.mjs --dry-run
# 根目录脚本目前不在任何 lint 命令的范围内（pnpm run lint 只遍历 @quyan/* 工作区包），
# 但根 eslint.config.js 已覆盖 scripts/，可检出未定义标识符一类故障。cli-native.ts 是
# 预先存在的解析错误（未接 TypeScript 解析器），因此这里排除它。
pnpm exec eslint scripts --ignore-pattern "scripts/cli-native.ts"
```

`setup-local-domains.mjs` 的幂等快速路径只在 hosts 区块**与**证书文件都已就位时才跳过提权；修改该脚本后，请在证书已存在的机器上再执行一次 `node scripts/setup-local-domains.mjs`，确认输出为
`already configured; nothing to do`（而不是提权或重签证书）。

修改后端 Controller/DTO 时仍需执行 `pnpm run openapi:gen:all`。
