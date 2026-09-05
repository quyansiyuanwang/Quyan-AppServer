# 07 — 认证与授权

## 认证体系概览

后端支持多种认证方案（在 `tsoa.json` 中定义）：

| 安全方案 | 用途 | Token 格式 |
|----------|------|------------|
| `jwt` | 标准用户认证 | `Authorization: Bearer <jwt>` |
| `relay-token` | AI API 代理访问 | `Authorization: Bearer rlt_<token>` 或 `x-api-key` 头 |
| `local-or-jwt` | 开发环境本地绕过 | 同上（localhost 请求免认证） |

认证实现：`src/middleware/auth/auth_guard.ts` 的 `expressAuthentication()` 函数。

## JWT 认证

### Token 类型

| Token | 用途 | 有效期（开发） | 有效期（生产推荐） |
|-------|------|--------------|------------------|
| Access Token | API 请求认证 | 5 秒 | 900 秒 (15 分钟) |
| Refresh Token | 刷新 Access Token | 28800 秒 (8 小时) | 604800 秒 (7 天) |

Access Token 有效期极短以确保安全性；Refresh Token 用于无感刷新。

### Token 载荷

```typescript
interface TokenPayload {
  userId: string;
  updatedAt: number;  // 用户信息更新时间戳，用于 token 失效
}
```

`updatedAt` 字段确保用户权限变更后所有旧 token 立即失效。

### 登录流程

```
1. POST /v1/auth/login { username, password }
2. 后端验证凭据 → 检查账户状态
3. 如启用 2FA → 返回 CustomCode.TWO_FACTOR_REQUIRED
4. 如需要同意法律协议 → 返回 CustomCode.POLICY_CONSENT_REQUIRED
5. 成功 → 返回 { access_token, refresh_token }
```

### Token 刷新流程

```
1. 前端 Axios 拦截器检测到 Access Token 即将过期（3 秒缓冲）
2. 前端发起 POST /v1/auth/refresh { refresh_token }
3. 后端验证 Refresh Token → 检查账户状态 → 返回新 token 对
4. 如果 Refresh Token 也过期 → 前端清除登录状态，重定向到登录页
```

**单 Promise 模式**：前端使用单例 Promise 防止并发刷新请求。多个 API 调用同时触发刷新时，只有第一个请求实际发起刷新，其余等待同一个 Promise 结果。

### Token 失效场景

以下情况会导致 token 失效，需要重新登录：

1. **用户权限变更** — `updatedAt` 改变，所有旧 token 失效 (`TOKEN_EXPIRED_DUE_TO_UPDATE`)
2. **账户被禁用** — ACCOUNT_DISABLED
3. **管理员强制登出** — 会话被撤销
4. **Token 被加入黑名单** — JWT JTI 在 Redis 黑名单中

## 权限系统 (RBAC)

### 权限计算

```
最终权限 = 用户组权限 + 个人附加权限 - 个人移除权限
```

- **用户组权限** (`Group.permissions` — JSON 数组)：用户所属组的基础权限
- **个人附加权限** (`User.permissionAdds` — JSON 数组)：额外授予的权限
- **个人移除权限** (`User.permissionRemoves` — JSON 数组)：特别撤销的权限

### 服务端权限检查

使用 `@CheckPermission` 装饰器：

```typescript
// 需要单个权限
@CheckPermission(Permission.USER_CREATE, PermissionCheckMode.ALL, "jwt")

// 需要任意一个权限 (OR)
@CheckPermission([Perm.A, Perm.B], PermissionCheckMode.ANY, "jwt")

// 需要所有权限 (AND)
@CheckPermission([Perm.A, Perm.B], PermissionCheckMode.ALL, "jwt")
```

权限检查在 Controller 方法执行前运行，无权限返回 403 (`CustomCode.PERMISSION_DENIED`)。

### 前端权限检查

Pinia store `permissionStore` 提供本地检查方法：

```typescript
const permStore = usePermissionStore();

// 检查单个权限
permStore.hasPermission(Permission.USER_CREATE);

// 检查任意一个权限
permStore.hasAnyPermission([Permission.USER_READ, Permission.USER_LIST]);

// 检查所有权限
permStore.hasAllPermissions([Permission.USER_UPDATE, Permission.USER_DELETE]);
```

组件中使用 `PermissionWrapper` 进行条件渲染：

```vue
<PermissionWrapper :permission="Permission.USER_CREATE">
  <el-button>创建用户</el-button>
</PermissionWrapper>
```

## OAuth 2.0

支持标准 OAuth 2.0 授权码流程：

1. 浏览器打开认证站 `/oauth/authorize` — 用户授权页面
2. 认证站页面调用 API `GET /v1/oauth/authorize` — 加载授权预览（需要已登录的 JWT 会话）
3. 认证站页面调用 API `POST /v1/oauth/authorize` — 用户确认授权
4. 客户端调用 API `POST /v1/oauth/token` — 换取 token
5. 客户端调用 API `POST /v1/oauth/revoke` — 撤销 token

`/v1/oauth/authorize` 是受保护的 API，不是可直接在浏览器地址栏打开的页面。
CLI 或第三方客户端应打开认证站的 `/oauth/authorize`，完成登录后由页面调用 API；
授权码换取令牌仍使用 API 的 `POST /v1/oauth/token`。

OAuth 客户端通过 `OAuthClient` 模型管理，需要审核（`reviewStatus`）才能上线。

## RAM (Resource Access Management)

支持子账户体系：
- **子账户 (sub_account)**: `userType = "sub_account"`, 通过 `accountOwnerId` 关联主账户
- **子用户 (sub_user)**: `userType = "sub_user"`, 通过 `parentUserId` 关联子账户

RAM 角色和策略：
- `RamRole` — 可扮演的角色，含信任策略 (`trustPolicy`)
- `RamPolicy` — 权限策略文档
- `RamRoleSession` — 角色会话，含过期时间
- 支持跨账户角色扮演

## 双因素认证 (2FA)

### TOTP 模式

1. **设置**: `GET /v1/users/me/2fa/setup` → 生成密钥 + QR 码
2. **确认**: `POST /v1/users/me/2fa/confirm` → 验证 TOTP 码
3. **登录验证**: `POST /v1/auth/verify-2fa` → 输入 TOTP 码
4. **恢复码**: `POST /v1/users/me/2fa/regenerate-codes` → 备用恢复码

### Passkey (WebAuthn)

使用 `@simplewebauthn/server` 实现：
- `PasskeyCredential` 模型存储公钥凭证
- 支持设备注册和认证

### 信任设备

完成 2FA 后可标记设备为 "信任"：
- 信任 cookie 在指定窗口期内免 2FA
- `DELETE /v1/users/me/2fa/trusted-devices/{deviceId}` 撤销信任

### 升级认证 (Step-up 2FA)

对敏感操作可要求 2FA 重新验证：

```typescript
@TwoFactorChallengeProtected()
@Post("/sensitive-action")
public async sensitiveAction() { ... }
```

## 重放攻击保护 (Replay Protection)

### 签名机制

使用 HMAC 签名的 nonce 方案：

1. 前端通过 `GET /v1/auth/replay-signing-session` 获取签名会话
2. 使用 `REPLAY_SIGNING_MASTER_SECRET` 计算 HMAC
3. 在受保护的请求中包含签名

### 受保护的端点

```typescript
@ReplayProtected()
@Post("/protected-endpoint")
public async protectedEndpoint() { ... }
```

前端在 `scripts/generate-replay-protected-endpoints.js` 运行时自动识别受保护的端点列表。

## CAPTCHA 集成

### 信任机制

```
1. 用户完成 CAPTCHA 验证
2. POST /v1/auth/captcha/verify-and-trust → 设置信任 Cookie
3. 信任窗口内的后续请求免验证
4. GET /v1/auth/captcha/trust-status → 检查信任状态
```

### 受保护的端点

```typescript
@CaptchaProtected()
@Post("/sensitive-endpoint")
public async sensitiveEndpoint() { ... }
```

## 前端认证流转

```
应用启动 → bootstrap.ts
  → bootstrapSession() → 验证 token 有效性
    → 成功 → 启动心跳 → 进入应用
    → 失败 → 尝试 refresh token
      → 成功 → 启动心跳 → 进入应用
      → 失败 → 清除状态 → 重定向登录页

token 即将过期 → 自动刷新
权限变更 → TOKEN_EXPIRED_DUE_TO_UPDATE → 强制刷新 token
2FA 要求 → TWO_FACTOR_REQUIRED → 重定向 2FA 页面
策略要求 → POLICY_CONSENT_REQUIRED → 显示同意页面
```

## 环境变量（安全相关）

```bash
# JWT Secrets (>= 64 字符)
JWT_ACCESS_SECRET=<至少64字符的随机字符串>
JWT_REFRESH_SECRET=<至少64字符的随机字符串>

# 重放保护密钥 (必须与 JWT 密钥不同)
REPLAY_SIGNING_MASTER_SECRET=<至少64字符的随机字符串>

# 2FA 信任设备密钥 (必须与 JWT 密钥不同，各环境使用不同值)
TWO_FACTOR_TRUSTED_DEVICE_SECRET=<至少64字符的随机字符串>
```
