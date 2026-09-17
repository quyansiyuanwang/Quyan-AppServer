# AGENTS.md — AppServerMonorepo

此文件为 AI 编程代理（Codex、Claude Code 等）提供在 monorepo 中工作的指引。

## 仓库技能索引

仓库专用技能位于 `.agents/skills/`，每个技能只包含 `SKILL.md` 和可选的 `KNOWLEDGE.md`。技能按任务加载最小必要上下文；本文件、各项目 `AGENTS.md/CLAUDE.md` 和 `docs/development/` 仍是规范事实来源。

| 技能                                                                                         | 适用范围                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [appserver-backend-development](./.agents/skills/appserver-backend-development/SKILL.md)     | Express、TSOA、Prisma、Relay、后端服务和中间件 |
| [appserver-frontend-development](./.agents/skills/appserver-frontend-development/SKILL.md)   | Vue、Pinia、组件、Service、路由和前端测试      |
| [appserver-testing-ci](./.agents/skills/appserver-testing-ci/SKILL.md)                       | Vitest 分类、隔离、并行、CI 和测试选择         |
| [appserver-contracts](./.agents/skills/appserver-contracts/SKILL.md)                         | shared、权限、DTO、OpenAPI 和生成 SDK          |
| [appserver-security](./.agents/skills/appserver-security/SKILL.md)                           | 认证、授权、密钥、日志和开源安全               |
| [appserver-pr-workflow](./.agents/skills/appserver-pr-workflow/SKILL.md)                     | GitHub PR 检查、元数据和标签                   |
| [appserver-git-workflow](./.agents/skills/appserver-git-workflow/SKILL.md)                   | 本地暂存、验证、Conventional Commit 与交接     |
| [appserver-skill-authoring](./.agents/skills/appserver-skill-authoring/SKILL.md)             | 仓库技能编写、精简、中文化与校验               |
| [appserver-vue-view-splitting](./.agents/skills/appserver-vue-view-splitting/SKILL.md)       | 大型 Vue View 的结构化拆分与状态边界           |
| [appserver-docs-site-development](./.agents/skills/appserver-docs-site-development/SKILL.md) | docs-site 文档编写、注册与用户可见功能同步     |
| [appserver-cli-development](./.agents/skills/appserver-cli-development/SKILL.md)             | Rust CLI、Ratatui、OpenAPI client 与跨平台发布 |

涉及多个领域时，同时读取对应技能；例如 Controller/DTO 变更使用后端与 contracts，权限或 Token 变更再加入 security，Rust CLI 变更加入 `appserver-cli-development`，测试命令选择加入 testing-ci。优先用 `pnpm run mcp:serve` 提供的项目 MCP 获取紧凑上下文，再按需读取完整文档。

## Monorepo 结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @quyan/backend    Express + Prisma + TSOA (port 10001)
│   ├── frontend/          # @quyan/frontend   Vue 3 + Element Plus + Vite (port 5173)
│   ├── docs-site/         # @quyan/docs-site  Vue 3 文档站点
│   └── cli-native/        # quyan            Rust + Ratatui CLI
├── packages/
│   ├── shared/            # @quyan/shared     前后端共享类型与常量（权限、错误码等）
│   └── appserver-mcp/     # @quyan/mcp        AI 代理 stdio MCP
├── integrations/          # 独立 git 子模块（server-sdk、remote-agent）
├── products/              # 独立产品子模块（remote-terminal-cloud）
├── deployment/            # Nginx 反向代理示例
├── scripts/               # 仓库级编排脚本
├── docs/development/      # 详细开发文档
├── package.json           # 根编排脚本
├── pnpm-workspace.yaml    # Workspace 配置
├── CLAUDE.md
└── AGENTS.md
```

## 常用命令

```bash
pnpm run dev                     # 并行启动 backend + frontend + docs-site（CLI 单独启动）
pnpm run dev:frontend            # 只启动前端
pnpm run dev:backend             # 只启动后端
pnpm run dev:docs                # 启动文档站点
pnpm run dev:cli                 # 启动 Quyan CLI
pnpm run build                   # 构建所有项目
pnpm run build:backend           # 只构建后端
pnpm run build:frontend          # 只构建前端
pnpm run build:docs              # 只构建文档站点
pnpm run build:cli:native        # 构建 Rust 原生 CLI
pnpm run openapi:gen:all         # 完整 OpenAPI 生成流水线
pnpm run test                    # 运行所有测试
pnpm run lint                    # 运行所有 lint
pnpm run format                  # 运行所有格式化
pnpm run clean                   # 清理所有 dist
pnpm run precommit               # 完整预提交验证
pnpm run type-check              # 所有项目类型检查
```

### 针对单个项目

```bash
pnpm --filter @quyan/backend dev        # 后端 dev
pnpm --filter @quyan/backend test       # 后端测试
pnpm --filter @quyan/backend test:unit  # 后端单元测试
pnpm --filter @quyan/backend test:api   # 后端集成+契约测试
pnpm --filter @quyan/backend build      # 后端构建
pnpm --filter @quyan/frontend dev       # 前端 dev
pnpm --filter @quyan/frontend build     # 前端构建
pnpm --filter @quyan/docs-site dev      # 文档站点 dev
cargo run --manifest-path apps/cli-native/Cargo.toml # CLI dev
```

## 测试选择工作流

测试必须按变更影响面选择，优先执行最小、可证明正确性的验证命令。**不得因为一次局部修复默认执行裸 `pnpm test`、全量 `test:unit`、全量构建或 `precommit`。**

| 变更范围                                                 | 必需验证                                                           | 仅在需要时扩大                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| 单个后端 util/service/repository                         | 对应 Vitest 文件 + `pnpm --filter @quyan/backend type-check`       | 该模块的相邻单测                           |
| 单个前端组件/composable/store                            | 对应组件测试（如存在）+ `pnpm --filter @quyan/frontend type-check` | 该页面的相关测试                           |
| Controller、DTO、Zod schema、TSOA 路由                   | `pnpm run openapi:gen:all` + 对应 API/单测 + 后端类型检查          | 前端类型检查（生成客户端被业务代码使用时） |
| Prisma schema/迁移、认证、权限、共享包、跨应用契约       | 受影响单测/API 测试 + 相关应用类型检查                             | 合并前执行完整 `precommit`                 |
| 发布候选、明确要求全量、无法可靠限定影响面的基础设施改动 | `pnpm run precommit`；仅用户明确要求时再执行 `pnpm run test`       | 生产构建按发布流程执行                     |

`check:all` 会并行执行仓库级 lint、格式和类型检查；`check:backend`、`check:frontend`、`check:docs` 分别并行检查单一应用。日常局部变更优先使用对应应用命令，不要以 `check:all` 代替精确测试。

运行 Vitest 时必须传入精确文件或目录，例如：

```bash
pnpm --filter @quyan/backend test -- tests/unit/utils/developer-outbound-url.util.test.ts
pnpm --filter @quyan/frontend test -- tests/utils/relay-formats.test.ts
```

执行验证前说明所选范围；完成后报告实际执行的命令和未执行的高成本检查。若修改后端 Controller/DTO/schema，OpenAPI 生成仍是强制步骤，不能因测试范围缩小而跳过。

### Prisma 迁移生成

修改 `apps/backend/prisma/schema.prisma` 时，迁移 SQL 必须通过 `pnpm --filter @quyan/backend exec prisma migrate dev --name <migration-name>` 生成并执行。包装脚本已内置 `--name`，使用时传入名称即可：`pnpm run db:migrate:dev -- <migration-name>`。禁止手写、复制或事后编辑 `prisma/migrations/*/migration.sql`；生产环境只使用已提交迁移的 `pnpm run db:migrate` / `prisma migrate deploy`。

## 共享包 `@quyan/shared`

前后端共享的类型与常量，是权限、错误码等定义的**唯一规范数据源**。位于 `packages/shared/src/`：

| 模块                    | 用途                                                 |
| ----------------------- | ---------------------------------------------------- |
| `permission.ts`         | `Permission` 枚举（130+ 个，`resource:action` 格式） |
| `custom-code.ts`        | `CustomCode` 业务错误码枚举（30+ 个）                |
| `status.ts`             | `ManagedStatus`、`HeartbeatStatus`                   |
| `feedback.ts`           | 反馈类型/状态/优先级常量                             |
| `legal-policy.ts`       | 法律协议类型与发布状态                               |
| `relay-channel.ts`      | 中转渠道状态                                         |
| `client-fingerprint.ts` | 客户端指纹规范化                                     |
| `notification-event.ts` | 通知事件枚举（25 个）                                |

前后端通过 `"@quyan/shared": "workspace:*"` 依赖引用。**修改共享包后前后端自动生效。**

## OpenAPI 生成流水线

```
1. backend: tsoa spec-and-routes → swagger.json + routes.ts
2. scripts/sync-swagger-to-frontend.mjs → 复制 swagger.json 到 frontend/
3. frontend: openapi-ts → src/client/ (typed SDK)
   └─ generate-api-constants.js + generate-api-types-map.js + generate-replay-protected-endpoints.js
```

```bash
pnpm run openapi:gen              # 仅后端生成
pnpm run openapi:sync             # 同步 + 前端客户端生成
pnpm run openapi:gen:all          # 完整流水线
```

**修改后端 Controller/DTO 后必须运行 `pnpm run openapi:gen:all`。**

## GitHub PR 管理流程

需要整理或补全 PR 元数据时，先以 `gh` 读取 PR、改动和近期同目标分支已合并 PR；不要用通用模板覆盖仓库既有风格。

1. 使用 `gh pr view <number>` 与 `gh pr diff <number>` 确认目标分支、提交、改动、现有标题/正文/标签和检查状态。
2. 使用 `gh pr list --state merged --base <base-branch>` 参考近期同目标分支 PR：标题采用 Conventional Commit，正文按提交倒序列出 `- subject (short-sha)`；合并到 `master` 的 PR 需保留已合并 PR 的 `(#number)` 提交行。
3. 标签按实际影响面赋予（如 `frontend`、`backend`、`feature`、`bug`、`api`）；仅因功能改动附带测试时不添加 `test`，除非测试本身是 PR 的主要内容。
4. 用 `gh pr edit` 更新标题、正文和标签后，再用 `gh pr view --json title,body,labels,url` 回读确认。自动 PR 元数据/标签工作流失败时，可手动完成这些非破坏性职责；不得未经用户明确授权合并 PR。

完整说明见 [docs/development/10-pr-management.md](./docs/development/10-pr-management.md)。

## 配置、常量与唯一事实来源（全仓适用）

- **先复用或推导，再新增定义**：域名、站点、路由、权限、错误码、接口路径、产品清单等已有规范来源时，必须引用该来源或其生成产物；禁止在脚本、页面和服务中维护第二份手写映射。
- **必须固定的策略按领域集中管理**：超时、重试、并发、预取、轮询和容量上限应在所属模块的命名策略入口定义，调用点只消费。派生值从基础配置计算，不重复写数值；不要建立混杂全仓职责的巨型配置文件。
- **配置有边界**：部署差异通过既有环境配置及校验入口处理；管理员可调整的业务规则复用服务端配置；纯内部实现策略使用模块常量。不要为了消除字面量盲目新增环境变量或暴露不应调整的安全策略。
- **契约有唯一来源**：跨应用契约与业务常量由 `packages/shared` 或后端 TSOA/OpenAPI 定义；前端调用路径复用按 Controller 生成的描述符，不引入完整 endpoint registry 破坏懒加载。生成文件不得手改。
- **测试与生产分离**：测试账号、模拟响应和故障注入放在具名 fixtures 或测试文件，明确标注用途，不作为生产默认值。临时排查脚本及未确认基线放在 Git 忽略的 `tmp/`，不得静默升级为正式工具或 CI 基准。
- **工具读取真实输入**：构建分析读取 Vite 配置与 manifest；集成测试读取明确的环境/场景输入。无法从规范来源可靠推导时，要求调用者显式提供，不猜测域名、页面结构、业务数据或凭据。
- **保留合理字面量**：协议标识优先用现有枚举；局部且含义明确的结构值、测试断言、样式尺寸不必机械提取。集中管理的目的是消除重复事实和隐含策略，不是把所有字符串和数字改成间接引用。
- **改动时检查重复来源**：新增配置前搜索已有定义；调整策略时检查所有消费者及边界测试；历史代码按影响面渐进治理，不在未验证语义时全仓批量替换。

## 关键架构规则

### 后端

- **TSOA code-first**: 所有路由由 Controller 装饰器自动生成，无手动路由文件
- **3-Layer**: Controller (HTTP) → Service (业务逻辑) → Repository (Prisma)
- **单例模式**: 所有 Service 和 Repository 使用 `getInstance()`
- **中间件链顺序**: `app.ts` 中严格有序，`responseWrapperMiddleware` 必须在 `RegisterRoutes` 之前
- **响应格式**: `{ code: number, message: string, data?: T }`
- **路径别名**: `@src/*` → `src/*`

### 前端

- **`src/client/` 禁止手动编辑**（自动生成，被 ESLint 忽略）
- **Service 层**: 单例模式，封装 generated client 调用
- **Store 层**: Pinia stores 管理状态（request, permission, userInfo, chat 等）
- **事件总线**: 由 i18n、window、aprilFools 等模块提供的单例事件总线
- **路径别名**: `@` → `./src`

### 数据库

- MySQL + Prisma ORM
- 120 个模型，CUID 主键
- 所有模型有 `status` 字段（1=正常, 0=禁用, -1=删除）
- 所有模型有 `createTime`、`updateTime` 时间戳

### 认证

- JWT (access + refresh token)，token 载荷含 `userId` + `updatedAt`
- RBAC: `最终权限 = 组权限 + 附加权限 - 移除权限`
- 支持 OAuth 2.0、RAM 子账户、2FA (TOTP + Passkey)、重放保护

## 重要注意事项

- 测试按分类并行执行：纯单测使用 Vitest 文件并行，数据库/集成测试使用每 worker 独立 MySQL 与 Redis 运行空间；详见 `docs/development/11-testing-and-ci.md`
- JWT access token 开发环境有效期极短（5 秒），生产环境建议 900 秒
- 安全密钥（`REPLAY_SIGNING_MASTER_SECRET`、`TWO_FACTOR_TRUSTED_DEVICE_SECRET`）需 ≥64 字符且与 JWT 密钥不同
- 后端 dev 模式自动运行 `openapi:generate`（nodemon 触发）
- esbuild 编译后端到 `dist/index.cjs` (CommonJS)，Prisma/Sharp 标记为 external
- PM2 cluster 模式运行，`ecosystem.config.cjs` 配置

## 详细文档

完整开发文档位于 `docs/development/`：

| 文档                                                                        | 内容                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| [README.md](./docs/development/README.md)                                   | 文档索引、常用命令速查、关键文件速查                 |
| [01-architecture.md](./docs/development/01-architecture.md)                 | 系统架构：monorepo 结构、技术栈、请求生命周期        |
| [02-backend.md](./docs/development/02-backend.md)                           | 后端：数十个 Controllers/Services、中间件链          |
| [03-frontend.md](./docs/development/03-frontend.md)                         | 前端：组件层次、11 Stores、事件总线、i18n            |
| [04-shared-package.md](./docs/development/04-shared-package.md)             | 共享包：百余项 Permission、CustomCode、所有模块      |
| [05-database.md](./docs/development/05-database.md)                         | 数据库：百余模型、关系、软删除、迁移流程             |
| [06-api-development.md](./docs/development/06-api-development.md)           | API 开发：Controller→DTO→Service→Repository 完整流程 |
| [07-authentication.md](./docs/development/07-authentication.md)             | 认证：JWT/OAuth/RAM/2FA/重放保护/CAPTCHA             |
| [08-openapi-pipeline.md](./docs/development/08-openapi-pipeline.md)         | OpenAPI：TSOA→swagger.json→前端 typed SDK            |
| [09-deployment.md](./docs/development/09-deployment.md)                     | 部署：esbuild/Rolldown 构建、PM2、环境变量           |
| [10-pr-management.md](./docs/development/10-pr-management.md)               | GitHub PR 读取、风格对齐、编辑与标签流程             |
| [11-testing-and-ci.md](./docs/development/11-testing-and-ci.md)             | 测试分类、并行隔离、数据库 worker 与 CI 策略         |
| [12-git-workflow-and-mcp.md](./docs/development/12-git-workflow-and-mcp.md) | Git 交付、commit hook 与项目 MCP                     |
| [13-docs-site.md](./docs/development/13-docs-site.md)                       | docs-site 文档同步、写作规范与验证                   |
| [14-domain-deployment.md](./docs/development/14-domain-deployment.md)       | 多域名、Cookie、CORS 与部署边界                      |
| [15-cli.md](./docs/development/15-cli.md)                                   | Quyan CLI 架构、凭证边界与验证                       |

各项目的 CLAUDE.md/AGENTS.md 位于：

- `apps/backend/CLAUDE.md` — 后端详细架构
- `apps/frontend/CLAUDE.md` / `apps/frontend/AGENTS.md` — 前端详细架构

## 环境要求

- **Node.js**: `^20.19.0 || >=22.12.0`
- **包管理器**: `pnpm@10.33.0`
