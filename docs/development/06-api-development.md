# 06 — API 开发流程

## 添加新 API 端点的完整步骤

### 1. 定义 DTO (`src/api/dto/`)

在对应的 DTO 文件中定义请求和响应类型：

```typescript
// src/api/dto/user.dto.ts
export interface CreateUserRequest {
  /** 用户名 */
  @minLength(3)
  @maxLength(50)
  username: string;

  /** 邮箱 */
  @isEmail()
  email: string;

  /** 密码 */
  @minLength(8)
  @maxLength(128)
  password: string;
}

export interface CreateUserResponse {
  id: string;
  username: string;
  email: string;
  createTime: string;
}
```

TSOA 装饰器 (`@minLength`, `@isEmail` 等) 自动生成：

- OpenAPI schema 字段校验
- 运行时参数校验

### 2. 创建/更新 Repository (`src/store/`)

如果需要数据库操作，添加 Repository 方法：

```typescript
// src/store/user.repository.ts
export class UserRepository {
  private static instance: UserRepository;
  public static getInstance(): UserRepository { ... }

  public async createUser(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  }

  public async findById(id: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { id, status: MANAGED_STATUS.ENABLED }
    });
  }
}
```

### 3. 创建/更新 Service (`src/services/`)

添加业务逻辑：

```typescript
// src/services/users/user.service.ts
export class UserService {
  private static instance: UserService;
  public static getInstance(): UserService { ... }
  private userRepo = UserRepository.getInstance();

  public async createUser(data: CreateUserRequest): Promise<User> {
    // 业务校验
    const existing = await this.userRepo.findByUsername(data.username);
    if (existing) {
      throw new ConflictError("Username already exists");
    }
    // 创建用户
    return this.userRepo.createUser({ ...data });
  }
}
```

### 4. 创建/更新 Controller (`src/api/controllers/`)

定义 HTTP 端点：

```typescript
// src/api/controllers/v1/users/UserController.ts
@Route('v1/users')
export class UserController extends Controller {
  @Post('/')
  @Security('jwt')
  @CheckPermission(Permission.USER_CREATE, PermissionCheckMode.ALL, 'jwt')
  @LogRoute({ message: 'Create user', logResponse: true })
  public async createUser(
    @Body() body: CreateUserRequest,
  ): Promise<SuccessResponse<CreateUserResponse>> {
    const user = await UserService.getInstance().createUser(body)
    return { code: 0, message: 'success', data: user }
  }
}
```

装饰器说明：

- `@Route("v1/users")` — 基础路径
- `@Post("/")` — HTTP 方法 + 路径
- `@Security("jwt")` — 认证方案（对应 tsoa.json）
- `@CheckPermission(...)` — RBAC 权限
- `@LogRoute(...)` — 自动日志
- `@Body()` — 请求体注入
- `@Path()` — 路径参数注入
- `@Query()` — 查询参数注入
- `@Header()` — 请求头注入
- `@Request()` — 完整 Express Request 对象

### 5. 生成 OpenAPI 和路由

```bash
cd AppServerMonorepo
pnpm run openapi:gen:all
```

这个命令：

1. 在后端运行 `tsoa spec-and-routes` → 生成 `swagger.json` + `routes.ts`
2. 通过 `sync-swagger-to-frontend.mjs` 复制 swagger.json 到前端
3. 在前端运行 `openapi-ts` → 生成 typed SDK 到 `src/client/`

### 6. 验证

```bash
# 启动后端
pnpm run dev:backend

# 访问 Swagger UI 测试 API
# http://localhost:10001/docs

# 运行测试
pnpm --filter @quyan/backend test
```

## Controller 装饰器参考

### 认证与授权

```typescript
@Security("jwt")                              // 需要 JWT 认证
@Security("local-or-jwt")                     // 本地请求可绕过（仅开发）
@Security("relay-token")                      // Relay token 认证

@CheckPermission(Permission.USER_CREATE, PermissionCheckMode.ALL, "jwt")
// 单个权限（ALL 模式即要求拥有该权限）

@CheckPermission([Permission.USER_READ, Permission.USER_LIST], PermissionCheckMode.ANY, "jwt")
// 多个权限（ANY 模式即 OR 逻辑）

@CheckPermission([Permission.USER_UPDATE, Permission.USER_DELETE], PermissionCheckMode.ALL, "jwt")
// 多个权限（ALL 模式即 AND 逻辑）
```

### 安全保护

```typescript
@ReplayProtected()                            // 重放攻击保护
@CaptchaProtected()                           // 需要完成 CAPTCHA
@TwoFactorChallengeProtected()                // 需要 2FA 升级认证
```

### 日志

```typescript
@LogRoute({
  message: "操作描述",
  logRequest: true,         // 记录请求体
  logResponse: true,        // 记录响应体
  category: "auth",         // 日志类别
})
```

## Service 模式

所有 Service 必须使用单例模式：

```typescript
export class ExampleService {
  private static instance: ExampleService
  public static getInstance(): ExampleService {
    if (!ExampleService.instance) {
      ExampleService.instance = new ExampleService()
    }
    return ExampleService.instance
  }

  private repo = ExampleRepository.getInstance()

  // 公共业务方法...
}
```

**原因**：

- 避免重复实例化（每个 Service 内部可能持有缓存或连接）
- 便于在 Controller 中直接调用
- 与 Repository 单例模式保持一致

## 错误处理

使用预定义的错误类，不要直接 `throw new Error()`：

```typescript
throw new BadRequestError('描述') // 400
throw new UnauthorizedError('描述') // 401
throw new ForbiddenError('描述') // 403
throw new NotFoundError('描述') // 404
throw new ConflictError('描述') // 409
throw new ValidationError('描述') // 422
throw new TooManyRequestsError('描述') // 429
throw new InternalServerError('描述') // 500
throw new TwoFactorRequiredError('描述') // 401 + CustomCode.TWO_FACTOR_REQUIRED
```

这些错误类继承自 `ApiError`，被 `exceptionMiddleware` 统一处理，自动填充 `CustomCode`。

## 响应格式

成功响应使用 `SuccessResponse<T>`：

```typescript
import { SuccessResponse } from "@src/api/response";

@Get("/")
public async getUsers(): Promise<SuccessResponse<User[]>> {
  const data = await UserService.getInstance().getUsers();
  return { code: 0, message: "success", data };
}
```

`responseWrapperMiddleware` 会自动包装返回值，因此即使返回裸数据也会被格式化为 `{code: 0, message: "success", data: ...}`。但推荐显式使用 `SuccessResponse<T>` 以获得类型安全。

## 测试

```bash
# 所有后端测试
pnpm --filter @quyan/backend run test

# 仅单元测试
pnpm --filter @quyan/backend run test:unit

# 仅 API 测试（集成 + 契约）
pnpm --filter @quyan/backend run test:api

# 运行单个测试文件
pnpm --filter @quyan/backend run test:unit -- tests/unit/<area>/<name>.unit.test.ts
```

测试框架：Vitest + Supertest。纯单测与隔离数据库测试按项目并行，数据库 worker 使用派生 MySQL 库和独立 Redis DB，避免共享数据冲突。完整命令、分类和 CI 策略见 [测试与 CI](./11-testing-and-ci.md)。
