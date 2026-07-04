# CLAUDE.md — AppServerMonorepo

此文件为 Claude Code 提供在 monorepo 中工作的指引。

## Monorepo 结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @appserver/backend    Express + Prisma + TSOA (port 10001)
│   ├── frontend/          # @appserver/frontend   Vue 3 + Element Plus + Vite (port 5173)
│   └── docs-site/         # @appserver/docs-site   Vue 3 文档站点
├── packages/
│   ├── config-typescript/ # 共享 TypeScript 配置 (tsconfig.base.json)
│   ├── config-prettier/   # 共享 Prettier 配置 (.prettierrc.json)
│   └── utils/             # 共享工具函数 (src/index.ts)
├── package.json           # 根编排脚本
├── pnpm-workspace.yaml    # Workspace 配置
├── .gitignore
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
pnpm run openapi:generate        # 生成 OpenAPI spec + 前端客户端
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
pnpm --filter @appserver/frontend dev       # 前端 dev
pnpm --filter @appserver/frontend build     # 前端构建
pnpm --filter @appserver/docs-site dev      # 文档站点 dev
```

## 共享包使用

### TypeScript 配置
各项目可在 `tsconfig.json` 中引用：
```json
{
  "extends": "@appserver/config-typescript/tsconfig.base.json"
}
```

### Prettier 配置
各项目可在 `package.json` 中添加依赖：
```json
{
  "devDependencies": {
    "@appserver/config-prettier": "workspace:*"
  }
}
```
然后在 `.prettierrc.json` 中引用或复制配置值。

### ESLint 配置
```ts
import appserverConfig from '@appserver/config-eslint';
export default [...appserverConfig, { /* 项目特有规则 */ }];
```

### 工具函数
```ts
import '@appserver/utils';
```

## 架构

详见各项目内的 CLAUDE.md：
- `apps/backend/CLAUDE.md` — 后端架构 (TSOA 3层模式、权限系统、认证)
- `apps/frontend/CLAUDE.md` — 前端架构 (Vue 3、Pinia、API 客户端)

## 原项目目录

原始项目保留在 `D:\Developments\AppServer\` 根目录作为回退：
- `NodeBackend/`、`Frontend/`、`StaticSite/`、`DocsSite/`

新开发请使用 `AppServerMonorepo/` 目录。
