# 07 — 认证与授权

## 认证体系概览

后端支持多种认证方案（在 `tsoa.json` 中定义）：

| 安全方案       | 用途             | Token 格式                                                                       |
| -------------- | ---------------- | -------------------------------------------------------------------------------- |
| `jwt`          | 标准用户认证     | `Authorization: Bearer <jwt>`                                                    |
| `relay-token`  | AI API 代理访问  | `Authorization: Bearer sk-rlt-<token>`（兼容旧 `rlt_<token>`） 或 `x-api-key` 头 |
| `local-or-jwt` | 开发环境本地绕过 | 同上（localhost 请求免认证）                                                     |

认证实现：`src/middleware/auth/auth_guard.ts` 的 `expressAuthentication()` 函数。

## JWT 认证

### Token 类型

| Token         | 用途              | 有效期（开发）    | 有效期（生产推荐） |
| ------------- | ----------------- | ----------------- | ------------------ |
| Access Token  | API 请求认证      | 5 秒              | 900 秒 (15 分钟)   |
| Refresh Token | 刷新 Access Token | 28800 秒 (8 小时) | 604800 秒 (7 天)   |

Access Token 有效期极短以确保安全性；Refresh Token 用于无感刷新。

### Token 载荷

```typescript
interface TokenClaims {
  userId: string
  updatedAt: string // user.updateTime.toISOString()，用于授权版本失效
  iat: number // 签发时间，Unix 秒
  exp: number // 过期时间，Unix 秒
  jti: string // 每次签发的唯一标识
}
```

载荷以 `apps/backend/src/util/auth/index.ts` 的 `JWTAccessIns.generateToken` 和
`apps/backend/src/services/auth/auth.service.ts` 为准：以上字段直接位于 JWT payload 顶层，
不是 `data` 字段内的 JSON 字符串，也没有自定义 `expiration` 字段。

前端通过 `apps/frontend/src/utils/jwt.ts` 唯一的解码函数读取载荷：
`storageScope.ts` 使用 `userId` / `updatedAt`，请求层使用 `exp` 调度刷新。
解码不验证签名，也不能代替后端认证或权限接口；资料和权限仍需按当前身份加载并校验。
测试使用同一顶层字段格式，不得用旧的嵌套载荷模拟服务端行为。

`updatedAt` 字段确保用户权限变更后所有旧 token 立即失效。

### 登录流程

```
1. GET /v1/auth/password-encryption-key 获取 RSA-OAEP/SHA-256 公钥
2. POST /v1/auth/login，密码使用 passwordCredential 密文提交
3. 后端解密后验证 bcrypt；旧 MD5 哈希会在成功登录后升级
4. 如启用 2FA → HTTP 401 + CustomCode.TWO_FACTOR_REQUIRED，验证成功后自动重试原操作
5. 如需要同意法律协议 → 返回 CustomCode.POLICY_CONSENT_REQUIRED
6. 成功 → 返回 { access_token }，refresh token 通过 HttpOnly Cookie 下发
```

### Token 刷新流程

```
1. 前端 Axios 拦截器检测到 Access Token 即将过期（3 秒缓冲）
2. 前端发起 POST /v1/auth/refresh，浏览器携带 HttpOnly 刷新 Cookie
3. 后端验证刷新 Cookie → 检查账户状态 → 返回 { access_token }
4. 如果 Refresh Token 也过期 → 前端清除登录状态，重定向到登录页
```

Access Token 只保存在前端内存；刷新 Cookie 不可由 JavaScript 读取。跨子站或整页加载时，
刷新接口不保证返回用户资料，前端必须从返回 Token 的顶层 `userId` 关联后续资料与权限请求。

**单 Promise 模式**：前端使用单例 Promise 防止并发刷新请求。多个 API 调用同时触发刷新时，只有第一个请求实际发起刷新，其余等待同一个 Promise 结果。

### Token 失效场景

以下情况会导致 token 失效，需要重新登录：

1. **用户权限变更** — `updatedAt` 改变，所有旧 token 失效 (`TOKEN_EXPIRED_DUE_TO_UPDATE`)
2. **账户被禁用** — ACCOUNT_DISABLED
3. **管理员强制登出** — 会话被撤销
4. **Token 被加入黑名单** — JWT JTI 在 Redis 黑名单中

## Permission 兼容层

以下公式描述 legacy 模式的基础权限计算。资源级 JSON 策略不能完整投影为全局 Permission 数组；IAM 模式的执行授权见下文。

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
const permStore = usePermissionStore()

// 检查单个权限
permStore.hasPermission(Permission.USER_CREATE)

// 检查任意一个权限
permStore.hasAnyPermission([Permission.USER_READ, Permission.USER_LIST])

// 检查所有权限
permStore.hasAllPermissions([Permission.USER_UPDATE, Permission.USER_DELETE])
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
- 角色、主体和授权资源必须属于同一账户，不允许跨账户角色扮演

## IAM 策略授权

IAM 将身份、操作、资源和条件分开建模。认证仍由 JWT、AccessKey 或角色会话完成；授权结果为 **显式 Deny > Allow > 默认拒绝**。前端菜单和旧 Permission 展示仅用于交互提示，不能代替服务端资源授权。

### 契约与职责

- `packages/shared/src/iam/` 是 Action、资源类型、条件键和策略类型的唯一事实来源。Action 只描述本产品真实能力；外部云服务示例不属于生产目录。
- `apps/backend/src/iam/parser/` 校验并规范化策略；`evaluator/` 执行策略决策；`request/` 从可信请求上下文解析主体和资源。
- `IamAuthorizationService` 合并用户、用户组、角色及授权范围，并校验有效角色会话。AssumeRole 不继承调用用户自己的策略。
- Controller 声明固定 Action 和具名 Resource Resolver；Service 校验实际操作的对象；Repository 保持账户隔离、有效状态及事务内复核。

身份策略使用 `Version: "1"`，支持 `Statement`、`Sid`、`Effect`、`Action`/`NotAction` 二选一、`Resource` 和类型化 `Condition`。Action/Resource 大小写敏感，仅支持 `*` 通配符。`NotAction` 在保存前展开为当前目录中兼容的有限 Action 集合，后续增加 Action 不会扩大已保存版本。未知字段、版本、操作或未实现条件均拒绝，不得静默忽略。角色信任策略使用独立校验器；`Principal` 不能出现在身份策略中。

资源采用 `acs:<service>:<region>:<accountId>:<resourceType>/<resourceId>` 格式，必须与 Action 注册的资源类型兼容。ARN 中的账户来自认证上下文，不能由请求体覆盖。资源属性由服务端读取，例如文章的 `quyan:ResourceOwnerId` 指保存的作者用户 ID，而不是 ARN 中的账户 ID。

### 接入 API

新增 JWT API 应声明显式 IAM 定义，例如：

```typescript
@Post("{id}/publish")
@Security("jwt")
@Middlewares(
  replayProtectionMiddleware,
  validateParams(articleIdParamsSchema),
  iamAuthorizationMiddleware({
    action: "quyan:article:Publish",
    resourceKind: "single-resource",
    resource: articleResourceResolver,
  }),
)
public async publishArticle(
  @Path() id: string,
  @Request() request: TypedRequest,
): Promise<ArticleDto> {
  return this.service.publishArticle(id, request.user!.userId, request);
}
```

`iamAuthorizationMiddleware` 从 `apps/backend/src/iam/middleware/iam-authorization.middleware.ts` 引入。上述 Resolver 复用 `request/article-resource-resolvers.ts` 中的实现；其他业务域应使用自身具名 Resolver，不复制匿名 ARN 拼接逻辑。

接入时必须同时满足：

1. Action 来自服务端元数据，不读取客户端提交的 Action Header/Query。
2. Resolver 验证标识、数据库归属和规范大小写；不能可靠解析时拒绝，不回退到 `*`。
3. Service 授权实际方法参数，不能仅依赖请求体或只检查批量请求的第一个对象。
4. 列表先做数据库账户隔离，使用有界候选页或有界数据库扫描逐资源评估；不得返回未授权行或未经授权过滤的全局总数。采用候选页时，过滤后允许空页，客户端应根据 `hasNext` 继续翻页，不能用获准行数量推断列表结束。指定目标的批量修改使用 `authorizeMany`，全部允许后才写入；“全部”类操作应只更新逐资源获准的快照，不重新使用更宽的查询条件。
5. 敏感写入在事务内复核有效身份、资源归属与已授权快照，避免授权后资源状态变化造成越权。
6. Condition 的值只能来自已注册的可信属性提供器。缺失或异常属性安全拒绝，不能通过调用参数伪造主体或资源所有者。

`iamCollectionAuthorizationMiddleware` 只验证集合边界，不能代替 Service 的逐行过滤。IAM 也不能替代计费、业务状态、凭据使用、公开可见性等业务校验。

本人自助能力通过共享 Action 的 `defaultAuthorizationScope: "self"` 注册，资源类型还须明确声明 `authenticatedSelfScope`。默认授权只覆盖当前执行用户的身份 ARN 或以该用户为父级的注册子资源。例如通知收件箱资源为 `acs:notification:*:<accountId>:inbox-item/<userId>/<itemId>`，默认模式只能访问本人的消息；显式 Deny 仍优先。不能仅因 Action 是 Read 或资源类型存在就自动授予默认权限。

### 凭据资源管理

访问密钥资源为 `acs:quyan:*:<accountId>:access-key/<userId>/<keyId>`。`quyan:ram:ListAccessKeys` 与 `quyan:ram:DeleteAccessKey` 是独立敏感操作，不注册默认本人授权；历史 `ACCESSKEY_READ`/`ACCESSKEY_DELETE` 只通过明确的兼容映射参与迁移。即使策略允许通配符，业务层仍限定当前执行用户自己的密钥，OAuth 第三方应用不能读取列表或撤销密钥。

`GET /v1/accesskeys/page` 使用统一分页边界，返回 `items`、`page`、`pageSize` 和 `hasNext`，不返回未授权资源总数。旧数组接口保留完整已授权结果，不能悄悄替换成第一页。列表先读取无凭据的目标元数据，逐资源授权后再次求值，并在可串行化事务内复核账户、角色会话与资源快照，再读取并脱敏资料；密钥原文和历史凭据列不得进入列表 DTO 或授权日志。

### 策略版本与委派

策略文档保存在不可变版本中，默认版本指针决定执行的策略。更新或恢复默认版本需要当前文档 hash，冲突后重新读取并确认，不自动重试覆盖。

创建、发布、绑定策略及修改主体关系需要对应管理 Action 和保守的委派子集证明。只能授予自身权限覆盖的 Action、Resource 和相同或更严格的 Condition；无法证明的通配符关系默认拒绝。账户恢复授权另行保护。策略文档不能被视为绕过跨账户、有效主体或资源归属检查的依据。

旧 Permission 是兼容输入，不是完整 IAM 目录。转换还须保留历史业务限制：例如文章编辑/删除的旧权限仍限定执行用户本人创作的文章；排序和发布有各自独立的范围。不能仅比较 Permission 集合就认定资源授权语义一致。

### 授权模式与数据迁移

`IAM_AUTHORIZATION_MODE` 控制旧权限桥接：

| 模式      | 旧权限桥接行为                        |
| --------- | ------------------------------------- |
| `legacy`  | 执行旧 Permission 检查                |
| `shadow`  | 旧检查仍强制，同时评估 IAM 以比较结果 |
| `enforce` | IAM 强制，读取或评估失败时拒绝        |

显式 `iamAuthorizationMiddleware` 始终强制 IAM，不受上述旧权限桥接模式降级。IAM 文档写入和绑定要求 `enforce`。切换配置前，必须验证目标 API 的 Action/Resolver、逐资源检查、业务限制、委派和账户恢复路径；修改模式不会补齐缺失的端点定义。

自定义旧策略可以通过仓库根目录的账户范围回填命令生成策略版本：

```bash
# 只读预检查
pnpm --filter @quyan/backend run iam:backfill-policies -- --account-owner-id <ACCOUNT_OWNER_ID>

# 由具备相应数据库操作权限的人员明确执行
pnpm --filter @quyan/backend run iam:backfill-policies -- --apply --account-owner-id <ACCOUNT_OWNER_ID>
```

回填保留原字段及附件关系；系统策略、空权限和不符合条件的记录不会被转换成通配符授权。应用前重新检查来源快照，来源变化不会被覆盖；重跑跳过已转换记录。历史回填版本须校验 hash、可信来源及保留的旧权限数据，不能把来源标记本身当成授权。版本恢复保留对应的兼容语义，不改写历史文档。回滚模式前须考虑显式 JSON 策略不能由旧 Permission 完整表达。

检查端点元数据及相对基线的覆盖退化：

```bash
pnpm --filter @quyan/backend run iam:routes:audit -- --check --base-ref <BASE_REF>
pnpm --filter @quyan/backend run iam:routes:audit -- --require-complete
```

路由检查不能证明 Service 的资源隔离或历史业务限制，应结合目标模块的单元、数据库及 API 测试。授权日志仅记录安全的主体/决策标识和资源 hash，不记录策略全文、Token 或 Secret。

策略编辑、JSON Schema、诊断与模拟的用户使用方法见 [RAM 管理文档](../../apps/docs-site/src/content/zh-CN/ram-management.md)。

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
