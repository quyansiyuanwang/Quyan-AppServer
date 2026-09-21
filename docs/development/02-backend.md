# 02 — 后端详解

## TSOA + 3-Layer 架构

后端基于 TSOA 实现 code-first OpenAPI：在 Controller 上用装饰器定义路由和参数，TSOA 自动生成 OpenAPI spec 和 Express 路由。**没有手动编写的路由文件。**

```
Controller (HTTP 层) → Service (业务逻辑层) → Repository (数据访问层) → Prisma/MySQL
```

### Controller (`src/api/controllers/`)

47 个 Controller 文件，按版本和功能组织：

```
src/api/controllers/
├── v1/                         # API v1 (主力)
│   ├── auth/                   # 认证 (login, register, 2FA, OAuth)
│   ├── users/                  # 用户/组/权限/RAM
│   ├── relay/                  # AI 代理 token/channel/config
│   ├── billing/                # 余额/月卡/兑换码
│   ├── system/                 # 系统配置/日志/统计
│   ├── chat/                   # AI 对话
│   ├── analytics/              # 埋点/热力图
│   ├── feedback/               # 用户反馈
│   ├── article/                # 文章/公告
│   ├── legal-policy/           # 法律协议版本
│   ├── json-endpoint/          # JSON 端点
│   ├── notification/           # 通知偏好
│   ├── remote-terminal/        # 远程终端
│   ├── oj-submitter/           # OJ Submitter 产品
│   ├── user-script/            # 用户脚本
│   ├── security/               # IP 黑白名单
│   ├── oauth/                  # OAuth 客户端管理
│   └── auth-center/            # Auth Center 客户端管理
├── v2/                         # API v2
│   └── relay/                  # Relay v2
└── _unversioned/               # 无版本
    ├── RootController.ts       # GET /ping
    ├── DocsController.ts       # GET /docs/openapi.json
    └── RelayProxyController.ts # /relay/proxy (核心 AI 代理)
```

**Controller 示例：**

```typescript
@Route("v1/users")
export class UserController extends Controller {
  @Get("/")
  @Security("jwt")
  @CheckPermission(Permission.USER_READ, PermissionCheckMode.ALL, "jwt")
  public async getUsers(): Promise<SuccessResponse<User[]>> {
    const users = await UserService.getInstance().getUsers();
    return { code: 0, message: "success", data: users };
  }
}
```

关键装饰器：
- `@Route()`, `@Get()`, `@Post()`, `@Put()`, `@Delete()` — 路由定义
- `@Security("jwt")` — 认证方案（对应 tsoa.json 中定义的安全方案）
- `@CheckPermission()` — RBAC 权限检查
- `@LogRoute()` — 自动日志记录
- `@ReplayProtected()` — 重放攻击保护
- `@CaptchaProtected()` — 人机验证
- `@TwoFactorChallengeProtected()` — 2FA 升级认证

### Service (`src/services/`)

数十个 Service 文件，按功能域组织：

| 域 | 核心 Service | 职责 |
|----|-------------|------|
| **Auth** | AuthService, TwoFactorService, PasskeyService, CaptchaService, EmailService | 登录注册、2FA、Passkey、CAPTCHA、邮件 |
| **Users** | UserService, GroupService, PermissionService, RamService, ImpersonationService | 用户 CRUD、组管理、权限计算、RAM 子账户、模拟 |
| **Relay** | RelayTokenService, RelayChannelService, RelayProxyService, RelayConfigService, ModelPricingService | AI 代理核心：token 管理、渠道、转发、定价 |
| **Billing** | BalanceService, MonthlyPassService, RedemptionCodeService, UsageChargeService | 余额、月卡、兑换码、用量计费 |
| **System** | SystemService, ConfigService, LogService, BusinessLogService, IPBlacklistService | 系统状态、配置、日志、IP 管理 |
| **Infrastructure** | RedisService, RateLimiterService, RedisErrorTrackerService, DistributedLockService | 缓存、限流、分布式锁 |
| **Notification** | NotificationService, NotificationManagementService, WebhookFormatter | 通知引擎、偏好管理、Webhook |
| **Other** | ChatService, ArticleService, FeedbackService, HeatmapService, etc. | 对话、文章、反馈、分析 |

### Relay 模型与混池契约

- 渠道限制使用 `ModelPricing.model` 的目录名称；令牌允许模型、模型映射和实际路由使用 `resolveModelId()` 解析出的请求模型 ID。两个身份域不得混用。
- 模型限制的缺失值表示不限制，有效空数组表示禁止全部；历史格式损坏时记录告警并按兼容策略放行。规范解析位于 `@quyan/shared`，前后端不得复制实现。
- 混池渠道通过 `RelayPoolResolverService` 解析。模型、请求格式、映射和叶子渠道身份必须沿同一条根到叶路径保持关联，不能分别求并集后再组合。
- legacy `RelayChannelMember` 与 strict `pooledChildren` 必须先投影为同一有效成员集，再供详情 DTO、管理列表成员数与 `RelayPoolResolverService` 使用；按成员 ID 去重，冲突时 strict 的优先级、权重和启用状态优先，禁止各处分别读取不同关系。
- 面向业务客户端的渠道 options 使用结构化 `modelCapabilities`，混池和普通渠道采用相同契约；不向用户暴露混池拓扑。
- 普通渠道读取 DTO 只返回 `has*ApiKey` 配置状态，禁止返回密钥正文。包含密钥的导出使用独立权限、2FA、重放保护和业务审计。
- OJ 请求按绑定渠道 ID 使用同一混池解析和模型映射流程，并在兼容叶子间故障转移；不得通过可变渠道名称重新查找凭据。
- 用户可见的业务校验错误必须提供后端 locale `messageKey`，由异常中间件按 `X-Locale` 生成响应；不得将英文源码错误直接作为面向用户的最终消息。

### 月卡一致性契约

- 月卡模板的 `allowedModels` 保存目录模型名称。创建、更新和发布都要校验活动模型、可访问活动渠道及结构化能力交集；发布时必须重新校验草稿，防止模型下架或混池变化后发布失效范围。
- 更新模板时，字段省略表示保留已有范围，显式空数组表示解除对应限制。校验对象必须是合并后的最终范围。
- 用户购买月卡时，余额行锁、时间窗口购买次数检查、余额扣减、余额流水和月卡创建必须处于同一数据库事务。所有购买入口必须经过该事务路径。

**Service 模式：**

```typescript
export class UserService {
  private static instance: UserService;
  public static getInstance(): UserService {
    if (!UserService.instance) UserService.instance = new UserService();
    return UserService.instance;
  }
  private userRepo = UserRepository.getInstance();
  // 业务逻辑方法...
}
```

### Repository (`src/store/`)

64+ 个 Repository 文件，封装 Prisma 数据访问。部分 Repository 有对应的 **Store**（Redis 缓存层），形成 Repository → Store 双层模式。

```
src/store/
├── user.repository.ts          # Prisma 查询
├── user.store.ts               # Redis 缓存 (可选)
├── group.repository.ts
├── relay-token.repository.ts
├── ...
└── security/
    ├── ipblacklist.ts
    └── ipwhitelist.ts
```

## 中间件链（`src/app.ts`）

中间件按严格顺序注册，顺序至关重要：

| 顺序 | 中间件 | 文件 | 职责 |
|------|--------|------|------|
| 1 | CORS | (Express cors) | 跨域（allowlist 模式） |
| 2 | Request Size Guard | `request-size-guard.ts` | 双层字节计数防超大请求 |
| 3 | Body Parsers | (Express) | json/urlencoded/multipart |
| 4 | urlTokenExtractor | `auth/url_token_extractor.ts` | `?token=` → Authorization header |
| 5 | localeMiddleware | `locale.ts` | Accept-Language 检测 |
| 6 | requestIdMiddleware | `request_id.ts` | UUID 注入 |
| 7 | loggingMiddleware | `logging.ts` | 请求/响应日志 |
| 8 | responseWrapperMiddleware | `response-wrapper.ts` | `{code, message, data}` 封装 |
| 9 | errorTrackerMiddleware | `error-tracker.ts` | IP 错误计数/自动封禁 |
| 10 | ipBlacklistCheckMiddleware | `ip-blacklist-check.ts` | 黑名单拦截 |
| 11 | streamingMiddleware | `streaming.middleware.ts` | SSE 流式响应 |
| 12 | RegisterRoutes(app) | (TSOA 生成) | 所有 API 路由 |
| 13 | Swagger UI | `swagger-ui.ts` | `/docs` API 文档 |
| 14 | 404 catch-all | (inline) | 未匹配路由 |
| 15 | exceptionMiddleware | `exception.ts` | 全局错误处理 |

**关键点**：`responseWrapperMiddleware` 必须在 `RegisterRoutes` 之前注册；`exceptionMiddleware` 必须最后注册。

## 认证方案（tsoa.json）

```json
{
  "securityDefinitions": {
    "jwt": { "type": "apiKey", "name": "Authorization", "in": "header" },
    "relay-token": { "type": "apiKey", "name": "Authorization", "in": "header" },
    "local-or-jwt": { "type": "apiKey", "name": "Authorization", "in": "header" }
  }
}
```

- `jwt`: 标准 JWT 认证（大多数接口使用）
- `relay-token`: `rlt_` 前缀的中转 token
- `local-or-jwt`: 本地请求可绕过认证（开发环境）

认证实现：`src/middleware/auth/auth_guard.ts` 的 `expressAuthentication()` 函数。

## 错误处理与本地化

### 写法：业务错误必须携带消息描述符

用户可见的消息来自 `src/locales` 的消息目录，**不写字面量原文**（原文不再被翻译，见下方「已退场的旧机制」）：

```typescript
import { BadRequestError, NotFoundError, TooManyRequestsError, TwoFactorRequiredError } from "@/util/errors";

// 无占位符
throw new NotFoundError("Relay channel not found", undefined, {
  messageKey: "relayChannel.notFound",
});

// 带安全标量参数
throw new BadRequestError("Invalid quota window", undefined, {
  messageKey: "monthlyPass.quotaWindowHoursMax",
  messageParams: { max: MONTHLY_PASS_MAX_QUOTA_WINDOW_HOURS },
});

// 自带挑战数据的错误类：第二参是 data，不要再塞 options
throw new TwoFactorRequiredError(undefined, { challengeToken, expiresIn });

// options 的位置随类而异，建议一律显式写全
throw new TooManyRequestsError("Rate limited", retryAfter, undefined, {
  messageKey: "supportAi.requestLimitReached",
});
```

`message` 参数保留为**内部诊断原文**：写日志、堆栈和排障时读它；用户看到的始终是描述符的渲染结果。
描述符渲染失败（key 不存在、缺参数）时出口会记录受控告警并回退到安全文案，不输出 key 或残留占位符。

### 参数边界：只允许安全领域标量

`messageParams` 只接受数字、容量/上限常量、权限名、枚举成员、闭集标识（状态、格式、模型名等）
这类明确安全的领域标量。**不得**传入请求体、Cookie/Token、数据库记录、上游响应或任意
`Error.message`——凡是「因为不合法才报错」的原始输入都不回显，否则等于把用户输入原样回吐给用户。

### 单一输出边界

`throw`、显式失败响应、2xx 业务失败三条路径都经 `src/util/response-renderer.ts` 的同一入口渲染：

- 优先级：已渲染消息 → 描述符 → 原文（**原样返回，不做反查与语言猜测**）→ `defaultMessageKey` → `common.success`
- 语言取自 `X-Locale`（`src/middleware/locale.ts`），缺失或非法时回退 `en`
- 同一业务失败在三条路径上得到完全相同的 `{ code, message, data? }`；`fields`、`Retry-After`
  与认证挑战 `data` 形状保持不变
- 内部诊断不进响应：`cause` 通过 `Object.defineProperty` 定义为不可枚举，只能经 `getDiagnosticCause()` 取用

### 字段校验

统一模型位于 `src/util/validation-problems.ts`：Zod issue、TSOA 字段错误与自定义 `superRefine`
都归一成 `ValidationProblem { path, rule, params }`，出口渲染成既有 `fields` 形状，
并在**没有更明确的业务原因**时生成顶层摘要（最多 3 项、240 字符）。

### 新增消息 key

1. 在 `src/locales/en.ts` 与 `src/locales/zh-CN.ts` 的**同一业务域**下添加同名 key（文案按语言各自撰写，占位符必须一致）
2. 编译期门禁：`_AssertLocaleKeys`（两个目录 key 集合一致）、`_AssertLocalePlaceholders`（占位符集合一致，报错会指出具体 key）
3. 运行期门禁：`tests/unit/locales/backend-locale-catalog.unit.test.ts` 校验域清单、同域无重复文案、
   跨域重复必须登记、每个 key 在两种语言下可渲染且无残留占位符
4. ESLint `backend-i18n/known-message-key` 校验字面量 key 是否真实存在

### 已退场的旧机制

原文反查（`translateKnownMessage`）、前缀猜测、原文目录与原文写法入口 `setResponseMessage`
已于 P13 删除：**原文不再被翻译，也不再充当翻译来源**。两条 ESLint 规则防止回归：

| 规则 | 拦截什么 |
| --- | --- |
| `backend-i18n/no-raw-error-message` | API 错误类用字面量原文构造且实参未携带描述符 |
| `backend-i18n/no-legacy-i18n-api` | 再次调用 `translateKnownMessage` / `getLegacyRawMessageEntries` |

API 错误类集合由 `src/util/errors.ts` 推导（继承 `ApiError` 的传递闭包），
继承裸 `Error` 的内部错误类不受约束——它们的消息不会到达客户端。

## 路径别名

```typescript
import { User } from "@src/store/user";       // @src/* → src/*
import logger from "@src/util/logger";
```

`@src/*` 映射由 `tsconfig.json` 和构建时的 `tsc-alias` 处理。

## 日志系统

- **Winston** 结构化日志 + 每日轮转
- 12 个日志类别：`app`, `auth`, `db`, `api`, `relay`, `relay:raw`, `email`, `security`, `billing`, `notification`, `script`, `system`
- `@LogRoute()` 装饰器：自动记录 Controller 方法的请求/响应
- 自动截断长内容（`LOG_TRUNCATE_CONFIG`）

## 关键工具类

| 文件 | 用途 |
|------|------|
| `util/auth/index.ts` | JWT access/refresh token 生成与验证 |
| `util/crypto.ts` | 密码哈希 |
| `util/permission/permission-decorator.ts` | `@CheckPermission` 装饰器 |
| `util/logger-decorator.ts` | `@LogRoute` 装饰器 |
| `util/ip-extractor.ts` | 客户端 IP 提取（X-Forwarded-For 等） |
| `util/request-context.ts` | AsyncLocalStorage 请求上下文 |
| `util/replay-protected-decorator.ts` | `@ReplayProtected` 重放保护 |
