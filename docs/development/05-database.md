# 05 — 数据库

## 概述

- **数据库**: MySQL
- **ORM**: Prisma 6.x
- **Schema 位置**: `apps/backend/prisma/schema.prisma` (1666 行)
- **模型总数**: 百余个

## 通用字段模式

每个模型都包含以下标准字段：

```prisma
model Example {
  id         String   @id @default(cuid())     // CUID 主键
  status     Int      @default(1)              // 软删除: 1=正常, 0=禁用, -1=删除
  createTime DateTime @default(now())          // 创建时间
  updateTime DateTime @updatedAt               // 更新时间
}
```

## 核心模型

### 用户与权限

| 模型 | 表名 | 说明 |
|------|------|------|
| User | `users` | 核心用户实体 |
| Group | `groups` | 用户组（角色），含 permissions (JSON) |
| RamRole | `ram_roles` | RAM 可扮演角色 |
| RamUserRoleBinding | `ram_user_role_bindings` | 用户→角色绑定 |
| RamGroupRoleBinding | `ram_group_role_bindings` | 组→角色绑定 |
| RamRoleSession | `ram_role_sessions` | 活跃角色会话 |
| RamPolicy | `ram_policies` | 权限策略文档 |
| RamPolicyAttachment | `ram_policy_attachments` | 策略→实体绑定 |

**User 模型关键字段**：
- `username` (唯一), `password`, `email`, `name`
- `groupId` → Group (权限继承)
- `permissionAdds` (JSON) — 额外增加的权限
- `permissionRemoves` (JSON) — 额外移除的权限
- `accountOwnerId` — RAM 子账户的拥有者（自引用）
- `parentUserId` — RAM 子用户的父用户（自引用）
- `userType` — "root" | "sub_account" | "sub_user"
- `twoFactorEnabled`, `twoFactorPasskeyRequired`

**权限计算公式**：`最终权限 = 组权限 + permissionAdds - permissionRemoves`

### AI 代理 (Relay)

| 模型 | 表名 | 说明 |
|------|------|------|
| RelayChannel | `relay_channels` | 上游 AI API 渠道配置 |
| RelayToken | `relay_tokens` | 用户 API token (前缀 `rlt_`) |
| RelayTokenQuotaWindow | `relay_token_quota_windows` | 基于时间窗口的配额 |
| RelayTokenFailoverConfig | `relay_token_failover_configs` | 故障转移配置 |
| RelayTokenChannelConfig | `relay_token_channel_configs` | 按 token 的渠道优先级 |
| RelayChannelSwitchLog | `relay_channel_switch_logs` | 渠道切换日志 |
| RelayUsage | `relay_usages` | 每次请求的用量记录 |
| RelayConfig | `relay_configs` | 全局代理配置 |
| ModelPricing | `model_pricing` | AI 模型定价 |

**RelayToken 关键字段**：
- `token` (唯一, `rlt_` 前缀)
- `userId` → User (所有者)
- `channelId` → RelayChannel (默认渠道)
- `quotaLimit`, `allowedModels`, `ipWhitelist`
- `expiresAt`, `lastUsedAt`

### 计费

| 模型 | 表名 | 说明 |
|------|------|------|
| BalanceAccount | `balance_accounts` | 用户余额 |
| BalanceTransaction | `balance_transactions` | 余额变更日志 |
| MonthlyPassTemplate | `monthly_pass_templates` | 月卡套餐模板 |
| UserMonthlyPass | `user_monthly_passes` | 用户购买的月卡 |
| MonthlyPassUsage | `monthly_pass_usages` | 月卡用量记录 |
| RedemptionCode | `redemption_codes` | 兑换码 |

### OAuth / Auth Center

| 模型 | 说明 |
|------|------|
| OAuthClient | OAuth 2.0 客户端 |
| OAuthAuthorizationCode | 授权码 |
| OAuthAccessToken | 访问令牌 |
| OAuthRefreshToken | 刷新令牌 |
| OAuthConsent | 用户同意记录 |
| AuthCenterClient | Auth Center 客户端 (与 OAuthClient 结构镜像) |
| AuthCenterAuthorizationCode | Auth Center 授权码 |
| AuthCenterAccessToken | Auth Center 访问令牌 |
| AuthCenterRefreshToken | Auth Center 刷新令牌 |
| AuthCenterConsent | Auth Center 同意记录 |

### 认证与安全

| 模型 | 表名 | 说明 |
|------|------|------|
| AccessKey | `access_keys` | API 访问密钥 |
| PasskeyCredential | `passkey_credentials` | WebAuthn passkey |
| TwoFactorCredential | `two_factor_credentials` | TOTP 2FA |
| EmailVerification | `email_verifications` | 邮件验证码 |
| EmailRateLimitLog | `email_rate_limit_logs` | 邮件频率限制 |
| IPBlackList | `ip_black_lists` | IP 黑名单 |
| IPWhiteList | `ip_white_lists` | IP 白名单 |

### 系统与日志

| 模型 | 表名 | 说明 |
|------|------|------|
| ServerConfig | `server_configs` | 键值配置存储 |
| APILog | `api_logs` | HTTP 请求日志 |
| BusinessLog | `business_logs` | 业务审计日志 |
| UserOnlineSession | `user_online_sessions` | 在线会话追踪 |
| NotificationPreference | `notification_preferences` | 用户通知设置 |
| NotificationWebhook | `notification_webhooks` | Webhook URL |
| NotificationLog | `notification_logs` | 通知投递日志 |

### 内容

| 模型 | 表名 | 说明 |
|------|------|------|
| Article | `articles` | 文章/公告 |
| LegalPolicyVersion | `legal_policy_versions` | 法律协议版本 |
| UserPolicyAcceptance | `user_policy_acceptances` | 用户接受记录 |
| JsonEndpoint | `json_endpoints` | JSON 端点 (持久化 KV 存储) |
| Feedback | `feedbacks` | 用户反馈 |
| FeedbackComment | `feedback_comments` | 反馈评论 |

### 对话

| 模型 | 表名 | 说明 |
|------|------|------|
| Conversation | `conversations` | AI 对话 |
| Message | `messages` | 对话消息 |

### 分析

| 模型 | 表名 | 说明 |
|------|------|------|
| TrackEvent | `track_events` | 用户行为埋点 |
| HeatmapPoint | `heatmap_points` | 页面热力图数据 |

### 远程终端

| 模型 | 表名 | 说明 |
|------|------|------|
| RemoteTerminalProductTemplate | `remote_terminal_product_templates` | 产品模板 |
| RemoteTerminalUserEntitlement | `remote_terminal_user_entitlements` | 用户授权 |
| RemoteTerminalEntitlementToken | `remote_terminal_entitlement_tokens` | 注册令牌 |
| RemoteTerminalDeviceBinding | `remote_terminal_device_bindings` | 设备绑定 |

### OJ Submitter

| 模型 | 表名 | 说明 |
|------|------|------|
| OJAPIKey | `oj_api_keys` | OJ API 密钥 |
| OJModelPricing | `oj_model_pricing` | OJ 模型定价 |
| OJUsageRecord | `oj_usage_records` | OJ 用量记录 |

### 用户脚本

| 模型 | 表名 | 说明 |
|------|------|------|
| UserScript | `user_scripts` | 用户脚本 |
| UserScriptExecution | `user_script_executions` | 脚本执行记录 |

## 关键设计决策

### 软删除

所有模型通过 `status` 字段实现软删除：
- `1` = 正常（启用）
- `0` = 禁用
- `-1` = 已删除

查询时通常过滤 `status: 1`。

### CUID 主键

所有主键使用 `cuid()` 生成，非自增整数。优点：分布式友好、不暴露数据量。

### JSON 字段

部分字段使用 Prisma `Json` 类型以支持灵活结构：
- `Group.permissions` — 组权限列表
- `User.permissionAdds/permissionRemoves` — 个人权限调整
- `RelayChannel.modelMapping` — 模型名称映射
- `OAuthClient.grantTypes/redirectUris/scopes` — OAuth 配置数组

### 时间戳

- `createTime` — `@default(now())`，创建时自动设置
- `updateTime` — `@updatedAt`，更新时自动更新
- 业务时间字段（如 `expiresAt`、`lastUsedAt`）手动管理

## 常用数据库命令

```bash
# 在 AppServerMonorepo 根目录
pnpm run db:generate             # 生成 Prisma client
pnpm run db:push                 # 推送 schema 到数据库（开发，无迁移文件）
pnpm run db:migrate:dev          # 创建并运行新迁移
pnpm run db:migrate              # 运行待执行的迁移（生产）
pnpm run db:seed                 # 种子数据（开发）
pnpm run db:seed:prod            # 种子数据（生产）

# 或针对 backend 直接运行
pnpm --filter @quyan/backend db:push
pnpm --filter @quyan/backend db:migrate:dev
```

### 修改 Schema 的流程

1. 编辑 `apps/backend/prisma/schema.prisma`
2. 运行 `pnpm --filter @quyan/backend exec prisma migrate dev --name <migration-name>` 创建并执行迁移；也可使用包装命令 `pnpm run db:migrate:dev -- <migration-name>`。`migration.sql` 必须由 Prisma 生成，禁止手写、复制或事后编辑。
3. Prisma client 自动重新生成
4. 如有新的或变更的模型，更新相关的 Repository/Service
