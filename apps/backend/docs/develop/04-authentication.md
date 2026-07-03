# 认证与授权系统文档

**版本**: v1
**日期**: 2026/2/10
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本项目实现了基于 JWT 的双令牌认证机制和基于角色的权限控制系统（RBAC）。

### 1.1 核心特性

- 🔐 JWT 双令牌认证（Access Token + Refresh Token）
- 👥 基于角色的权限控制（RBAC）
- 🎯 细粒度权限管理（增删权限）
- 🔒 等级系统（高等级用户管理低等级用户）
- 🛡️ IP 黑名单防护

## 2. 认证机制

### 2.1 双令牌系统

项目使用双令牌机制提高安全性：

| 令牌类型      | 有效期（开发） | 有效期（生产建议） | 用途              |
| ------------- | -------------- | ------------------ | ----------------- |
| Access Token  | 5 秒           | 15 分钟            | 访问受保护资源    |
| Refresh Token | 60 秒          | 7 天               | 刷新 Access Token |

### 2.2 认证流程

```
1. 用户登录
   ↓
2. 验证用户名和密码
   ↓
3. 生成 Access Token 和 Refresh Token
   ↓
4. 返回双令牌给客户端
   ↓
5. 客户端使用 Access Token 访问 API
   ↓
6. Access Token 过期后使用 Refresh Token 刷新
   ↓
7. 获取新的 Access Token
```

### 2.3 JWT 结构

**Access Token Payload**:

```json
{
  "userId": "clx1234567890",
  "username": "admin",
  "type": "access",
  "iat": 1707523200,
  "exp": 1707523205
}
```

**Refresh Token Payload**:

```json
{
  "userId": "clx1234567890",
  "username": "admin",
  "type": "refresh",
  "iat": 1707523200,
  "exp": 1707523260
}
```

### 2.4 令牌配置

配置文件位于 `src/util/auth/index.ts`：

```typescript
export const JWTAccessIns = new JWTUtil({
  secret: process.env.JWT_ACCESS_SECRET || "access-secret",
  expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "5s",
});

export const JWTRefreshIns = new JWTUtil({
  secret: process.env.JWT_REFRESH_SECRET || "refresh-secret",
  expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "60s",
});
```

**环境变量**:

```env
JWT_ACCESS_SECRET=your-access-secret-key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=7d
```

## 3. 认证守卫

### 3.1 实现位置

`src/middleware/auth_guard.ts`

### 3.2 TSOA 集成

TSOA 通过 `expressAuthentication` 函数处理认证：

```typescript
export async function expressAuthentication(
  request: express.Request,
  securityName: string,
  scopes?: string[],
): Promise<any> {
  if (securityName === "jwt") {
    const token = extractToken(request);
    const decoded = JWTAccessIns.verify(token);
    request.user = decoded;
    return decoded;
  }

  if (securityName === "local-or-jwt") {
    // 本地访问或 JWT 认证
    if (isLocalRequest(request)) {
      return { userId: "local", username: "local" };
    }
    // 否则验证 JWT
    const token = extractToken(request);
    const decoded = JWTAccessIns.verify(token);
    request.user = decoded;
    return decoded;
  }

  throw new UnauthorizedError("未授权");
}
```

### 3.3 令牌提取

支持多种令牌传递方式：

**1. Authorization Header（推荐）**:

```
Authorization: Bearer <access_token>
```

**2. Query Parameter**:

```
GET /api/users/me?token=<access_token>
```

**3. ReURL（临时短链）**:

```
GET /api/users/me?token=reurl:<reurl_id>
```

### 3.4 使用方式

在 Controller 中使用 `@Security` 装饰器：

```typescript
@Get("me")
@Security("jwt")
public async getCurrentUser(@Request() request: TypedRequest) {
  const userId = request.user?.userId;
  // 处理逻辑
}
```

## 4. 权限系统

### 4.1 权限模型

项目采用 RBAC（基于角色的访问控制）模型：

```
用户 (User)
  ↓ 属于
用户组 (Group)
  ↓ 拥有
基础权限 (Base Permissions)
  ↓ 加上
额外权限 (Permission Adds)
  ↓ 减去
移除权限 (Permission Removes)
  ↓ 等于
最终权限 (Effective Permissions)
```

### 4.2 权限计算公式

```
最终权限 = (组权限 + 额外权限) - 移除权限
```

**示例**:

```typescript
组权限: ["user:read", "user:update", "user:create"];
额外权限: ["user:delete", "permission:manage"];
移除权限: ["user:update"];

最终权限: ["user:read", "user:create", "user:delete", "permission:manage"];
```

### 4.3 权限列表

权限定义在 `src/constant/permission.ts`：

```typescript
export enum Permission {
  // 用户管理权限
  USER_CREATE = "user:create",
  USER_READ = "user:read",
  USER_UPDATE = "user:update",
  USER_DELETE = "user:delete",
  USER_CHANGE_SELF_PASSWORD = "user:change_self_password",
  USER_CHANGE_OTHERS_PASSWORD = "user:change_others_password",

  // 用户组管理权限
  GROUP_CREATE = "group:create",
  GROUP_READ = "group:read",
  GROUP_UPDATE = "group:update",
  GROUP_DELETE = "group:delete",
  GROUP_PERMISSION_ADD = "group:permission:add",
  GROUP_PERMISSION_REMOVE = "group:permission:remove",

  // 权限管理权限
  PERMISSION_VIEW = "permission:manage",
  PERMISSION_ADD = "permission:add",
  PERMISSION_REMOVE = "permission:remove",

  // 系统管理权限
  SYSTEM_CONFIG = "system:config",
  SYSTEM_LOG = "system:log",

  // API日志权限
  API_LOG_READ = "api_log:read",
  API_LOG_DELETE = "api_log:delete",

  // IP黑名单权限
  IP_BLACKLIST_CREATE = "ip_blacklist:create",
  IP_BLACKLIST_READ = "ip_blacklist:read",
  IP_BLACKLIST_UPDATE = "ip_blacklist:update",
  IP_BLACKLIST_DELETE = "ip_blacklist:delete",

  // 特殊权限
  DEBUG_ACCESS = "debug:access",
  DEBUG_OPENAPI_READ = "debug:openapi:read",
}
```

### 4.4 权限分类

权限按照 `category:action` 格式命名：

| 分类         | 说明       | 示例                              |
| ------------ | ---------- | --------------------------------- |
| user         | 用户管理   | user:read, user:create            |
| group        | 用户组管理 | group:update, group:delete        |
| permission   | 权限管理   | permission:add, permission:remove |
| system       | 系统管理   | system:config, system:log         |
| api_log      | API 日志   | api_log:read, api_log:delete      |
| ip_blacklist | IP 黑名单  | ip_blacklist:create               |
| debug        | 调试功能   | debug:access                      |

## 5. 权限装饰器

### 5.1 装饰器类型

项目提供三种权限装饰器：

**1. RequirePermission（需要指定权限）**:

```typescript
@RequirePermission(Permission.USER_READ)
public async getUser() {
  // 需要 user:read 权限
}
```

**2. RequireAnyPermission（需要任一权限）**:

```typescript
@RequireAnyPermission(Permission.USER_READ, Permission.USER_UPDATE)
public async getUser() {
  // 需要 user:read 或 user:update 权限
}
```

**3. RequireAllPermissions（需要所有权限）**:

```typescript
@RequireAllPermissions(Permission.PERMISSION_ADD, Permission.PERMISSION_REMOVE)
public async clearPermissions() {
  // 需要 permission:add 和 permission:remove 权限
}
```

### 5.2 实现原理

装饰器通过 Express 中间件实现：

```typescript
export function RequirePermission(permission: Permission) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const request = args.find((arg) => arg?.user);
      const userId = request?.user?.userId;

      const hasPermission = await permissionService.hasPermission(userId, permission);
      if (!hasPermission) {
        throw new ForbiddenError("权限不足");
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
```

## 6. 等级系统

### 6.1 等级概念

用户组具有等级（level）属性，用于权限层级控制：

```typescript
超级管理员组: level = 10;
管理员组: level = 5;
普通用户组: level = 1;
```

### 6.2 等级规则

- 高等级用户可以管理低等级用户
- 用户只能查看等级低于自己的用户
- 不能修改等级高于或等于自己的用户

### 6.3 实现示例

```typescript
async getAllLevelGreaterThan(currentUserId: string) {
  const currentUser = await this.getUserById(currentUserId);
  const currentLevel = currentUser.group.level;

  return prisma.user.findMany({
    where: {
      group: {
        level: { lt: currentLevel }
      }
    }
  });
}
```

## 7. 权限服务

### 7.1 PermissionService

位于 `src/services/permission.service.ts`，提供权限管理功能：

**核心方法**:

```typescript
class PermissionService {
  // 获取用户完整权限信息
  async getUserFullPermissions(userId: string): Promise<UserFullPermissionsDTO>;

  // 检查用户是否拥有指定权限
  async hasPermission(userId: string, permission: Permission): Promise<boolean>;

  // 检查用户是否拥有任一权限
  async hasAnyPermission(userId: string, permissions: Permission[]): Promise<boolean>;

  // 检查用户是否拥有所有权限
  async hasAllPermissions(userId: string, permissions: Permission[]): Promise<boolean>;

  // 设置用户权限配置
  async setUserPermissionConfig(operatorId: string, targetUserId: string, config: SetUserPermissionDTO);

  // 添加用户权限
  async addUserPermissions(operatorId: string, targetUserId: string, permissions: Permission[]);

  // 移除用户权限
  async removeUserPermissions(operatorId: string, targetUserId: string, permissions: Permission[]);

  // 清空用户权限配置
  async clearUserPermissionConfig(operatorId: string, targetUserId: string);

  // 获取用户组权限
  async getGroupPermissions(groupId: string): Promise<Permission[]>;

  // 设置用户组权限
  async setGroupPermissions(groupId: string, permissions: Permission[]);
}
```

### 7.2 权限计算逻辑

```typescript
async getUserFullPermissions(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { group: true }
  });

  const groupPermissions = user.group.permissions as Permission[];
  const permissionAdds = user.permissionAdds as Permission[];
  const permissionRemoves = user.permissionRemoves as Permission[];

  // 计算最终权限
  const effectivePermissions = [
    ...new Set([
      ...groupPermissions,
      ...permissionAdds
    ])
  ].filter(p => !permissionRemoves.includes(p));

  return {
    userId,
    groupPermissions,
    permissionAdds,
    permissionRemoves,
    effectivePermissions
  };
}
```

## 8. 安全措施

### 8.1 密码安全

**当前实现**:

```typescript
import md5 from "md5";

export function hashPassword(password: string): string {
  return md5(password);
}
```

**建议升级**:

```typescript
import bcrypt from "bcrypt";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

### 8.2 IP 黑名单

防止暴力破解攻击：

```typescript
// 检查 IP 是否在黑名单中
const blacklisted = await prisma.iPBlackList.findUnique({
  where: { ipAddress: clientIp },
});

if (blacklisted && blacklisted.ExpireTime > new Date()) {
  throw new ForbiddenError("IP 已被封禁");
}

// 登录失败时记录
if (loginFailed) {
  await addToBlacklist(clientIp, username);
}
```

### 8.3 令牌安全

- ✅ 使用强密钥（环境变量配置）
- ✅ 短有效期（Access Token）
- ✅ 刷新机制（Refresh Token）
- ✅ 令牌类型标识（防止混用）
- ❌ 未实现令牌撤销（可扩展）

### 8.4 请求日志

所有 API 请求都会记录到 APILog 表：

```typescript
await prisma.aPILog.create({
  data: {
    requestID: uuid(),
    userID: request.user?.userId,
    path: request.path,
    method: request.method,
    ipAddress: request.ip,
    statusCode: response.statusCode,
  },
});
```

## 9. 使用示例

### 9.1 登录流程

```typescript
// 1. 用户登录
const response = await fetch("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "admin",
    password: "password123",
  }),
});

const { data } = await response.json();
const { access_token, refresh_token } = data;

// 2. 存储令牌
localStorage.setItem("access_token", access_token);
localStorage.setItem("refresh_token", refresh_token);
```

### 9.2 访问受保护资源

```typescript
// 使用 Access Token 访问 API
const response = await fetch("/api/users/me", {
  headers: {
    Authorization: `Bearer ${access_token}`,
  },
});
```

### 9.3 刷新令牌

```typescript
// Access Token 过期后刷新
const response = await fetch("/api/auth/refresh", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    refresh_token: refresh_token,
  }),
});

const { data } = await response.json();
const { access_token: newAccessToken } = data;

// 更新存储的 Access Token
localStorage.setItem("access_token", newAccessToken);
```

### 9.4 自动刷新机制

```typescript
async function fetchWithAuth(url: string, options: RequestInit = {}) {
  let accessToken = localStorage.getItem("access_token");

  // 添加 Authorization 头
  options.headers = {
    ...options.headers,
    Authorization: `Bearer ${accessToken}`,
  };

  let response = await fetch(url, options);

  // 如果 401，尝试刷新令牌
  if (response.status === 401) {
    const refreshToken = localStorage.getItem("refresh_token");
    const refreshResponse = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (refreshResponse.ok) {
      const { data } = await refreshResponse.json();
      accessToken = data.access_token;
      localStorage.setItem("access_token", accessToken);

      // 重试原请求
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      };
      response = await fetch(url, options);
    }
  }

  return response;
}
```

## 10. 最佳实践

### 10.1 令牌管理

- ✅ 使用 HTTPS 传输令牌
- ✅ 不在 URL 中传递令牌（除非必要）
- ✅ 令牌存储在 HttpOnly Cookie 或 localStorage
- ✅ 定期刷新 Access Token
- ❌ 不在客户端存储敏感信息

### 10.2 权限检查

- ✅ 在 Controller 层使用装饰器
- ✅ 在 Service 层进行细粒度检查
- ✅ 遵循最小权限原则
- ❌ 不要在前端进行权限控制（仅用于 UI 显示）

### 10.3 错误处理

- ✅ 使用统一的错误类
- ✅ 返回清晰的错误消息
- ❌ 不泄露敏感信息（如用户是否存在）

### 10.4 日志记录

- ✅ 记录所有认证失败尝试
- ✅ 记录权限检查失败
- ✅ 记录敏感操作
- ❌ 不记录密码或令牌

## 11. 常见问题

### 11.1 令牌过期太快

**问题**: 开发环境 Access Token 5 秒就过期

**解决**: 修改环境变量

```env
JWT_ACCESS_EXPIRES_IN=15m
```

### 11.2 权限不生效

**问题**: 添加权限后仍然无法访问

**解决**:

1. 检查权限是否正确添加到数据库
2. 确认权限装饰器使用正确
3. 查看是否有 permissionRemoves 移除了该权限

### 11.3 无法修改其他用户

**问题**: 提示"权限不足"

**解决**:

1. 检查当前用户等级是否高于目标用户
2. 确认拥有相应的权限（如 user:update）

### 11.4 ReURL 无法使用

**问题**: 使用 ReURL 访问 API 失败

**解决**:

1. 检查 ReURL 是否过期
2. 确认格式正确：`?token=reurl:<reurl_id>`
3. 查看 ReURL 服务是否正常运行

## 12. 扩展功能

### 12.1 令牌撤销

可以实现令牌黑名单机制：

```typescript
// 存储已撤销的令牌
const revokedTokens = new Set<string>();

// 撤销令牌
function revokeToken(token: string) {
  revokedTokens.add(token);
}

// 验证时检查
function verifyToken(token: string) {
  if (revokedTokens.has(token)) {
    throw new UnauthorizedError("令牌已撤销");
  }
  return JWTAccessIns.verify(token);
}
```

### 12.2 多因素认证

可以添加 2FA 支持：

```typescript
// 生成 TOTP 密钥
import speakeasy from "speakeasy";

const secret = speakeasy.generateSecret();

// 验证 TOTP 代码
const verified = speakeasy.totp.verify({
  secret: secret.base32,
  encoding: "base32",
  token: userInputCode,
});
```

### 12.3 OAuth 集成

可以集成第三方登录：

```typescript
// Google OAuth 示例
import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client(CLIENT_ID);

async function verifyGoogleToken(token: string) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return payload;
}
```

### 12.4 会话管理

可以实现会话跟踪：

```typescript
// 记录活跃会话
interface Session {
  userId: string;
  token: string;
  createdAt: Date;
  lastActivity: Date;
}

const activeSessions = new Map<string, Session>();

// 登录时创建会话
function createSession(userId: string, token: string) {
  activeSessions.set(token, {
    userId,
    token,
    createdAt: new Date(),
    lastActivity: new Date(),
  });
}

// 登出时删除会话
function destroySession(token: string) {
  activeSessions.delete(token);
}
```
