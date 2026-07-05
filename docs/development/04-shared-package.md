# 04 — 共享包 `@appserver/shared`

## 概述

`@appserver/shared` 是前后端共享类型与常量的**唯一规范数据源（single source of truth）**。前后端都通过 `"@appserver/shared": "workspace:*"` 依赖此包并 re-export 所需内容。修改共享包后前后端自动生效。

位置：`packages/shared/src/`

## 导出模块

### `permission.ts` — 权限枚举

系统所有权限的定义。这是唯一的权限定义源，前后端都从此处导入。

```typescript
export enum Permission {
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  // ... 130+ 个权限
}

export const ALL_PERMISSIONS = Object.values(Permission);
export function getPermissionCategory(permission: Permission | string): string;
```

权限格式：`resource:action`，按类别分组的完整列表见下表：

| 类别 | 数量 | 示例 |
|------|------|------|
| 用户管理 | 10 | `user:create`, `user:read`, `user:impersonate:view` |
| 用户组管理 | 6 | `group:create`, `group:permission:add` |
| 权限管理 | 3 | `permission:manage`, `permission:add` |
| RAM 访问控制 | 12 | `ram:user:create`, `ram:role:read`, `ram:assume_role` |
| RAM 策略 | 6 | `ram:policy:create`, `ram:policy:attach` |
| 系统管理 | 8 | `system:config`, `system:stats:read`, `system:log:read` |
| IP 黑名单 | 4 | `ip_blacklist:create`, `ip_blacklist:delete` |
| IP 白名单 | 3 | `ip_whitelist:create`, `ip_whitelist:read` |
| 中转令牌 | 5 | `relay:token:create`, `relay:token:custom_key` |
| 中转渠道 | 4 | `relay:channel:create`, `relay:channel:delete` |
| AccessKey | 3 | `accesskey:create`, `accesskey:read` |
| OAuth 客户端 | 6 | `oauth:client:create`, `oauth:client:review:update` |
| Auth Center | 6 | `auth_center:client:create` 等 |
| 兑换码 | 3 | `redemption:code:create`, `redemption:code:read` |
| 余额 | 2 | `balance:read`, `balance:recharge` |
| 月卡 | 5 | `monthly_pass:template:read`, `monthly_pass:usage:read` |
| 反馈 | 6 | `feedback:submit`, `feedback:review:update` |
| 模型定价 | 2 | `model:pricing:read`, `model:pricing:update` |
| 远程终端 | 12 | `remote_terminal:product:read`, `remote_terminal:session:create` |
| OJ Submitter | 7 | `oj:apikey:create`, `oj:pricing:update` |
| JSON 端点 | 4 | `json_endpoint:create`, `json_endpoint:delete` |
| 文章 | 5 | `article:create`, `article:publish` |
| 法律协议 | 5 | `legal_policy:create`, `legal_policy:publish` |
| 脚本 | 3 | `script:create`, `script:read` |
| 分析 | 2 | `analytics:read`, `analytics:manage` |
| 通知 | 1 | `notification:manage` |
| Passkey | 1 | `passkey:manage` |
| 特殊/调试 | 2 | `debug:access`, `debug:openapi:read` |

**总计：130+ 个权限**

### `custom-code.ts` — 业务错误码

```typescript
export enum CustomCode {
  OK = 0,
  AUTH_FAILED = 1001,
  VALIDATION_FAILED = 1002,
  NOT_FOUND = 1003,
  PERMISSION_DENIED = 1004,
  INTERNAL_SERVER_ERROR = 1005,
  TOKEN_EXPIRED_DUE_TO_UPDATE = 1006,
  ACCOUNT_DISABLED = 1007,
  // ... 30+ 个错误码
  CAPTCHA_TRUST_REQUIRED = 1031,
}
```

前端通过 `customCodeBus` 事件总线监听这些错误码以触发特定处理（如强制登出、2FA 重定向）。

### `status.ts` — 状态常量

```typescript
export const MANAGED_STATUS = { DELETED: -1, DISABLED: 0, ENABLED: 1 } as const;
export const HEARTBEAT_STATUS = { DOWN: 0, UP: 1 } as const;
```

### `feedback.ts` — 反馈常量

```typescript
export const FEEDBACK_TYPES = ['suggestion', 'bug', 'other'] as const;
export const FEEDBACK_WORKFLOW_STATUSES = ['pending', 'processing', 'accepted', 'rejected', 'completed'] as const;
export const FEEDBACK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const FEEDBACK_COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export function isFeedbackTerminalStatus(status: string): boolean;
```

### `legal-policy.ts` — 法律协议

```typescript
export enum LegalPolicyType {
  TERMS_OF_SERVICE = 'terms_of_service',
  PRIVACY_POLICY = 'privacy_policy',
}
export enum LegalPolicyPublishStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}
```

### `relay-channel.ts` — 中转渠道状态

```typescript
export const RELAY_CHANNEL_STATUS = { DELETED: 0, ENABLED: 1, DISABLED: 2 } as const;
```

### `notification-event.ts` — 通知事件

25 个通知事件枚举，按域分组：账单/配额（7）、反馈（3）、安全（5）、RAM（10）。

### `client-fingerprint.ts` — 客户端指纹

```typescript
export const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{16,256}$/;
export function normalizeFingerprint(value: string): string | undefined;
```

## 使用方式

### 后端 (`apps/backend/src/constant/permission.ts`)

```typescript
// 直接从 shared 包 re-export
export { Permission, ALL_PERMISSIONS } from '@appserver/shared';
```

### 前端 (`apps/frontend/src/constant/permission.ts`)

```typescript
// 直接从 shared 包 re-export
export { Permission, ALL_PERMISSIONS } from '@appserver/shared';
```

## 一致性校验

`scripts/validate-frontend-permissions.mjs` 验证：
1. 前后端都从 `@appserver/shared` re-export（非本地定义）
2. 前端的 `PERMISSION_META` 覆盖了所有 `Permission` 枚举值
3. 没有多余或缺失的权限条目

此脚本在 `pnpm run precommit` 时自动运行。
