# NodeBackend API 服务

`NodeBackend` 是 `AppServer` 的核心后端，基于 Bun + Express + TypeScript + Prisma + TSOA，采用 `Controller -> Service -> Repository` 三层架构。

## 技术栈

- Bun
- Express 5
- TypeScript
- Prisma + MySQL
- TSOA + Swagger UI
- Vitest + Supertest
- esbuild

## 核心能力

- JWT 认证与刷新
- RBAC 权限控制
- OpenAPI 文档与路由自动生成
- Prisma 类型安全数据访问
- 业务日志与系统日志
- 邮件、通知、Webhook、OAuth 等后端能力

## 环境要求

- Bun
- MySQL 8+
- `pnpm@10.33.0`

## 快速开始

```bash
pnpm install
pnpm run db:generate
pnpm run db:push
pnpm run db:seed
pnpm run dev
```

默认地址：`http://localhost:10001`

Swagger：`http://localhost:10001/docs`

远程终端内嵌网关：`ws://localhost:10001/remote-terminal/ws`

## 常用命令

### 开发与校验

```bash
pnpm run dev
pnpm run tsx
pnpm run type-check
pnpm run check
pnpm run arch:check
pnpm run lint-format-check
pnpm run precommit
```

### 构建与运行

```bash
pnpm run build
pnpm run build:prod
pnpm run build:full:prod
pnpm run start
pnpm run start:prod
```

### 数据库

```bash
pnpm run db:generate
pnpm run db:push
pnpm run db:push:prod
pnpm run db:migrate:dev -- <name>
pnpm run db:migrate:deploy
pnpm run db:seed
pnpm run db:migrate:reset
```

### OpenAPI

```bash
pnpm run tsoa:spec-and-routes
pnpm run openapi:generate
pnpm run generate-operation-ids
```

### 测试

```bash
pnpm run test
pnpm run test:unit
pnpm run test:database
pnpm run test:integration
pnpm run test:contract
pnpm run test:runtime
pnpm run test:api
pnpm run test:coverage
pnpm run test:db:clean
```

纯单测不连接 MySQL 或 Redis；数据库、集成和运行时 contract 测试使用每 worker 独立的派生测试库。所有测试命令会先生成 Prisma Client，但只有运行时测试会创建派生库和执行 schema bootstrap。完整并行与恢复说明见 [测试指南](./docs/develop/06-testing-guide.md)。

## 目录结构

```text
NodeBackend/
  prisma/              # Prisma schema、seed、迁移
  src/
    api/               # TSOA controller、DTO、response
    services/          # 业务逻辑
    store/             # Prisma 数据访问仓储
    middleware/        # 中间件与鉴权
    constant/          # 常量与枚举
    util/              # 工具与装饰器
    app.ts             # Express 装配
    main.ts            # 入口
  tests/               # 单测、集成、契约测试
  scripts/             # 构建与运维脚本
```

## 架构说明

- 控制器位于 `src/api/controllers/`
- DTO 位于 `src/api/dto/`
- 仓储层位于 `src/store/`
- 路由与 OpenAPI 由 TSOA 自动生成，无手写路由文件
- 统一响应格式为 `{ code, message, data }`

## 环境变量

在 `NodeBackend/.env` 中至少配置：

```env
PORT=10001
DATABASE_URL=mysql://root:password@localhost:3306/QysywDB
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
JWT_ACCESS_EXPIRES_IN=5
JWT_REFRESH_EXPIRES_IN=604800
```

安全相关长密钥还包括：

- `REPLAY_SIGNING_MASTER_SECRET`
- `TWO_FACTOR_TRUSTED_DEVICE_SECRET`

远程终端内嵌模式下，后端不需要额外配置 `REMOTE_TERMINAL_BASE_URL`。
无公网 IP 设备上的 Agent 会主动连回当前后端。

Agent 常用环境变量：

```env
RTC_SERVER_BASE_URL=http://127.0.0.1:10001
RTC_REGISTRATION_TOKEN=dev-registration-token
RTC_DISABLE_HEARTBEAT=0
RTC_DISABLE_TUNNEL=0
```

本地联调时，浏览器端页面路径为 `Frontend` 中的 `#/relay/remote-terminal`。

建议这些值都不少于 64 字符，且彼此不同。

## 部署

生产部署仍以 PM2 托管，但运行时为 Bun：

```bash
pnpm run build:prod
pnpm run deploy:preflight
pnpm run pm2:start:prod
```

Linux 发布脚本：

```bash
pnpm run deploy:linux:prod
```

## 开发提示

- 改动 controller 或 DTO 后，需要重新生成 OpenAPI
- Windows 下 `prisma generate` 偶发 `EPERM` 重命名问题，通常是 Prisma engine 文件占用所致
- 前端依赖后端 `swagger.json` 时，可回到仓库根目录执行 `pnpm run openapi:sync-generate`
