# CLAUDE.md — AppServerMonorepo

此文件为 Claude Code 提供在 monorepo 中工作的指引。

> **AI 代理通用指引**：另见 [AGENTS.md](./AGENTS.md)，适用于 Codex 等其他 AI 编码代理。

## Monorepo 结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @appserver/backend    Express + Prisma + TSOA (port 10001)
│   ├── frontend/          # @appserver/frontend   Vue 3 + Element Plus + Vite (port 5173)
│   └── docs-site/         # @appserver/docs-site  Vue 3 文档站点 (VitePress 风格)
├── packages/
│   ├── shared/            # @appserver/shared     前后端共享类型与常量（权限、错误码等）
│   ├── config-typescript/ # 共享 TypeScript 配置 (tsconfig.base.json)
│   ├── config-prettier/   # 共享 Prettier 配置 (.prettierrc.json)
│   └── utils/             # 共享工具函数 (src/index.ts)
├── scripts/               # 仓库级脚本
├── package.json           # 根编排脚本
├── pnpm-workspace.yaml    # Workspace 配置
└── CLAUDE.md
```

所有工作都在 `apps/*` 子目录中完成。

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
pnpm --filter @appserver/backend build      # 后端构建
pnpm --filter @appserver/backend test:unit  # 后端单元测试
pnpm --filter @appserver/backend test:api   # 后端集成+契约测试
pnpm --filter @appserver/frontend dev       # 前端 dev
pnpm --filter @appserver/frontend build     # 前端构建
pnpm --filter @appserver/docs-site dev      # 文档站点 dev
```

## 测试选择工作流

测试按变更影响面执行，优先选择最小且足以验证结果的命令。不要因局部修复默认运行裸 `pnpm test`、全量 `test:unit`、全量构建或 `precommit`。

| 变更范围                                               | 必需验证                                               | 仅在需要时扩大                   |
| ------------------------------------------------------ | ------------------------------------------------------ | -------------------------------- |
| 单个后端 util/service/repository                       | 对应 Vitest 文件 + 后端类型检查                        | 相邻模块单测                     |
| 单个前端组件/composable/store                          | 对应组件测试（如存在）+ 前端类型检查                   | 当前页面相关测试                 |
| Controller、DTO、Zod schema、TSOA 路由                 | `pnpm run openapi:gen:all` + 对应测试 + 后端类型检查   | 生成客户端被使用时的前端类型检查 |
| Prisma、认证、权限、共享包、跨应用契约                 | 受影响单测/API 测试 + 相关类型检查                     | 合并前完整 `precommit`           |
| 发布候选、用户明确要求全量、基础设施改动无法收窄影响面 | `pnpm run precommit`；仅明确要求时运行 `pnpm run test` | 按发布流程生产构建               |

`check:all` 并行执行仓库级 lint、格式和类型检查；`check:backend`、`check:frontend`、`check:docs` 分别并行检查单一应用。局部变更优先选用对应应用命令，不要用 `check:all` 替代精确测试。

Vitest 必须使用精确文件或目录：

```bash
pnpm --filter @appserver/backend test -- tests/unit/utils/developer-outbound-url.util.test.ts
pnpm --filter @appserver/frontend test -- tests/utils/relay-formats.test.ts
```

开始验证前说明范围；完成后报告已执行命令及未执行的高成本检查。后端 Controller/DTO/schema 变更无论测试范围如何，都必须执行完整 OpenAPI 生成。

## 共享包 `@appserver/shared`

前后端共享的类型与常量，是权限、错误码等定义的**唯一规范数据源**（single source of truth）。位于 `packages/shared/src/`：

| 模块                    | 用途                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `permission.ts`         | `Permission` 枚举（`resource:action` 格式）+ `ALL_PERMISSIONS` + `getPermissionCategory()` |
| `custom-code.ts`        | `CustomCode` 业务错误码枚举                                                                |
| `status.ts`             | `ManagedStatus`、`HeartbeatStatus` 类型                                                    |
| `feedback.ts`           | 反馈类型/状态/优先级/评论可见性常量                                                        |
| `legal-policy.ts`       | 法律协议类型与发布状态                                                                     |
| `relay-channel.ts`      | 中转渠道状态                                                                               |
| `client-fingerprint.ts` | 客户端指纹规范化函数                                                                       |
| `notification-event.ts` | 通知事件枚举                                                                               |

前后端通过 `"@appserver/shared": "workspace:*"` 依赖引用。修改共享包后前后端自动生效（无需重新构建包）。

## OpenAPI 生成流水线

完整流水线由三个步骤组成：

```
1. backend: tsoa spec-and-routes → swagger.json + routes.ts
2. scripts/sync-swagger-to-frontend.mjs → 复制 swagger.json 到 frontend/
3. frontend: openapi-ts → src/client/ (typed SDK)
   └─ generate-api-constants.js + generate-api-types-map.js + generate-replay-protected-endpoints.js
```

对应命令：

```bash
pnpm run openapi:gen              # 仅后端生成 swagger.json + routes.ts
pnpm run openapi:sync             # 同步 swagger.json 到前端 + 生成前端客户端
pnpm run openapi:gen:all          # 完整流水线（上述两步）
```

**注意**：修改后端 controllers 或 DTOs 后，必须运行 `pnpm run openapi:gen:all` 才能让前端获取到最新的 API 类型。

## 仓库级脚本

| 脚本                                        | 用途                                            |
| ------------------------------------------- | ----------------------------------------------- |
| `scripts/sync-swagger-to-frontend.mjs`      | 将后端 `swagger.json` 复制到前端 `src/client/`  |
| `scripts/validate-frontend-permissions.mjs` | 校验前端权限常量与后端 `@appserver/shared` 一致 |

## GitHub PR 管理

PR 标题、正文和标签的整理流程以 [AGENTS.md](./AGENTS.md) 和
[docs/development/10-pr-management.md](./docs/development/10-pr-management.md) 为准。编辑前必须参考近期同目标分支已合并 PR 的元数据风格，并在编辑后使用 `gh pr view` 回读确认。

## 共享配置包

### TypeScript 配置

各项目在 `tsconfig.json` 中引用：

```json
{
  "extends": "@appserver/config-typescript/tsconfig.base.json"
}
```

### ESLint 配置

```ts
import appserverConfig from '@appserver/config-eslint'
export default [
  ...appserverConfig,
  {
    /* 项目特有规则 */
  },
]
```

## 架构

详见各项目内的 CLAUDE.md：

- `apps/backend/CLAUDE.md` — 后端架构 (TSOA 3层模式、权限系统、认证、中间件链、测试)
- `apps/frontend/CLAUDE.md` — 前端架构 (Vue 3、Pinia、API 客户端、事件总线、i18n)

## 详细开发文档

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
| [10-pr-management.md](./docs/development/10-pr-management.md)       | GitHub PR 读取、风格对齐、编辑与标签流程             |

## 环境要求

- **Node.js**: `^20.19.0 || >=22.12.0`
- **包管理器**: `pnpm@10.33.0`

## 原项目目录

原始项目保留在 `D:\Developments\AppServer\` 根目录作为回退：

- `NodeBackend/`、`Frontend/`、`DocsSite/`

新开发请使用 `AppServerMonorepo/` 目录。
