# 开发工作流文档

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本文档描述项目的开发工作流程，包括环境配置、日常开发、构建部署等内容。

## 2. 环境准备

### 2.1 依赖工具

| 工具  | 版本  | 说明                     |
| ----- | ----- | ------------------------ |
| Bun   | 1.x+  | 运行时与脚本执行器       |
| pnpm  | 10.x+ | 包管理器                 |
| MySQL | 8.0+  | 数据库                   |
| PM2   | 6.x+  | 生产环境进程管理（可选） |

### 2.2 安装依赖

```bash
pnpm install
```

### 2.3 环境变量

复制 `.env.sample` 创建 `.env` 文件：

```bash
cp .env.sample .env
```

**环境变量说明**:

| 变量                   | 说明                       | 示例值                                     |
| ---------------------- | -------------------------- | ------------------------------------------ |
| PORT                   | 服务端口                   | 10001                                      |
| NODE_ENV               | 运行环境                   | development                                |
| DATABASE_URL           | 数据库连接                 | mysql://root:123456@localhost:3306/QysywDB |
| JWT_ACCESS_SECRET      | Access Token 密钥          | your_access_secret_key                     |
| JWT_REFRESH_SECRET     | Refresh Token 密钥         | your_refresh_secret_key                    |
| JWT_ACCESS_EXPIRES_IN  | Access Token 有效期（秒）  | 5                                          |
| JWT_REFRESH_EXPIRES_IN | Refresh Token 有效期（秒） | 28800                                      |

### 2.4 数据库初始化

```bash
# 生成 Prisma Client
pnpm run db:generate

# 推送模型到数据库（开发环境）
pnpm run db:push

# 或者使用迁移
pnpm run db:migrate:dev

# 填充种子数据
pnpm run db:seed
```

### 2.5 测试环境

复制 `.env.test.sample` 创建 `.env.test` 文件：

```bash
cp .env.test.sample .env.test
```

测试数据库应使用独立的数据库，避免影响开发数据。

## 3. 日常开发

### 3.1 启动开发服务器

```bash
pnpm run dev
```

这会：

- 使用 nodemon 监听 `src/` 目录文件变化
- 使用 Bun 直接运行 TypeScript
- 文件变化时自动重新生成 OpenAPI 规范并重启
- 服务默认运行在 `http://localhost:10001`

### 3.2 代码检查

```bash
# 仅类型检查
pnpm run check

# 架构守卫检查（Prisma 边界 + 类型）
pnpm run arch:check

# ESLint 检查和修复
pnpm run lint

# 格式化代码
pnpm run format

# 综合检查（lint + format + type-check）
pnpm run lint-format-check
```

### 3.3 路径别名

项目配置了以下路径别名：

| 别名              | 实际路径         | 用途           |
| ----------------- | ---------------- | -------------- |
| `@/*`             | `src/*`          | 源代码目录     |
| `@logs/*`         | `logs/*`         | 日志目录       |
| `@logs_ignore/*`  | `logs_ignore/*`  | 忽略的日志目录 |
| `@public/*`       | `public/*`       | 公共资源目录   |
| `@publicStatic/*` | `publicStatic/*` | 静态资源目录   |

**使用示例**:

```typescript
import { User } from "@/store/user";
import logger from "@/util/logger";
import { Permission } from "@/constant/permission";
```

## 4. 构建流程

### 4.1 标准构建

```bash
pnpm run build
```

执行步骤：

1. 生成 OpenAPI 路由与规范
2. `build`: 执行 `build:esbuild`
   - 清理 dist 目录

- 注入构建信息
- TypeScript 类型检查
- 生成 Prisma Client
- 使用 Bun 执行 esbuild 编译

### 4.2 esbuild 配置要点

- **入口**: `src/main.ts`
- **运行时目标**: Bun 执行 CommonJS 产物
- **格式**: CommonJS
- **输出**: `dist/index.cjs`
- **Tree-shaking**: 启用
- **外部依赖**: Prisma Client, Sharp, 代理模块
- **复制文件**: package.json, Prisma schema, docs

### 4.3 生产构建

```bash
pnpm run build:prod
```

与标准构建的区别：

- 启用代码压缩（minify）
- 不生成 Source Map
- 生成元数据文件（用于分析）
- 设置 `NODE_ENV=production`

### 4.4 TSC 构建（备选）

```bash
pnpm run build:tsc
```

使用 TypeScript 编译器构建，包括路径别名解析（tsc-alias）。比 esbuild 慢，但在某些调试场景下可能有用。

## 5. 运行服务

### 5.1 开发环境

```bash
pnpm run dev
```

### 5.2 直接运行 TypeScript

```bash
pnpm run tsx
```

该命令会直接通过 Bun 执行 `src/main.ts`。

### 5.3 运行构建产物

```bash
pnpm run start
```

该命令会通过 Bun 执行 `dist/index.cjs`。

### 5.4 监听构建产物变化

```bash
pnpm run start:watch
```

使用 nodemon 监听 `dist/` 目录变化，并通过 Bun 重启运行产物。

### 5.5 PM2 生产运行

```bash
pnpm run pm2:start:prod
```

当前生产模式下由 PM2 使用 `bun` 解释执行 `dist/index.cjs`。

如需完整的上线、验证与回滚流程，请阅读：

- [Bun 部署与回滚指南](./07-bun-deployment.md)

## 6. 添加新功能流程

### 6.1 添加 API 端点

```plain
1. 定义 DTO    → src/api/dto/example.dto.ts
2. 创建 Service → src/services/example.service.ts
3. 创建 Store   → src/store/example.repository.ts (如需数据库)
4. 创建 Controller → src/api/controllers/example.controller.ts
5. 构建        → pnpm run build
6. 测试        → http://localhost:10001/docs
```

### 6.2 修改数据库模型

```plain
1. 编辑模型    → prisma/schema.prisma
2. 创建迁移    → pnpm run db:migrate:dev
3. 更新 Store  → src/store/
4. 更新 Service → src/services/
5. 更新 DTO    → src/api/dto/
6. 更新 Controller → src/api/controllers/
```

### 6.3 添加中间件

在 `src/middleware/` 创建新的中间件文件，然后在 `src/app.ts` 中注册：

```typescript
// src/middleware/example.ts
export function exampleMiddleware(req, res, next) {
  // 中间件逻辑
  next();
}

// src/app.ts 中注册
app.use(exampleMiddleware);
```

## 7. 代码规范

### 7.1 ESLint 配置

配置文件: `eslint.config.js`

- 使用 `@typescript-eslint` 规则
- 对 `src/` 启用 Prisma 边界约束：仅 `src/store/**` 与 `src/config/database.ts` 可访问 Prisma
- 自动修复支持

推荐在提交前执行：

```bash
pnpm run arch:check
```

### 7.2 Prettier 配置

配置文件: `.prettierrc.json`

格式化规则自动应用于 `.ts`, `.js`, `.tsx`, `.jsx`, `.json`, `.css`, `.md` 文件。

### 7.3 预提交检查

运行以下命令进行提交前检查：

```bash
pnpm run precommit
```

这会依次执行：

1. 生成 Prisma Client
2. 生成 OpenAPI 规范
3. ESLint 检查
4. Prettier 格式化
5. TypeScript 类型检查

## 8. 项目配置

### 8.1 TypeScript 配置

- **目标**: ESNext
- **模块**: ESNext
- **严格模式**: 启用
- **装饰器**: 启用实验性装饰器

### 8.2 TSOA 配置

配置文件: `tsoa.json`

定义了：

- 控制器目录
- 输出目录
- 认证配置
- 路由配置

### 8.3 Vitest 配置

配置文件: `vitest.config.ts`

- 全局变量: 启用
- 环境: Node
- 并行: 禁用（避免数据库冲突）
- 路径别名: 同 tsconfig.json

## 9. 日志系统

### 9.1 Winston 日志

日志文件位于 `logs/` 目录：

- 支持按日期轮转
- 分级日志（error, warn, info, debug）
- 控制台和文件双输出

### 9.2 使用方式

```typescript
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("ModuleName", LogCategory.BUSINESS);

logger.info("操作成功");
logger.error("操作失败", error);
logger.debug("调试信息", { data });
```

## 10. 常见问题

### 10.1 `Cannot find module '@/...'`

**原因**: 路径别名未正确解析

**解决**:

- 开发时: tsx 自动处理
- 构建后: 确保使用 esbuild 或 tsc-alias

### 10.2 端口被占用

**解决**: 修改 `.env` 中的 `PORT` 变量

### 10.3 数据库连接失败

**解决**:

1. 检查 MySQL 是否运行
2. 验证 `DATABASE_URL` 是否正确
3. 确认数据库是否已创建

### 10.4 TSOA 路由未更新

**解决**:

```bash
pnpm run tsoa:spec-and-routes
```

或重新构建：

```bash
pnpm run build
```

### 10.5 Prisma Client 类型不匹配

**解决**:

```bash
pnpm run db:generate
```

### 10.6 ESLint/Prettier 冲突

**解决**: 运行综合检查修复：

```bash
pnpm run lint-format-check
```
