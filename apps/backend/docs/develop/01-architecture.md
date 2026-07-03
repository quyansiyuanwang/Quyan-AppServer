# 架构设计文档

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本项目是一个基于 Node.js + Express + TypeScript + Prisma ORM 构建的后端 API 服务，采用代码优先的 OpenAPI 规范生成方式（TSOA），遵循三层架构模式（Controller-Service-Repository）。

### 1.1 技术栈

- **运行时**: Node.js (ESNext)
- **框架**: Express 5.x
- **语言**: TypeScript 5.x
- **ORM**: Prisma 6.x
- **数据库**: MySQL
- **API 文档**: TSOA + Swagger UI
- **测试**: Vitest + Supertest
- **构建工具**: esbuild
- **日志**: Winston

### 1.2 核心特性

- 🔐 JWT 双令牌认证（Access Token + Refresh Token）
- 📝 自动生成 OpenAPI 规范和路由
- 🗄️ 基于 Prisma 的类型安全数据访问
- 🔒 基于角色的权限控制系统（RBAC）
- 📊 API 请求日志记录
- 🛡️ IP 黑名单防护
- 🔗 URL 短链服务

## 2. 架构模式

### 2.1 三层架构

项目采用经典的三层架构模式，职责清晰分离：

```plain
┌─────────────────────────────────────────┐
│         Controller Layer                │
│    (HTTP 请求/响应处理)                  │
│    src/api/controllers/                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Service Layer                   │
│    (业务逻辑处理)                        │
│    src/services/                        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Repository Layer                │
│    (数据访问层)                          │
│    src/store/                           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Database (MySQL)                │
└─────────────────────────────────────────┘
```

#### Controller 层（控制器层）

**位置**: `src/api/controllers/`

**职责**:

- 处理 HTTP 请求和响应
- 参数验证和转换
- 调用 Service 层执行业务逻辑
- 使用 TSOA 装饰器生成 OpenAPI 规范

**特点**:

- 使用 `@Route`, `@Get`, `@Post` 等装饰器定义路由
- 使用 `@Security("jwt")` 装饰器保护需要认证的端点
- 自动生成 API 文档和类型定义

**示例**:

```typescript
@Route("users")
export class UserController extends Controller {
  @Get("{userId}")
  @Security("jwt")
  public async getUser(@Path() userId: string) {
    const service = new UserService();
    return service.getUserById(userId);
  }
}
```

#### Service 层（服务层）

**位置**: `src/services/`

**职责**:

- 实现核心业务逻辑
- 协调多个 Repository 的操作
- 处理业务规则和验证
- 事务管理

**特点**:

- 每个 Service 对应一个业务领域
- 依赖 Store Contract（`*.store.ts`）并通过 Repository 实现进行数据访问
- 不直接处理 HTTP 相关逻辑

**现有服务**:

- `AuthService`: 认证服务（登录、令牌刷新）
- `UserService`: 用户管理服务
- `PermissionService`: 权限管理服务
- `LogService`: 日志服务
- `ReurlService`: URL 短链服务

#### Repository 层（仓储层）

**位置**: `src/store/`

**职责**:

- 封装 Prisma ORM 操作
- 提供数据访问接口
- 处理数据库查询和更新

**特点**:

- 使用单例模式（`getInstance()`）
- Repository 文件与 Store Contract 文件成对出现（`xxx.repository.ts` + `xxx.store.ts`）
- Repository 类通过 `implements XxxStore` 明确契约
- 类型安全的数据访问
- 统一的错误处理

**示例**:

```typescript
export class UserRepository {
  private static instance: UserRepository;

  public static getInstance(): UserRepository {
    if (!UserRepository.instance) {
      UserRepository.instance = new UserRepository();
    }
    return UserRepository.instance;
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }
}
```

#### Store Contract 约定（2026-04）

为保证分层稳定性和可维护性，Repository 层统一遵循以下约定：

1. 每个仓储都定义对应 contract：`xxx.store.ts`
2. Repository 必须 `implements XxxStore`
3. Service 层只依赖 repository 导出的类型与方法，不直接依赖 Prisma
4. `src/**/*.ts` 中，只有 `src/store/**/*.ts` 与 `src/config/database.ts` 可访问 Prisma
5. Prisma JSON 字段在 contract 中应使用 Prisma 兼容输入类型（避免直接改为 `unknown`）

**约定示例**:

```typescript
// user.store.ts
export interface UserQueryStore {
  findById(id: string): Promise<User | null>;
}

export interface UserMutationStore {
  updateById(id: string, data: Prisma.UserUncheckedUpdateInput): Promise<User>;
}

export type UserStore = UserQueryStore & UserMutationStore;

// user.repository.ts
export class UserRepository implements UserStore {
  // ...
}
```

### 2.2 路由系统

**重要**: 本项目不使用手动路由文件，所有路由都通过 TSOA 自动生成。

#### 路由生成流程

1. 在 Controller 中使用装饰器定义端点
2. 运行 `pnpm run tsoa:spec-and-routes`（构建时自动执行）
3. TSOA 生成 `build/routes.ts` 文件
4. `src/app.ts` 中调用 `RegisterRoutes(app)` 注册所有路由

#### 特殊路由

- **Swagger UI** (`/docs`): 在 `app.ts` 中直接注册，使用 `swagger-ui-express` 中间件
- **OpenAPI JSON** (`/docs/openapi.json`): 通过 TSOA Controller 提供

### 2.3 中间件链

中间件按以下顺序应用（`src/app.ts`）：

1. **CORS**: 允许所有来源（`*`）
2. **requestIdMiddleware**: 为每个请求添加唯一 UUID
3. **loggingMiddleware**: 记录请求日志和响应时间
4. **Swagger UI**: 提供 API 文档界面
5. **RegisterRoutes**: TSOA 生成的路由
6. **404 Handler**: 处理未找到的路由
7. **exceptionMiddleware**: 统一错误处理

## 3. 目录结构

```plain
NodeBackend/
├── src/
│   ├── api/                    # API 层
│   │   ├── controllers/        # 控制器
│   │   ├── dto/                # 数据传输对象
│   │   └── response.ts         # 统一响应格式
│   ├── services/               # 服务层
│   ├── store/                  # 仓储层（按业务域分组）
│   │   ├── auth/               # 认证相关仓储
│   │   ├── billing/            # 余额与兑换码仓储
│   │   ├── chat/               # 会话与消息仓储
│   │   ├── content/            # 内容管理仓储（文章等）
│   │   ├── relay/              # 中转配置/令牌/用量仓储
│   │   ├── security/           # IP 黑白名单仓储
│   │   ├── system/             # 系统配置与日志仓储
│   │   ├── users/              # 用户与用户组仓储
│   │   └── oj-submitter/       # OJ 提交器仓储
│   ├── middleware/             # 中间件
│   │   ├── auth_guard.ts       # 认证守卫
│   │   ├── exception.ts        # 异常处理
│   │   ├── logging.ts          # 日志记录
│   │   └── request_id.ts       # 请求 ID
│   ├── util/                   # 工具函数
│   │   ├── auth/               # 认证工具
│   │   ├── errors.ts           # 自定义错误类
│   │   ├── logger.ts           # 日志工具
│   │   └── crypto.ts           # 加密工具
│   ├── config/                 # 配置文件
│   ├── constant/               # 常量定义
│   ├── types/                  # 类型定义
│   ├── app.ts                  # Express 应用配置
│   └── main.ts                 # 应用入口
├── prisma/
│   ├── schema.prisma           # 数据库模型定义
│   ├── migrations/             # 数据库迁移
│   └── seed.ts                 # 数据库种子
├── tests/                      # 测试文件
├── docs/                       # 文档
├── build/                      # TSOA 生成文件
├── dist/                       # 编译输出
└── logs/                       # 日志文件
```

## 4. 数据流

### 4.1 典型请求流程

```plain
1. 客户端发送 HTTP 请求
   ↓
2. requestIdMiddleware 添加请求 ID
   ↓
3. loggingMiddleware 记录请求开始
   ↓
4. auth_guard 验证 JWT（如果需要）
   ↓
5. Controller 接收请求
   ↓
6. Controller 调用 Service
   ↓
7. Service 执行业务逻辑
   ↓
8. Service 调用 Repository
   ↓
9. Repository 访问数据库
   ↓
10. 数据层层返回
   ↓
11. Controller 返回统一格式响应
   ↓
12. loggingMiddleware 记录响应时间
   ↓
13. 客户端接收响应
```

### 4.2 认证流程

```plain
登录请求
   ↓
AuthController.login()
   ↓
AuthService.login()
   ↓
UserRepository.findByUsername()
   ↓
验证密码
   ↓
生成 Access Token (5秒有效期)
生成 Refresh Token (60秒有效期)
   ↓
返回双令牌
```

### 4.3 受保护端点访问流程

```plain
请求 + Authorization Header
   ↓
auth_guard.expressAuthentication()
   ↓
验证 JWT 签名和有效期
   ↓
解析用户信息
   ↓
将用户信息附加到 request.user
   ↓
Controller 访问 request.user
```

## 5. 设计原则

### 5.1 单一职责原则

- Controller 只负责 HTTP 层面的处理
- Service 只负责业务逻辑
- Repository 只负责数据访问

### 5.2 依赖注入

- Service 层实例化 Repository
- Controller 层实例化 Service
- 使用单例模式管理 Repository 实例

### 5.3 类型安全

- 全程使用 TypeScript 严格模式
- Prisma 提供类型安全的数据库访问
- TSOA 自动生成类型定义

### 5.4 错误处理

- 使用自定义错误类（`BadRequestError`, `UnauthorizedError` 等）
- 统一的错误处理中间件
- 标准化的错误响应格式

### 5.5 配置管理

- 使用环境变量管理配置
- 路径别名简化导入（`@/*`, `@logs/*` 等）

## 6. 扩展性考虑

### 6.1 添加新功能

1. 定义数据模型（`prisma/schema.prisma`）
2. 创建 Repository（`src/store/`）
3. 创建 Service（`src/services/`）
4. 创建 Controller（`src/api/controllers/`）
5. 定义 DTO（`src/api/dto/`）
6. 运行构建生成路由

### 6.2 水平扩展

- 无状态设计，支持多实例部署
- JWT 认证无需共享 Session
- 数据库连接池管理

### 6.3 性能优化

- esbuild 快速构建
- Prisma 查询优化
- 日志异步写入
- 响应缓存（可扩展）

## 7. 安全性

### 7.1 认证与授权

- JWT 双令牌机制
- 基于角色的权限控制
- 细粒度权限管理（增删权限）

### 7.2 防护措施

- IP 黑名单机制
- 请求日志记录
- CORS 配置
- Helmet 安全头

### 7.3 数据安全

- 密码加密存储（当前使用 MD5，建议升级为 bcrypt）
- 软删除机制（status 字段）
- 数据库迁移版本控制

## 8. 监控与日志

### 8.1 日志系统

- 使用 Winston 日志库
- 按日期轮转日志文件
- 分级日志（error, warn, info, debug）

### 8.2 API 日志

- 记录所有 API 请求
- 存储请求参数和响应
- 关联用户 ID 和 IP 地址

### 8.3 请求追踪

- 每个请求分配唯一 UUID
- 贯穿整个请求生命周期
- 便于问题排查

## 9. 构建与部署

### 9.1 构建流程

```bash
pnpm run build
```

执行步骤：

1. 清理 dist 目录
2. TypeScript 类型检查
3. 生成 Prisma Client
4. TSOA 生成路由和规范
5. esbuild 编译为 CommonJS

### 9.2 输出产物

- `dist/index.cjs`: 编译后的应用程序
- `build/routes.ts`: TSOA 生成的路由
- `build/swagger.json`: OpenAPI 规范

### 9.3 运行模式

- **开发模式**: `pnpm run dev` (nodemon + tsx 热重载)
- **生产模式**: `pnpm run build:prod && pnpm run start`

## 10. 未来改进方向

1. **密码加密**: 从 MD5 升级到 bcrypt
2. **令牌有效期**: 调整生产环境的令牌过期时间
3. **缓存层**: 引入 Redis 缓存
4. **消息队列**: 处理异步任务
5. **微服务**: 按业务领域拆分服务
6. **容器化**: Docker 部署
7. **CI/CD**: 自动化测试和部署
