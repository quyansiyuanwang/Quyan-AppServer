# API 开发文档

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本项目使用 TSOA (TypeScript OpenAPI) 框架实现代码优先的 API 开发模式。所有 API 端点通过 TypeScript 装饰器定义，自动生成 OpenAPI 规范和路由配置。

### 1.1 核心特性

- 🎯 **代码优先**: 通过装饰器定义 API，自动生成文档
- 📝 **类型安全**: TypeScript 全程类型检查
- 🔄 **自动路由**: 无需手动配置路由文件
- 📚 **Swagger UI**: 自动生成交互式 API 文档
- ✅ **参数验证**: 自动验证请求参数

### 1.2 访问 API 文档

- **Swagger UI**: `http://localhost:10001/docs`
- **OpenAPI JSON**: `http://localhost:10001/docs/openapi.json`

## 2. API 模块概览

### 2.1 现有模块

| 模块 | 路由前缀       | 控制器                 | 说明                         |
| ---- | -------------- | ---------------------- | ---------------------------- |
| 认证 | `/auth`        | `AuthController`       | 用户登录、令牌刷新、令牌验证 |
| 用户 | `/users`       | `UserController`       | 用户信息查询、密码修改       |
| 权限 | `/permissions` | `PermissionController` | 权限管理、用户权限配置       |
| 短链 | `/reurl`       | `ReURLController`      | 生成临时访问短链接           |
| 文档 | `/docs`        | `DocsController`       | 获取 OpenAPI 规范            |

## 3. 认证模块 (Authentication)

### 3.1 登录接口

**端点**: `POST /auth/login`

**说明**: 用户登录，返回访问令牌和刷新令牌

**请求体**:

```json
{
  "username": "admin",
  "password": "password123"
}
```

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 5,
    "refresh_expires_in": 60
  }
}
```

**状态码**:

- `200`: 登录成功
- `401`: 用户名或密码错误
- `422`: 参数验证失败

### 3.2 刷新令牌接口

**端点**: `POST /auth/refresh`

**说明**: 使用刷新令牌获取新的访问令牌

**请求体**:

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 5
  }
}
```

### 3.3 验证令牌接口

**端点**: `POST /auth/verify`

**说明**: 验证访问令牌的有效性

**请求体**:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "valid": true,
    "userId": "clx1234567890",
    "username": "admin"
  }
}
```

## 4. 用户模块 (User)

### 4.1 获取当前用户信息

**端点**: `GET /users/me`

**认证**: 需要 JWT

**说明**: 获取当前登录用户的详细信息

**请求头**:

```
Authorization: Bearer <access_token>
```

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "clx1234567890",
    "username": "admin",
    "name": "管理员",
    "email": "admin@example.com",
    "groupId": "clx0987654321",
    "group": {
      "id": "clx0987654321",
      "name": "管理员组",
      "level": 10
    }
  }
}
```

### 4.2 获取所有用户

**端点**: `GET /users/getAllUsers`

**认证**: 需要 JWT + `user:read` 权限

**说明**: 获取所有用户列表（仅返回等级低于当前用户的用户）

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "users": [
      {
        "id": "clx1234567890",
        "username": "user1",
        "name": "用户1",
        "email": "user1@example.com"
      }
    ],
    "total": 1
  }
}
```

### 4.3 根据 ID 获取用户

**端点**: `GET /users/{userId}`

**认证**: 需要 JWT + `user:read` 权限

**路径参数**:

- `userId`: 用户 ID

**响应**: 同 4.1

### 4.4 修改用户密码

**端点**: `POST /users/{userId}/changePassword`

**认证**: 需要 JWT + 相应权限

**权限要求**:

- 修改自己的密码: `user:change_self_password`
- 修改他人的密码: `user:change_others_password`

**请求体**:

```json
{
  "newPassword": "newPassword123"
}
```

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "message": "密码修改成功"
  }
}
```

## 5. 权限模块 (Permission)

### 5.1 获取所有权限列表

**端点**: `GET /permissions/all`

**认证**: 需要 JWT + `permission:manage` 权限

**说明**: 获取系统中所有可用的权限

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "permissions": [
      {
        "value": "user:create",
        "name": "create",
        "category": "user"
      },
      {
        "value": "user:read",
        "name": "read",
        "category": "user"
      }
    ]
  }
}
```

### 5.2 获取用户权限

**端点**: `GET /permissions/user/{userId}`

**认证**: 需要 JWT

**说明**: 获取指定用户的完整权限信息（包括组权限、增加权限、移除权限、最终有效权限）

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "userId": "clx1234567890",
    "groupPermissions": ["user:read", "user:update"],
    "permissionAdds": ["user:create"],
    "permissionRemoves": ["user:update"],
    "effectivePermissions": ["user:read", "user:create"]
  }
}
```

### 5.3 设置用户权限配置

**端点**: `POST /permissions/user/{userId}/set`

**认证**: 需要 JWT + `permission:add` 权限

**请求体**:

```json
{
  "permissionAdds": ["user:create", "user:delete"],
  "permissionRemoves": ["user:update"]
}
```

**响应**:

```json
{
  "code": 0,
  "message": "权限配置更新成功"
}
```

### 5.4 添加用户权限

**端点**: `POST /permissions/user/{userId}/add`

**认证**: 需要 JWT + `permission:add` 权限

**请求体**:

```json
{
  "permissions": ["user:create", "user:delete"]
}
```

### 5.5 移除用户权限

**端点**: `POST /permissions/user/{userId}/remove`

**认证**: 需要 JWT + `permission:remove` 权限

**请求体**:

```json
{
  "permissions": ["user:create"]
}
```

### 5.6 清空用户权限配置

**端点**: `POST /permissions/user/{userId}/clear`

**认证**: 需要 JWT + `permission:remove` + `permission:add` 权限

**说明**: 清空用户的 permissionAdds 和 permissionRemoves，恢复为仅使用组权限

### 5.7 检查用户权限

**端点**: `POST /permissions/check`

**认证**: 需要 JWT

**请求体**:

```json
{
  "userId": "clx1234567890",
  "permissions": ["user:read", "user:create"]
}
```

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "results": {
      "user:read": true,
      "user:create": false
    }
  }
}
```

### 5.8 获取用户组权限

**端点**: `GET /permissions/group/{groupId}`

**认证**: 需要 JWT + `permission:manage` 权限

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "permissions": ["user:read", "user:update"]
  }
}
```

### 5.9 设置用户组权限

**端点**: `POST /permissions/group/{groupId}/set`

**认证**: 需要 JWT + `group:permission:remove` 权限

**请求体**:

```json
{
  "permissions": ["user:read", "user:update", "user:create"]
}
```

## 6. 短链模块 (ReURL)

### 6.1 生成短链接

**端点**: `POST /reurl/generate`

**认证**: 需要 JWT

**说明**: 生成临时访问短链接，用于在 URL 中传递 JWT 令牌

**请求体**:

```json
{
  "ttl": 60,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**参数说明**:

- `ttl`: 有效期（秒），默认 60 秒，最大 3600 秒
- `token`: 可选，不提供则使用当前请求的 JWT

**响应**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "reurl": "abc123def456",
    "expires_in": 60,
    "usage": "?token=reurl:abc123def456"
  }
}
```

**使用方式**:

```
GET /api/some-endpoint?token=reurl:abc123def456
```

## 7. 文档模块 (Documentation)

### 7.1 获取 OpenAPI 规范

**端点**: `GET /docs/openapi.json`

**认证**: 需要 JWT 或本地访问 + `debug:openapi:read` 权限

**说明**: 获取完整的 OpenAPI 3.0 规范文档（JSON 格式）

**响应**: 原始 OpenAPI JSON 文档（不包装在标准响应格式中）

## 8. 统一响应格式

### 8.1 成功响应

所有 API（除特殊标记的端点外）都返回统一格式：

```typescript
{
  code: number,      // 自定义状态码，0 表示成功
  message: string,   // 响应消息
  data?: T           // 响应数据（可选）
}
```

**示例**:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "123",
    "name": "示例"
  }
}
```

### 8.2 错误响应

```json
{
  "code": 1001,
  "message": "用户不存在"
}
```

### 8.3 自定义状态码

| Code | 说明           |
| ---- | -------------- |
| 0    | 成功           |
| 1001 | 认证失败       |
| 1002 | 权限不足       |
| 1003 | 资源不存在     |
| 1004 | 参数验证失败   |
| 1005 | 内部服务器错误 |

## 9. 开发新 API

### 9.1 创建 Controller

在 `src/api/controllers/` 创建新的控制器文件：

```typescript
import { Controller, Get, Post, Route, Security, Tags, Body, Path } from "@tsoa/runtime";
import { HttpStatusCode } from "axios";

@Route("example")
@Tags("Example")
export class ExampleController extends Controller {
  @Get("{id}")
  @Security("jwt")
  public async getExample(@Path() id: string) {
    // 实现逻辑
    return { id, name: "示例" };
  }

  @Post("")
  @Security("jwt")
  public async createExample(@Body() body: CreateExampleDTO) {
    // 实现逻辑
    return { id: "new-id", ...body };
  }
}
```

### 9.2 定义 DTO

在 `src/api/dto/` 创建数据传输对象：

```typescript
export interface CreateExampleDTO {
  name: string;
  description?: string;
}

export interface ExampleResponse {
  id: string;
  name: string;
  description?: string;
}
```

### 9.3 实现 Service

在 `src/services/` 创建服务类：

```typescript
export class ExampleService {
  async getById(id: string) {
    // 业务逻辑
  }

  async create(data: CreateExampleDTO) {
    // 业务逻辑
  }
}
```

### 9.4 实现 Repository

在 `src/store/` 创建仓储类：

```typescript
export class ExampleRepository {
  private static instance: ExampleRepository;

  public static getInstance(): ExampleRepository {
    if (!ExampleRepository.instance) {
      ExampleRepository.instance = new ExampleRepository();
    }
    return ExampleRepository.instance;
  }

  async findById(id: string) {
    return prisma.example.findUnique({ where: { id } });
  }
}
```

### 9.5 重新构建

```bash
pnpm run build
```

这会自动：

1. 生成新的路由配置
2. 更新 OpenAPI 规范
3. 编译 TypeScript 代码

### 9.6 测试 API

访问 Swagger UI 测试新的 API：

```
http://localhost:10001/docs
```

## 10. TSOA 装饰器参考

### 10.1 路由装饰器

- `@Route("path")`: 定义路由前缀
- `@Get("path")`: GET 请求
- `@Post("path")`: POST 请求
- `@Put("path")`: PUT 请求
- `@Delete("path")`: DELETE 请求
- `@Patch("path")`: PATCH 请求

### 10.2 参数装饰器

- `@Body()`: 请求体
- `@Path()`: 路径参数
- `@Query()`: 查询参数
- `@Header()`: 请求头
- `@Request()`: Express Request 对象

### 10.3 认证装饰器

- `@Security("jwt")`: 需要 JWT 认证
- `@Security("local-or-jwt")`: 本地或 JWT 认证

### 10.4 文档装饰器

- `@Tags("TagName")`: API 分组标签
- `@SuccessResponse(code, message)`: 成功响应说明
- `@Response<Type>(code, message)`: 错误响应说明
- `@Example(value)`: 示例数据

### 10.5 权限装饰器（自定义）

- `@RequirePermission(Permission.XXX)`: 需要指定权限
- `@RequireAnyPermission(...permissions)`: 需要任一权限
- `@RequireAllPermissions(...permissions)`: 需要所有权限

## 11. 最佳实践

### 11.1 Controller 层

- ✅ 只处理 HTTP 相关逻辑
- ✅ 使用装饰器定义路由和文档
- ✅ 调用 Service 层执行业务逻辑
- ❌ 不要在 Controller 中直接访问数据库
- ❌ 不要在 Controller 中编写复杂业务逻辑

### 11.2 DTO 定义

- ✅ 使用 TypeScript 接口定义
- ✅ 为请求和响应分别定义 DTO
- ✅ 使用 TSOA 验证装饰器（如需要）
- ✅ 添加 JSDoc 注释说明字段含义

### 11.3 错误处理

- ✅ 使用自定义错误类（`BadRequestError`, `UnauthorizedError` 等）
- ✅ 在 Service 层抛出错误
- ✅ 让中间件统一处理错误
- ❌ 不要在 Controller 中使用 try-catch

### 11.4 认证与授权

- ✅ 使用 `@Security("jwt")` 保护需要认证的端点
- ✅ 使用权限装饰器控制访问
- ✅ 在 Service 层进行细粒度权限检查
- ❌ 不要在 Controller 中手动验证 JWT

### 11.5 API 版本控制

当前项目未实现 API 版本控制，如需添加：

```typescript
@Route("v1/users")
export class UserV1Controller extends Controller {
  // v1 API
}

@Route("v2/users")
export class UserV2Controller extends Controller {
  // v2 API
}
```

## 12. 常见问题

### 12.1 路由未生成

**问题**: 新增的 Controller 没有生效

**解决**:

```bash
pnpm run build  # 重新构建生成路由
```

### 12.2 Swagger UI 不显示新接口

**问题**: Swagger UI 中看不到新添加的接口

**解决**:

1. 确保 Controller 使用了 `@Route` 和 `@Tags` 装饰器
2. 重新构建项目
3. 清除浏览器缓存

### 12.3 参数验证失败

**问题**: 请求参数总是验证失败

**解决**:

1. 检查 DTO 定义是否正确
2. 确保请求体格式正确（JSON）
3. 查看 Swagger UI 中的参数要求

### 12.4 认证失败

**问题**: 带 JWT 的请求返回 401

**解决**:

1. 检查 JWT 是否过期（开发环境默认 5 秒）
2. 确保 Authorization 头格式正确：`Bearer <token>`
3. 使用 `/auth/refresh` 刷新令牌

## 13. 调试技巧

### 13.1 查看生成的路由

```bash
cat build/routes.ts
```

### 13.2 查看 OpenAPI 规范

```bash
cat build/swagger.json | jq .
```

### 13.3 使用 Swagger UI 测试

1. 访问 `http://localhost:10001/docs`
2. 点击 "Authorize" 按钮
3. 输入 JWT 令牌
4. 测试各个接口

### 13.4 查看请求日志

日志文件位于 `logs/` 目录：

- `combined.log`: 所有日志
- `error.log`: 错误日志
- `business.log`: 业务日志

## 14. 性能优化

### 14.1 响应缓存

对于不常变化的数据，可以添加缓存：

```typescript
@Get("static-data")
public async getStaticData() {
  // 实现缓存逻辑
}
```

### 14.2 分页查询

对于列表接口，实现分页：

```typescript
@Get("list")
public async getList(
  @Query() page: number = 1,
  @Query() pageSize: number = 20
) {
  // 实现分页逻辑
}
```

### 14.3 字段过滤

允许客户端指定需要的字段：

```typescript
@Get("{id}")
public async getUser(
  @Path() id: string,
  @Query() fields?: string
) {
  // 根据 fields 参数返回部分字段
}
```

## 15. 安全建议

### 15.1 输入验证

- ✅ 使用 DTO 定义严格的数据结构
- ✅ 验证所有用户输入
- ✅ 限制字符串长度
- ✅ 验证数字范围

### 15.2 敏感信息

- ❌ 不要在响应中返回密码
- ❌ 不要在日志中记录敏感信息
- ✅ 使用环境变量存储密钥

### 15.3 速率限制

考虑为 API 添加速率限制：

```typescript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最多 100 次请求
});

app.use("/api/", limiter);
```

### 15.4 CORS 配置

生产环境应限制 CORS 来源：

```typescript
app.use(
  cors({
    origin: ["https://example.com"],
    credentials: true,
  }),
);
```
