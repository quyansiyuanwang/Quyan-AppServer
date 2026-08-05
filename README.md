# AppServer Monorepo

基于 pnpm workspace 的全栈应用 monorepo，整合了后台管理面板、RESTful API 服务、静态官网及文档站点。

## 项目结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @appserver/backend    Express + Prisma + TSOA API 服务
│   ├── frontend/          # @appserver/frontend   Vue 3 + Element Plus 管理面板
│   └── docs-site/         # @appserver/docs-site   Vue 3 文档站点
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

- **Node.js**: `^20.19.0 || >=22.12.0`
- **pnpm**: `^10.33.0`
- **Bun**: 开发/构建后端所需
- **MySQL**: 后端数据库
- **Redis**: 后端缓存/会话

## 快速开始

```bash
# 克隆（包含独立发布的 Agent 子模块）
git clone --recurse-submodules https://github.com/quyansiyuanwang/Quyan-AppServer.git
cd Quyan-AppServer

# 安装依赖
pnpm install

# 初始化后端数据库（首次）
pnpm --filter @appserver/backend db:push
pnpm --filter @appserver/backend db:seed

# 启动开发服务器
pnpm run dev

# 访问
# - 管理面板: http://localhost:5173
# - API 服务: http://localhost:10001
# - Swagger UI: http://localhost:10001/docs
# - 文档站点: http://localhost:4173
```

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
pnpm run dev              # 并行启动 backend + frontend + docs-site
pnpm run dev:backend      # 只启动后端
pnpm run dev:frontend     # 只启动前端
pnpm run dev:docs         # 启动文档站点
```

### 构建

```bash
pnpm run build            # 构建所有项目（含类型检查）
pnpm run build:backend    # 只构建后端
pnpm run build:frontend   # 只构建前端
pnpm run build:docs       # 只构建文档站点
pnpm run build:full       # 完整构建（OpenAPI 生成 + 构建）
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
```

### 测试

```bash
# 根级命令并行运行 backend 与 frontend
pnpm run test

# Backend: 按依赖选择最小测试范围
pnpm --filter @appserver/backend run test:unit
pnpm --filter @appserver/backend run test:database
pnpm --filter @appserver/backend run test:integration
pnpm --filter @appserver/backend run test:contract
pnpm --filter @appserver/backend run test:runtime

# Frontend: Node 逻辑与 DOM 组件分开执行
pnpm --filter @appserver/frontend run test:node
pnpm --filter @appserver/frontend run test:dom
pnpm --filter @appserver/frontend run test:taxonomy
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
pnpm run db:push          # 推送 schema 变更
pnpm run db:migrate:dev   # 创建开发迁移
pnpm run db:migrate       # 执行生产迁移
pnpm run db:seed          # 填充种子数据
```

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
- `deploy-*.yml` — 各应用独立部署

## 项目文档

各子项目内含详细的架构说明：

- [apps/backend/CLAUDE.md](apps/backend/CLAUDE.md) — 后端架构、权限、认证等
- [apps/frontend/CLAUDE.md](apps/frontend/CLAUDE.md) — 前端架构、API 调用模式等

## 许可证

[Apache License 2.0](LICENSE) © 2026 quyansiyuanwang
