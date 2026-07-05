# 01 — 系统架构概览

## Monorepo 结构

```
AppServerMonorepo/
├── apps/
│   ├── backend/           # @appserver/backend    Express + Prisma + TSOA (port 10001)
│   ├── frontend/          # @appserver/frontend   Vue 3 + Element Plus + Vite (port 5173)
│   └── docs-site/         # @appserver/docs-site  Vue 3 文档站点
├── packages/
│   ├── shared/            # @appserver/shared     前后端共享类型与常量
│   ├── config-typescript/ # 共享 TypeScript 配置
│   ├── config-prettier/   # 共享 Prettier 配置
│   └── utils/             # 共享工具函数
├── scripts/               # 仓库级编排脚本
├── package.json           # 根编排（pnpm workspace）
└── pnpm-workspace.yaml    # packages: ['apps/*', 'packages/*']
```

## 技术栈

| 层 | 技术 |
|----|------|
| **后端运行时** | Node.js (^20.19 \|\| >=22.12), Bun (dev + prod via PM2) |
| **后端框架** | Express 5.x, TypeScript 5.9, TSOA (code-first OpenAPI) |
| **ORM** | Prisma 6.x + MySQL |
| **缓存/队列** | Redis (ioredis) |
| **前端框架** | Vue 3 (Composition API), TypeScript, Vite (Rolldown) |
| **前端 UI** | Element Plus 2.x (auto-import), Tailwind CSS 4.x |
| **状态管理** | Pinia 3.x, TanStack Vue Query |
| **API 客户端** | Axios + @hey-api/openapi-ts (自动生成) |
| **认证** | JWT (access + refresh), OAuth 2.0, WebAuthn (passkey) |
| **构建** | esbuild (后端), Rolldown-Vite (前端) |
| **进程管理** | PM2 (cluster mode) |
| **包管理器** | pnpm 10.33 (workspace) |

## 数据流

### 请求生命周期（后端）

```
HTTP Request
  → CORS (allowlist + credentials)
  → Request Size Guard (防止超大请求)
  → Body Parsers (json, urlencoded, multipart for /relay/proxy)
  → urlTokenExtractor (?token= → Authorization header)
  → localeMiddleware (Accept-Language 检测)
  → requestIdMiddleware (UUID)
  → loggingMiddleware (方法/路径/状态/耗时)
  → responseWrapperMiddleware ({code, message, data} 封装)
  → errorTrackerMiddleware (IP 错误计数, 自动封禁)
  → ipBlacklistCheckMiddleware (IP 黑名单拦截)
  → streamingMiddleware (SSE 流式响应)
  → RegisterRoutes(app) → TSOA 路由 → Controller
      → Auth Guard (JWT / OAuth / Relay token 验证)
      → Permission Guard (RBAC 权限检查)
      → Controller → Service → Repository → Prisma → MySQL
  → 404 catch-all
  → exceptionMiddleware (全局错误处理)
```

### 前后端协作

```
View (Vue) → Service (业务逻辑) → Generated Client (typed SDK) → Axios (JWT 拦截器) → Backend API
```

### OpenAPI 生成流水线

```
Backend (tsoa spec-and-routes) → swagger.json
    ↓
scripts/sync-swagger-to-frontend.mjs (复制)
    ↓
Frontend (openapi-ts) → src/client/ (typed SDK + constants + type maps)
```

## 核心设计原则

### 3-Layer 架构（后端）

```
Controller (HTTP) → Service (业务逻辑) → Repository (数据访问)
```

- **Controller**: TSOA 装饰器定义路由、参数、安全方案。不含业务逻辑。
- **Service**: 单例模式 (`getInstance()`)，编排 Repository，实现业务规则。
- **Repository**: 封装 Prisma 查询，单例模式。部分 Repository 有对应的 Store（Redis 缓存层）。

### 单例模式

所有 Service 和 Repository 使用单例：
```typescript
export class UserService {
  private static instance: UserService;
  public static getInstance(): UserService { ... }
}
```

### 共享类型规范源

`@appserver/shared` 包是 Permission 枚举、CustomCode 等的**唯一数据源**。前后端都从此包 re-export，确保一致性。

### 响应格式

所有 API 响应统一格式：
```typescript
{ code: number, message: string, data?: T }
// code: 0 = 成功, 1001+ = 业务错误 (CustomCode)
```

## 项目规模概览

| 组件 | 数量 |
|------|------|
| 后端 Controllers | 47 个文件 |
| 后端 Services | 56 个文件 |
| 后端 Repositories | 64+ 个文件 |
| 后端 Middleware | 21 个 |
| Prisma 模型 | 68 个 |
| 前端 Views | 40+ 个页面 |
| 前端 Services | 30+ 个文件 |
| 前端 Pinia Stores | 11 个 |
| 前端 Components | 25+ 个 |
| 共享类型模块 | 9 个 |
| 权限枚举成员 | 130+ 个 |
