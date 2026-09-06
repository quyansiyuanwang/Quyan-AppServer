# 系统级 OAuth 客户端实施总结

## 📋 实施内容

### 1. 数据库层 ✅

**Schema 扩展**:
- 添加 `isSystemClient` 字段到 `OAuthClient` 模型
- 添加性能索引 `@@index([isSystemClient, status])`
- 迁移文件: `20260906102351_add_system_client_flag`

**验证**:
```sql
SELECT clientId, name, isSystemClient, reviewStatus 
FROM oauth_clients 
WHERE clientId = 'quyan-cli';
```

### 2. 种子文件 ✅

**生产种子** (`seed.prod.ts`):
- 自动创建 `quyan-cli` 系统客户端
- 设置 `isSystemClient: true` 和 `reviewStatus: "approved"`

**开发种子** (`seed.ts`):
- 更新现有 CLI 客户端，添加 `isSystemClient: true`

**独立脚本** (`seed.system-clients.ts`):
- 专门管理系统客户端的幂等脚本
- 可独立运行，不影响其他数据
- 命令: `pnpm run db:seed:system-clients`

### 3. 权限系统 ✅

**新增权限** (`packages/shared/src/permission.ts`):
```typescript
OAUTH_CLIENT_SYSTEM_MANAGE = 'oauth:client:system:manage'
```

**权限用途**:
- 管理系统级 OAuth 客户端配置
- 仅超级管理员应拥有此权限

**前端自动同步**:
- 前端从 `@quyan/shared` 导入权限
- 无需手动修改前端代码

### 4. Service 层保护 ✅

**删除保护** (`oauth-client.service.ts`):
```typescript
if (client.isSystemClient) {
  throw new ForbiddenError("系统 OAuth 客户端无法删除");
}
```

**更新保护**:
```typescript
const protectedFields = ['clientType', 'redirectUris', 'scopes'];
// 系统客户端仅允许修改描述性字段
```

### 5. 启动验证 ✅

**验证服务** (`oauth-client-bootstrap.service.ts`):
- 应用启动时自动验证系统客户端
- 缺失则记录错误日志
- 不自动创建（避免启动时数据库写入）

**集成** (`app.ts`):
```typescript
OAuthClientBootstrapService.getInstance(prisma)
  .verifySystemClients()
  .catch(error => logger.error(...));
```

### 6. 常量定义 ✅

**文件**: `src/constant/system-oauth-clients.ts`
```typescript
export const SYSTEM_OAUTH_CLIENTS = {
  CLI: {
    clientId: "quyan-cli",
    name: "Quyan CLI",
    description: "Official Quyan command-line interface",
  },
} as const;
```

### 7. 文档 ✅

**管理指南**: `docs/system-oauth-clients.md`
- 独立管理脚本使用方式
- 权限控制说明
- 保护机制详解
- 部署流程
- 故障排查

---

## 🎯 解决的问题

### 问题 1: CLI OAuth 授权失败

**原因**: 生产环境数据库缺少 `quyan-cli` OAuth 客户端

**解决**: 
- ✅ 生产种子文件自动创建
- ✅ 独立脚本可单独运行
- ✅ 启动验证及时发现缺失

### 问题 2: 反复运行 seed 的风险

**风险**: 
- ❌ 完整 seed 会重置测试数据
- ❌ 系统客户端配置可能被覆盖

**解决**:
- ✅ 独立脚本 `seed.system-clients.ts`
- ✅ 幂等设计，可安全重复运行
- ✅ 不影响其他数据

### 问题 3: 权限管理缺失

**风险**: 任何拥有 `OAUTH_CLIENT_CREATE` 的用户都能创建客户端

**解决**:
- ✅ 新增 `OAUTH_CLIENT_SYSTEM_MANAGE` 权限
- ✅ Service 层强制验证
- ✅ 系统客户端关键字段受保护

---

## 📝 使用指南

### 开发环境

```bash
# 完整初始化
pnpm run db:migrate:reset
pnpm run db:seed

# 仅初始化系统客户端
pnpm run db:seed:system-clients
```

### 生产环境

```bash
# 首次部署
pnpm run db:migrate:deploy
pnpm run db:seed:prod
pnpm run db:seed:system-clients

# 现有环境升级
pnpm run db:migrate:deploy
pnpm run db:seed:system-clients
pm2 restart ecosystem.config.cjs
```

### 修复系统客户端

```bash
# 如果配置错误或被误修改
pnpm run db:seed:system-clients
```

---

## 🔒 安全机制

### 1. 数据库层标识

```typescript
isSystemClient: true  // 清晰标记
```

### 2. Service 层保护

- 🚫 **禁止删除** - 任何尝试删除都会抛出异常
- 🔒 **字段保护** - `clientType`, `redirectUris`, `scopes` 等关键字段不可修改
- ✅ **描述性字段可改** - `name`, `description`, `logoUrl` 等允许修改

### 3. 启动验证

- ✅ 自动检测系统客户端完整性
- 📝 记录详细日志
- ⚠️ 缺失时发出警报

### 4. 权限控制

- ✅ 专门的管理权限
- ✅ 前后端自动同步
- ✅ 最小权限原则

---

## 🚀 扩展性

### 添加新的系统客户端（如 Desktop）

**步骤 1**: 更新常量
```typescript
// src/constant/system-oauth-clients.ts
DESKTOP: {
  clientId: "quyan-desktop",
  name: "Quyan Desktop",
  description: "Official desktop application",
}
```

**步骤 2**: 更新初始化脚本
```typescript
// prisma/seed.system-clients.ts
// 添加 Desktop 客户端的 upsert 逻辑
```

**步骤 3**: 更新启动验证
```typescript
// oauth-client-bootstrap.service.ts
const systemClientIds = ["quyan-cli", "quyan-desktop"];
```

**步骤 4**: 运行初始化
```bash
pnpm run db:seed:system-clients
```

---

## ✅ 验证清单

### 数据库验证

```bash
# 运行独立脚本
pnpm run db:seed:system-clients

# 验证结果
✓ Quyan CLI (quyan-cli)
  - 类型: public
  - 状态: approved
  - 系统客户端: true
```

### 应用启动验证

```
[OAuthClientBootstrap] 系统 OAuth 客户端 quyan-cli 验证通过
```

### CLI 功能验证

```bash
cd apps/cli-native
cargo run -- login --browser

# 预期：
# ✅ 浏览器打开授权页面
# ✅ 显示 "Quyan CLI" 应用信息
# ✅ 授权后成功回调
```

### 保护机制验证

```bash
# 尝试删除系统客户端（应被拒绝）
curl -X DELETE http://localhost:10001/v1/oauth-clients/<id> \
  -H "Authorization: Bearer <token>"

# 预期：403 Forbidden
```

---

## 📂 关键文件

### 后端

| 文件 | 用途 |
|------|------|
| `prisma/schema.prisma` | Schema 定义（添加 `isSystemClient`） |
| `prisma/seed.system-clients.ts` | 独立初始化脚本 |
| `prisma/seed.prod.ts` | 生产种子（创建系统客户端） |
| `prisma/seed.ts` | 开发种子（创建系统客户端） |
| `src/services/users/oauth-client.service.ts` | Service 层保护逻辑 |
| `src/services/users/oauth-client-bootstrap.service.ts` | 启动验证服务 |
| `src/constant/system-oauth-clients.ts` | 系统客户端常量 |
| `src/app.ts` | 启动验证集成 |
| `docs/system-oauth-clients.md` | 管理指南 |

### 共享包

| 文件 | 用途 |
|------|------|
| `packages/shared/src/permission.ts` | 权限定义（添加 `OAUTH_CLIENT_SYSTEM_MANAGE`） |

### 前端

前端自动从 `@quyan/shared` 导入权限，无需修改。

---

## 🎉 完成状态

- ✅ 数据库 Schema 扩展
- ✅ 数据库迁移创建并应用
- ✅ 生产种子文件更新
- ✅ 开发种子文件更新
- ✅ 独立初始化脚本创建
- ✅ Service 层保护逻辑
- ✅ 启动验证服务
- ✅ 权限系统扩展
- ✅ 前端权限自动同步
- ✅ 管理文档完成
- ✅ 本地验证通过

**所有实施已完成！** 🚀
