# AppServer Monorepo

基于 pnpm workspace 的全栈应用 monorepo，整合了后台管理面板、RESTful API 服务、静态官网及文档站点。

## 项目结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @quyan/backend    Express + Prisma + TSOA API 服务
│   ├── frontend/          # @quyan/frontend   Vue 3 + Element Plus 管理面板
│   ├── docs-site/         # @quyan/docs-site   Vue 3 文档站点
│   └── cli-native/        # quyan             Rust + Ratatui native CLI
├── packages/              # 共享包（配置、工具等）
├── integrations/server-sdk/
│                           # Git submodule：面向接入方的 SDK、模板与 Demo
├── products/remote-terminal-cloud/
│                           # Git submodule：独立发布的 Rust + Tauri Agent
├── .cspell/               # 拼写检查词表
├── .husky/                # Git hooks
├── .github/               # GitHub Actions 工作流
├── package.json           # 根编排脚本
├── pnpm-workspace.yaml    # Workspace 配置
└── LICENSE                # Apache 2.0
```

## 技术栈

| 项目          | 框架                   | 构建          | 数据库         | 主要依赖                            |
| ------------- | ---------------------- | ------------- | -------------- | ----------------------------------- |
| **backend**   | Express 5 + TypeScript | esbuild + Bun | MySQL (Prisma) | TSOA, JWT, Redis, WebSocket         |
| **frontend**  | Vue 3 + TypeScript     | Rolldown Vite | -              | Element Plus, Pinia, Axios, ECharts |
| **docs-site** | Vue 3 + TypeScript     | Rolldown Vite | -              | marked, mermaid                     |

## 前置要求

| 依赖            | 版本                     | 用途                                         |
| --------------- | ------------------------ | -------------------------------------------- |
| Node.js         | `^20.19.0 \|\| >=22.12.0` | 全仓工具链                                   |
| pnpm            | `10.33.0`                | 包管理（`corepack enable` 可自动匹配版本）   |
| Bun             | `>= 1.3`                 | 后端 dev 与构建运行时                        |
| MySQL           | 8.x                      | 后端数据库                                   |
| Redis           | 7.x                      | 后端缓存、限流与会话                         |
| mkcert（可选）  | —                        | 仅 `pnpm run dev` / `dev:domains` 多域名 HTTPS 需要 |

Rust 工具链仅在开发或打包原生 CLI（`apps/cli-native`）时需要。`pnpm run doctor` 会逐项检查以上依赖并就缺失项给出可直接复制的修复命令。

## 快速开始

```bash
# 克隆（包含独立发布的 Agent 子模块）
git clone --recurse-submodules https://github.com/quyansiyuanwang/Quyan-AppServer.git
cd Quyan-AppServer

# 安装依赖
pnpm install

# 幂等初始化：生成 .env（随机开发密钥）、Prisma Client、前端 API 客户端、数据库迁移与种子数据
pnpm run setup

# 启动多域名本地站点（首次需要 mkcert 与写入 hosts 的权限）
pnpm run dev

# 访问（按 hostname 区分站点；完整清单见 docs/development/16-local-development.md）
# - 公共站点:   https://www.qysyw.test:5173/
# - 账号站点:   https://account.qysyw.test:5173/overview
# - 运营管理:   https://management.qysyw.test:5173/overview
# - 认证站点:   https://auth.qysyw.test:5173/login
# - API 服务:  http://localhost:10001
# - Swagger UI: http://localhost:10001/docs
# - 文档站点:  http://localhost:4173
# - 种子账号:  admin / admin123
```

没有 hosts/mkcert 或管理员权限时，改用免特权单站点命令 `pnpm run dev:localhost`（只服务 `http://localhost:5173` 一个站点）。

不需要手工复制 `.env`：`pnpm run setup` 从 `.env.example` 生成 `apps/*/.env` 并填充互不相同的随机开发密钥，**从不覆盖已有文件**。请先启动本机 MySQL 与 Redis；未就绪时 `setup` 会打印按 `DATABASE_URL` 派生的建库语句并以非零状态退出。

常用补充命令：

```bash
pnpm run doctor         # 只读诊断（工具链、.env、生成物、MySQL/Redis）
pnpm run setup --skip-seed --skip-db   # 只准备配置与生成物
```

### 两种本地启动模式

| 模式             | 命令                   | 站点拓扑                                    | 环境要求                            | 能力边界                                                               |
| ---------------- | ---------------------- | ------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| 多域名 HTTPS     | `pnpm run dev`（默认） | `https://<站点前缀>.qysyw.test:5173`        | 首次需要 mkcert 与写入 hosts 的权限 | 与生产多域名拓扑一致，覆盖全部能力                                     |
| 免特权单站点     | `pnpm run dev:localhost` | 单一注册站点运行在 `http://localhost:5173` | 无（不需要 mkcert 或管理员权限）    | Passkey、社交 OAuth 回跳、扫码登录与站点切换不可用，请改用 `pnpm run dev` |

多域名模式下每个站点有独立 hostname 与路由树，例如公共站 `www`、账号站 `account`、云终端 `terminal`、运营管理 `management`、以及各产品控制台 `<产品>.console`；`localhost` 与未注册 hostname 会显示拒绝页面，这是隔离的预期行为。

`pnpm run dev`（等价别名 `pnpm run dev:domains`）首次会写入 hosts 并生成 `apps/frontend/.certs/` 证书；之后重复执行不会再提权、也不会重签证书（`--force` 可强制重建）。退出后 hosts 记录与证书**保留**，需要清理时执行 `pnpm run local:teardown`。

免特权模式默认渲染运营管理站点，可在 `apps/frontend/.env.localhost` 中通过 `VITE_DEV_SITE_PROFILE` 切换为其他注册站点（例如 `account`、`public`、`terminal`、`chat`）。

### 独立交付物子模块

两个目录都不属于 pnpm workspace：

- `products/remote-terminal-cloud` 是面向终端用户的 Rust/Tauri 产品，保持独立工具链与发布节奏。
- `integrations/server-sdk` 是面向第三方接入方的多语言 SDK、模板与可运行 Demo，保持独立版本和仓库历史。

已克隆主仓但缺少子模块时运行：

```bash
git submodule update --init --recursive
```

更新到主仓已记录的版本使用上面的命令；维护者要更新引用时，在子模块拉取并验证目标提交后，在主仓提交新的 gitlink。各交付物的构建与校验请在其子模块目录内按 README 执行。

## 常用命令

### 开发

```bash
pnpm run setup            # 幂等初始化（配置、生成物、迁移、种子数据）
pnpm run doctor           # 只读诊断本地环境
pnpm run dev              # 多域名：backend + frontend + docs-site（https://<站点前缀>.qysyw.test:5173）
pnpm run dev:domains      # 同上，语义化别名
pnpm run dev:localhost    # 免特权单站点：backend + frontend + docs-site（http://localhost:5173）
pnpm run dev:backend      # 只启动后端
pnpm run dev:frontend     # 只启动前端
pnpm run dev:docs         # 启动文档站点
pnpm run dev:cli          # 启动 Quyan CLI
```

只启动单个应用时，前端 dev 会按需生成被忽略的 `src/client` API 客户端（`pnpm run ensure:openapi-client`），后端仍需要 `apps/backend/.env`。

### 构建

```bash
pnpm run build:backend    # 只构建后端
pnpm run build:frontend   # 只构建前端
pnpm run build:docs       # 只构建文档站点
pnpm run build:cli:native # 构建 Rust 原生 CLI
pnpm run build            # 后端与前端并行构建（文档站使用空出的构建槽）
pnpm run build:full       # 先生成 OpenAPI，再并行构建所有应用
pnpm run build:full:production # production 版完整构建
```

### 代码质量

```bash
pnpm run lint             # ESLint 全量检查
pnpm run format           # Prettier 格式化
pnpm run type-check       # TypeScript 类型检查
pnpm run lint:all         # lint + format + type-check 并行
pnpm run check:all        # lint:check + format:check + type-check 并行
pnpm run spell:check      # 拼写检查
pnpm run clean            # 清理所有 dist
pnpm run package:cli:native # 打包当前平台原生制品
```

### 测试

```bash
# 根级命令并行运行 backend 与 frontend
pnpm run test

# Backend: 按依赖选择最小测试范围
pnpm --filter @quyan/backend run test:unit
pnpm --filter @quyan/backend run test:database
pnpm --filter @quyan/backend run test:integration
pnpm --filter @quyan/backend run test:contract
pnpm --filter @quyan/backend run test:runtime

# Frontend: Node 逻辑与 DOM 组件分开执行
pnpm --filter @quyan/frontend run test:node
pnpm --filter @quyan/frontend run test:dom
pnpm --filter @quyan/frontend run test:taxonomy
```

测试分类、并行边界、数据库 worker 隔离和 CI 选择策略见 [测试与 CI 文档](./docs/development/11-testing-and-ci.md)。

### 提交

```bash
pnpm run precommit        # OpenAPI 生成 + 代码检查（CI 风格）
pnpm run commit -- -m "fix: your change" # precommit + Git hooks + git commit
```

提交时会通过 `lint-staged` 自动对暂存文件执行 ESLint 检查。
`commit-msg` hook 会使用 commitlint 校验英文 Conventional Commit；提交格式与紧急绕过说明见 [Git 交付与项目 MCP](./docs/development/12-git-workflow-and-mcp.md)。

### 项目 MCP

```bash
pnpm run mcp:serve        # 启动本机 stdio MCP server
```

根 `.mcp.json` 提供通用客户端配置。MCP 可紧凑返回 Git 影响面、验证建议和提交信息草稿，并只允许运行固定验证命令；完整接入方式见 [Git 交付与项目 MCP](./docs/development/12-git-workflow-and-mcp.md)。

### 安全

公开仓库前请阅读 [SECURITY.md](./SECURITY.md)。漏洞只接受 GitHub Private Vulnerability Reporting 私密报告，不要在公开 Issue 披露可利用细节。

### 数据库

```bash
pnpm run db:generate      # 生成 Prisma Client
pnpm run db:migrate       # 执行已提交迁移（生产/本地初始化）
pnpm run db:migrate:dev   # 创建开发迁移
pnpm run db:seed          # 填充种子数据（可重复执行）
pnpm run db:push          # 仅用于临时试验：推送 schema 而不生成迁移
```

本地初始化统一使用 `pnpm run setup`（内部执行 `migrate deploy` + `seed`），不要用 `db:push` 替代迁移。

### OpenAPI 生成管线

```bash
pnpm run openapi:gen      # 仅生成后端 OpenAPI spec
pnpm run openapi:sync     # 同步 spec 到前端并生成客户端
pnpm run openapi:gen:all  # 完整管线（后端 spec → 前端客户端）
```

后端通过 TSOA 装饰器自动生成 OpenAPI spec，前端通过 `@hey-api/openapi-ts` 生成类型安全 SDK。

## 架构概览

### 后端（3 层模式）

```
Controller (HTTP) → Service (业务逻辑) → Repository (Prisma 数据访问)
```

- 路由由 TSOA 装饰器自动生成，无手动路由文件
- 服务层使用单例模式 `Service.getInstance()`
- 权限系统：RBAC（角色基础访问控制）
- 认证：JWT access + refresh token

### 前端

```
View 组件 → src/service/ (业务逻辑) → src/client/ (自动生成 SDK) → Axios (请求) → Backend
```

- 状态管理：Pinia
- API 客户端自动从后端 OpenAPI spec 生成
- 国际化：vue-i18n（中/英）
- 权限在 Pinia store 中同步，控制 UI 元素显隐

### CI/CD

GitHub Actions 工作流按目录路径过滤，仅变更相关项目时触发对应流水线。

- `quality-check.yml` — 全量质量检查
- `test-backend.yml` / `test-frontend.yml` — 按路径过滤的测试
- `deploy.yml` — 后端部署；前端和 docs-site 当前通过独立静态站点部署
- `ai-pr-review.yml` / `auto-pr.yml` — PR 自动化与审核

## 项目文档

各子项目内含详细的架构说明：

- [apps/backend/CLAUDE.md](apps/backend/CLAUDE.md) — 后端架构、权限、认证等
- [apps/frontend/CLAUDE.md](apps/frontend/CLAUDE.md) — 前端架构、API 调用模式等

## 许可证

[Apache License 2.0](LICENSE) © 2026 quyansiyuanwang
