# AGENTS.md — AppServerMonorepo

此文件为 AI 编程代理（Codex、Claude Code 等）提供在 monorepo 中工作的指引。

## Monorepo 结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @appserver/backend    Express + Prisma + TSOA (port 10001)
│   ├── frontend/          # @appserver/frontend   Vue 3 + Element Plus + Vite (port 5173)
│   └── docs-site/         # @appserver/docs-site  Vue 3 文档站点
├── packages/
│   ├── shared/            # @appserver/shared     前后端共享类型与常量（权限、错误码等）
│   ├── config-typescript/ # 共享 TypeScript 配置
│   ├── config-prettier/   # 共享 Prettier 配置
│   └── utils/             # 共享工具函数
├── scripts/               # 仓库级编排脚本
├── docs/development/      # 详细开发文档
├── package.json           # 根编排脚本
├── pnpm-workspace.yaml    # Workspace 配置
├── CLAUDE.md
└── AGENTS.md
```

## 常用命令

```bash
pnpm run dev                     # 并行启动 backend + frontend
pnpm run dev:frontend            # 只启动前端
pnpm run dev:backend             # 只启动后端
pnpm run dev:docs                # 启动文档站点
pnpm run build                   # 构建所有项目
pnpm run build:backend           # 只构建后端
pnpm run build:frontend          # 只构建前端
pnpm run build:docs              # 只构建文档站点
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
pnpm --filter @appserver/backend dev        # 后端 dev
pnpm --filter @appserver/backend test       # 后端测试
pnpm --filter @appserver/backend test:unit  # 后端单元测试
pnpm --filter @appserver/backend test:api   # 后端集成+契约测试
pnpm --filter @appserver/backend build      # 后端构建
pnpm --filter @appserver/frontend dev       # 前端 dev
pnpm --filter @appserver/frontend build     # 前端构建
pnpm --filter @appserver/docs-site dev      # 文档站点 dev
```

## 测试选择工作流

测试必须按变更影响面选择，优先执行最小、可证明正确性的验证命令。**不得因为一次局部修复默认执行裸 `pnpm test`、全量 `test:unit`、全量构建或 `precommit`。**

| 变更范围                                                 | 必需验证                                                               | 仅在需要时扩大                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| 单个后端 util/service/repository                         | 对应 Vitest 文件 + `pnpm --filter @appserver/backend type-check`       | 该模块的相邻单测                           |
| 单个前端组件/composable/store                            | 对应组件测试（如存在）+ `pnpm --filter @appserver/frontend type-check` | 该页面的相关测试                           |
| Controller、DTO、Zod schema、TSOA 路由                   | `pnpm run openapi:gen:all` + 对应 API/单测 + 后端类型检查              | 前端类型检查（生成客户端被业务代码使用时） |
| Prisma schema/迁移、认证、权限、共享包、跨应用契约       | 受影响单测/API 测试 + 相关应用类型检查                                 | 合并前执行完整 `precommit`                 |
| 发布候选、明确要求全量、无法可靠限定影响面的基础设施改动 | `pnpm run precommit`；仅用户明确要求时再执行 `pnpm run test`           | 生产构建按发布流程执行                     |

`check:all` 会并行执行仓库级 lint、格式和类型检查；`check:backend`、`check:frontend`、`check:docs` 分别并行检查单一应用。日常局部变更优先使用对应应用命令，不要以 `check:all` 代替精确测试。

运行 Vitest 时必须传入精确文件或目录，例如：

```bash
pnpm --filter @appserver/backend test -- tests/unit/utils/developer-outbound-url.util.test.ts
pnpm --filter @appserver/frontend test -- tests/utils/relay-formats.test.ts
```

执行验证前说明所选范围；完成后报告实际执行的命令和未执行的高成本检查。若修改后端 Controller/DTO/schema，OpenAPI 生成仍是强制步骤，不能因测试范围缩小而跳过。

## 共享包 `@appserver/shared`

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

前后端通过 `"@appserver/shared": "workspace:*"` 依赖引用。**修改共享包后前后端自动生效。**

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
- **事件总线**: 6 个 EventBus 实例（auth, web, customCode, i18n, window, global）
- **路径别名**: `@` → `./src`

### 数据库

- MySQL + Prisma ORM
- 68 个模型，CUID 主键
- 所有模型有 `status` 字段（1=正常, 0=禁用, -1=删除）
- 所有模型有 `createTime`、`updateTime` 时间戳

### 认证

- JWT (access + refresh token)，token 载荷含 `userId` + `updatedAt`
- RBAC: `最终权限 = 组权限 + 附加权限 - 移除权限`
- 支持 OAuth 2.0、RAM 子账户、2FA (TOTP + Passkey)、重放保护

## 重要注意事项

- 测试顺序执行（不并行），避免数据库冲突
- JWT access token 开发环境有效期极短（5 秒），生产环境建议 900 秒
- 安全密钥（`REPLAY_SIGNING_MASTER_SECRET`、`TWO_FACTOR_TRUSTED_DEVICE_SECRET`）需 ≥64 字符且与 JWT 密钥不同
- 后端 dev 模式自动运行 `openapi:generate`（nodemon 触发）
- esbuild 编译后端到 `dist/index.cjs` (CommonJS)，Prisma/Sharp 标记为 external
- PM2 cluster 模式运行，`ecosystem.config.cjs` 配置

## 详细文档

完整开发文档位于 `docs/development/`：

| 文档                                                                | 内容                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| [README.md](./docs/development/README.md)                           | 文档索引、常用命令速查、关键文件速查                 |
| [01-architecture.md](./docs/development/01-architecture.md)         | 系统架构：monorepo 结构、技术栈、请求生命周期        |
| [02-backend.md](./docs/development/02-backend.md)                   | 后端：47 Controllers、56 Services、中间件链          |
| [03-frontend.md](./docs/development/03-frontend.md)                 | 前端：组件层次、11 Stores、事件总线、i18n            |
| [04-shared-package.md](./docs/development/04-shared-package.md)     | 共享包：130+ Permission、CustomCode、所有模块        |
| [05-database.md](./docs/development/05-database.md)                 | 数据库：68 模型、关系、软删除、迁移流程              |
| [06-api-development.md](./docs/development/06-api-development.md)   | API 开发：Controller→DTO→Service→Repository 完整流程 |
| [07-authentication.md](./docs/development/07-authentication.md)     | 认证：JWT/OAuth/RAM/2FA/重放保护/CAPTCHA             |
| [08-openapi-pipeline.md](./docs/development/08-openapi-pipeline.md) | OpenAPI：TSOA→swagger.json→前端 typed SDK            |
| [09-deployment.md](./docs/development/09-deployment.md)             | 部署：esbuild/Rolldown 构建、PM2、环境变量           |

各项目的 CLAUDE.md/AGENTS.md 位于：

- `apps/backend/CLAUDE.md` — 后端详细架构
- `apps/frontend/CLAUDE.md` / `apps/frontend/AGENTS.md` — 前端详细架构

## 环境要求

- **Node.js**: `^20.19.0 || >=22.12.0`
- **包管理器**: `pnpm@10.33.0`
