# AppServerMonorepo — 开发文档

本目录包含 AppServerMonorepo 的完整开发文档。文档按主题组织，从高层架构概览到具体开发流程。

## 文档索引

| 文档                                                       | 内容                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| [01-architecture.md](./01-architecture.md)                 | 项目技术全景概述：架构、技术栈、核心模块亮点（求职展示入口）  |
| [02-backend.md](./02-backend.md)                           | 后端详解：TSOA 3层模式、47 Controllers、60 Services、中间件链 |
| [03-frontend.md](./03-frontend.md)                         | 前端详解：143 页面、12 Pinia stores、52 Services、事件总线    |
| [04-shared-package.md](./04-shared-package.md)             | 共享包：135+ Permission 枚举、47 CustomCode、22 种通知事件    |
| [05-database.md](./05-database.md)                         | 数据库：71 个 Prisma 模型、关系、软删除模式                   |
| [06-api-development.md](./06-api-development.md)           | API 开发流程：添加 Controller、DTO、Service、Repository       |
| [07-authentication.md](./07-authentication.md)             | 认证与授权：JWT、OAuth 2.0、RAM 权限、2FA、重放保护           |
| [08-openapi-pipeline.md](./08-openapi-pipeline.md)         | OpenAPI 生成流水线：TSOA → swagger.json → 前端 typed SDK      |
| [09-deployment.md](./09-deployment.md)                     | 构建与部署：esbuild、PM2、环境变量、生产注意事项              |
| [10-pr-management.md](./10-pr-management.md)               | GitHub PR 读取、风格对齐、编辑与标签流程                      |
| [11-testing-and-ci.md](./11-testing-and-ci.md)             | 测试分类、并行隔离、数据库 worker 与 GitHub Actions 策略      |
| [12-git-workflow-and-mcp.md](./12-git-workflow-and-mcp.md) | Git 交付、commit hook 与项目 MCP                              |
| [13-docs-site.md](./13-docs-site.md)                       | docs-site 文档同步、写作规范与验证                            |

## 快速导航

### 我想了解……

- **整体架构** → [01-architecture.md](./01-architecture.md)
- **后端如何工作** → [02-backend.md](./02-backend.md)
- **前端如何工作** → [03-frontend.md](./03-frontend.md)
- **权限有哪些** → [04-shared-package.md](./04-shared-package.md)
- **数据库有哪些表** → [05-database.md](./05-database.md)
- **如何添加新接口** → [06-api-development.md](./06-api-development.md)
- **认证流程** → [07-authentication.md](./07-authentication.md)
- **如何生成 API 客户端** → [08-openapi-pipeline.md](./08-openapi-pipeline.md)
- **如何部署** → [09-deployment.md](./09-deployment.md)
- **如何整理 PR 元数据** → [10-pr-management.md](./10-pr-management.md)
- **如何选择和运行测试** → [11-testing-and-ci.md](./11-testing-and-ci.md)
- **如何规范提交和使用项目 MCP** → [12-git-workflow-and-mcp.md](./12-git-workflow-and-mcp.md)
- **如何同步和编写 docs-site 文档** → [13-docs-site.md](./13-docs-site.md)
- **开源前如何检查安全配置** → [SECURITY.md](../../SECURITY.md)

### 常用命令速查

```bash
cd AppServerMonorepo

# 开发
pnpm run dev                     # 并行启动 backend + frontend + docs-site
pnpm run dev:backend             # 只启动后端 (port 10001)
pnpm run dev:frontend            # 只启动前端 (port 5173)
pnpm run dev:docs                # 只启动文档站点 (port 4173)

# OpenAPI
pnpm run openapi:gen:all         # 完整流水线（后端 spec → 同步 → 前端客户端）

# 测试：根级命令并行运行两个应用
pnpm run test

# 后端：按测试层级选择
pnpm --filter @appserver/backend run test:unit
pnpm --filter @appserver/backend run test:database
pnpm --filter @appserver/backend run test:integration
pnpm --filter @appserver/backend run test:contract
pnpm --filter @appserver/backend run test:runtime

# 前端：Node 与 DOM 分层
pnpm --filter @appserver/frontend run test:node
pnpm --filter @appserver/frontend run test:dom
pnpm --filter @appserver/frontend run test:taxonomy

# 本地 Git 交付与 MCP
pnpm run mcp:serve              # 启动本机 stdio MCP server
pnpm run commit -- -m "fix: ..." # 完整 precommit 后正常提交

# 数据库
pnpm run db:generate             # 生成 Prisma client
pnpm run db:push                 # 推送 schema（开发环境）
pnpm run db:migrate:dev          # 创建迁移

# 代码质量
pnpm run precommit               # 完整预提交检查
pnpm run type-check              # 所有项目类型检查
pnpm run lint                    # 所有项目 lint
pnpm run format                  # 所有项目格式化
```

## 关键文件速查

| 文件                                        | 用途                                  |
| ------------------------------------------- | ------------------------------------- |
| `apps/backend/src/app.ts`                   | Express 应用组装、中间件链            |
| `apps/backend/src/main.ts`                  | 服务入口、PM2 集群                    |
| `apps/backend/prisma/schema.prisma`         | 数据库 schema（71 个模型）            |
| `apps/backend/tsoa.json`                    | TSOA 配置（安全方案、路由生成）       |
| `apps/frontend/src/stores/request.ts`       | Axios 实例、JWT 拦截器                |
| `apps/frontend/src/router/routes.ts`        | 前端路由定义                          |
| `apps/frontend/src/client/`                 | 自动生成的 API 客户端（不可手动编辑） |
| `packages/shared/src/permission.ts`         | 权限枚举（唯一规范源）                |
| `packages/shared/src/custom-code.ts`        | 业务错误码枚举                        |
| `scripts/sync-swagger-to-frontend.mjs`      | OpenAPI 同步脚本                      |
| `scripts/validate-frontend-permissions.mjs` | 权限一致性校验                        |
