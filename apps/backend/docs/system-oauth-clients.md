# 系统级 OAuth 客户端管理指南

## 概述

系统级 OAuth 客户端（如 `quyan-cli`）是官方应用，需要特殊管理以确保安全性和稳定性。

## 独立管理脚本

### 为什么需要独立脚本？

反复运行完整的 seed 脚本存在风险：

- ❌ 开发 `seed.ts` 会重置所有测试数据
- ❌ 生产 `seed.prod.ts` 仅创建最小必要数据
- ⚠️ 系统客户端配置可能被意外覆盖

**解决方案**：独立的系统客户端初始化脚本 `seed.system-clients.ts`

### 使用方式

```bash
# 开发/生产环境通用（幂等，可重复运行）
cd apps/backend
pnpm run db:seed:system-clients
```

### 脚本特点

✅ **幂等性** - 使用 `upsert`，可安全重复运行  
✅ **独立性** - 不影响其他数据（用户、配置等）  
✅ **可追溯** - 基于 `SYSTEM_OAUTH_CLIENTS` 常量定义  
✅ **可扩展** - 添加新客户端只需修改常量和脚本

## 权限控制

### 新增权限

```typescript
Permission.OAUTH_CLIENT_SYSTEM_MANAGE = "oauth:client:system:manage";
```

### 权限用途

| 操作                  | 所需权限                     |
| --------------------- | ---------------------------- |
| 创建普通 OAuth 客户端 | `OAUTH_CLIENT_CREATE`        |
| 更新系统客户端配置    | `OAUTH_CLIENT_SYSTEM_MANAGE` |
| 删除系统客户端        | 🚫 **禁止**（代码层面保护）  |

### 权限分配建议

**超级管理员组** (`admin`):

- 拥有 `OAUTH_CLIENT_SYSTEM_MANAGE`
- 可运行 `db:seed:system-clients` 脚本

**普通管理员组**:

- 仅拥有 `OAUTH_CLIENT_CREATE/READ/UPDATE/DELETE`
- 无法修改系统客户端关键配置

## 保护机制

### 1. 数据库层标识

```typescript
isSystemClient: true; // 标记系统客户端
```

### 2. Service 层保护

**删除保护**：

```typescript
if (client.isSystemClient) {
  throw new ForbiddenError("系统 OAuth 客户端无法删除");
}
```

**更新保护**（限制关键字段）：

```typescript
const protectedFields = ["clientType", "redirectUris", "scopes"];
// 仅允许修改 name, description, homepageUrl, logoUrl 等
```

### 3. 启动验证

应用启动时自动验证系统客户端完整性：

```
[OAuthClientBootstrap] 系统 OAuth 客户端 quyan-cli 验证通过
```

如缺失则记录错误日志：

```
[ERROR] 系统 OAuth 客户端缺失: quyan-cli. 请运行 'pnpm run db:seed:system-clients' 修复。
```

## 部署流程

### 首次部署

```bash
# 1. 应用数据库迁移
pnpm run db:migrate:deploy

# 2. 运行生产种子（创建 admin 用户）
pnpm run db:seed:prod

# 3. 初始化系统客户端
pnpm run db:seed:system-clients

# 4. 启动应用
pnpm run start
```

### 现有环境升级

```bash
# 1. 应用迁移（添加 isSystemClient 字段）
pnpm run db:migrate:deploy

# 2. 初始化系统客户端（幂等）
pnpm run db:seed:system-clients

# 3. 重启应用
pm2 restart ecosystem.config.cjs
```

### 修复系统客户端

如果系统客户端配置错误或被误修改：

```bash
# 重新运行系统客户端初始化（会覆盖配置）
pnpm run db:seed:system-clients
```

## 添加新的系统客户端

### 步骤 1: 更新常量定义

**文件**: `apps/backend/src/constant/system-oauth-clients.ts`

```typescript
export const SYSTEM_OAUTH_CLIENTS = {
  CLI: {
    clientId: "quyan-cli",
    name: "Quyan CLI",
    description: "Official Quyan command-line interface",
  },
  DESKTOP: {
    // 新增
    clientId: "quyan-desktop",
    name: "Quyan Desktop",
    description: "Official Quyan desktop application",
  },
} as const;
```

### 步骤 2: 更新初始化脚本

**文件**: `apps/backend/prisma/seed.system-clients.ts`

添加 Desktop 客户端的 `upsert` 逻辑（复制 CLI 模式）

### 步骤 3: 更新启动验证

**文件**: `apps/backend/src/services/users/oauth-client-bootstrap.service.ts`

```typescript
const systemClientIds = ["quyan-cli", "quyan-desktop"];
```

### 步骤 4: 运行初始化

```bash
pnpm run db:seed:system-clients
```

## 安全建议

### ✅ 推荐做法

1. **最小权限原则** - 仅超级管理员拥有 `OAUTH_CLIENT_SYSTEM_MANAGE`
2. **独立管理** - 使用 `db:seed:system-clients` 而非完整 seed
3. **监控验证日志** - 关注启动时的系统客户端验证结果
4. **版本控制** - 系统客户端配置变更需代码审查

### ❌ 避免做法

1. ❌ 通过 API 手动创建系统客户端
2. ❌ 直接修改数据库中的系统客户端记录
3. ❌ 在生产环境运行 `db:seed` 或 `db:seed:prod`（除首次部署）
4. ❌ 给普通管理员 `OAUTH_CLIENT_SYSTEM_MANAGE` 权限

## 故障排查

### 问题：CLI 登录显示"无效的 OAuth 授权请求"

**原因**：数据库中缺少 `quyan-cli` 客户端

**解决**：

```bash
pnpm run db:seed:system-clients
```

### 问题：启动日志显示"系统 OAuth 客户端缺失"

**原因**：系统客户端未初始化或被删除

**解决**：

```bash
pnpm run db:seed:system-clients
pm2 restart ecosystem.config.cjs
```

### 问题：无法删除系统客户端

**原因**：代码层面的保护机制

**说明**：这是预期行为，系统客户端不应被删除。如需移除，请：

1. 修改代码移除保护逻辑
2. 手动在数据库中设置 `isSystemClient = false`
3. 通过 API 删除

## 参考文件

- 常量定义: `apps/backend/src/constant/system-oauth-clients.ts`
- 初始化脚本: `apps/backend/prisma/seed.system-clients.ts`
- 启动验证: `apps/backend/src/services/users/oauth-client-bootstrap.service.ts`
- Service 保护: `apps/backend/src/services/users/oauth-client.service.ts`
- 权限定义: `packages/shared/src/permission.ts`
