# 系统级 OAuth 客户端管理员手册

## 概述

系统级 OAuth 客户端（如 `quyan-cli`）是官方应用，需要管理员**手动注册**以确保安全性和可控性。

本文档提供完整的注册流程、API 示例和管理指南。

---

## 快速开始

### 方式一：通过管理后台（推荐）

1. 以超级管理员身份登录管理后台
2. 进入 **OAuth 应用管理** → **创建应用**
3. 填写以下信息：

**Quyan CLI 配置**:

```
应用名称: Quyan CLI
Client ID: quyan-cli
客户端类型: public（公共客户端）
授权类型: authorization_code, refresh_token
回调地址: http://127.0.0.1:40016/callback
权限范围:
  - profile
  - relay:token:read
  - relay:token:create
  - relay:token:update
  - relay:token:delete
  - relay:channel:read
  - relay:usage:read
  - balance:read
PKCE: 必需（启用）
访问令牌有效期: 3600 秒（1小时）
刷新令牌有效期: 604800 秒（7天）
```

4. 创建后，**手动将应用标记为"已批准"状态**
5. （可选）如需标记为系统客户端，见下方"数据库操作"部分

---

### 方式二：通过 API

#### 步骤 1: 获取管理员 Token

```bash
curl -X POST http://localhost:10001/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_admin_password"
  }'
```

保存返回的 `accessToken`。

#### 步骤 2: 创建 OAuth 客户端

```bash
curl -X POST http://localhost:10001/v1/oauth-clients \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Quyan CLI",
    "clientId": "quyan-cli",
    "clientType": "public",
    "grantTypes": ["authorization_code", "refresh_token"],
    "redirectUris": ["http://127.0.0.1:40016/callback"],
    "scopes": [
      "profile",
      "relay:token:read",
      "relay:token:create",
      "relay:token:update",
      "relay:token:delete",
      "relay:channel:read",
      "relay:usage:read",
      "balance:read"
    ],
    "isPkceRequired": true,
    "accessTokenLifetime": 3600,
    "refreshTokenLifetime": 604800,
    "homepageUrl": "https://github.com/your-org/quyan-cli",
    "description": "Official Quyan command-line interface"
  }'
```

#### 步骤 3: 提交审核

```bash
# 获取创建的客户端 ID
CLIENT_ID="<从上一步返回的 id>"

# 提交审核
curl -X POST "http://localhost:10001/v1/oauth-clients/${CLIENT_ID}/submit" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### 步骤 4: 批准应用（需要审核权限）

```bash
curl -X POST "http://localhost:10001/v1/oauth-clients/reviews/${CLIENT_ID}/review" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reviewStatus": "approved",
    "reviewComment": "Official CLI application - auto-approved"
  }'
```

---

## 标记为系统客户端（可选）

系统客户端标记提供额外保护：

- 🚫 无法通过 API 删除
- 🔒 关键字段（clientType, redirectUris, scopes）无法修改
- ✅ 启动时自动验证

### 方式：数据库直接操作

```sql
-- 查找客户端 ID
SELECT id, clientId, name, reviewStatus
FROM oauth_clients
WHERE clientId = 'quyan-cli';

-- 标记为系统客户端
UPDATE oauth_clients
SET isSystemClient = true
WHERE clientId = 'quyan-cli';

-- 验证
SELECT clientId, name, isSystemClient, reviewStatus
FROM oauth_clients
WHERE clientId = 'quyan-cli';
```

**重要提示**: 此操作不可逆（代码层面保护）。标记后无法通过 API 取消标记或删除。

---

## 系统客户端配置参考

### Quyan CLI

```json
{
  "clientId": "quyan-cli",
  "name": "Quyan CLI",
  "description": "Official Quyan command-line interface",
  "clientType": "public",
  "grantTypes": ["authorization_code", "refresh_token"],
  "redirectUris": ["http://127.0.0.1:40016/callback"],
  "scopes": [
    "profile",
    "relay:token:read",
    "relay:token:create",
    "relay:token:update",
    "relay:token:delete",
    "relay:channel:read",
    "relay:usage:read",
    "balance:read"
  ],
  "isPkceRequired": true,
  "accessTokenLifetime": 3600,
  "refreshTokenLifetime": 604800,
  "reviewStatus": "approved",
  "isSystemClient": true
}
```

### Quyan Desktop (未来扩展)

```json
{
  "clientId": "quyan-desktop",
  "name": "Quyan Desktop",
  "description": "Official Quyan desktop application",
  "clientType": "public",
  "grantTypes": ["authorization_code", "refresh_token"],
  "redirectUris": ["quyan://oauth/callback"],
  "scopes": ["profile", "relay:*", "balance:read"],
  "isPkceRequired": true,
  "accessTokenLifetime": 3600,
  "refreshTokenLifetime": 2592000,
  "reviewStatus": "approved",
  "isSystemClient": true
}
```

---

## 验证清单

### ✅ 客户端已创建

```bash
# 通过 API 验证
curl "http://localhost:10001/v1/oauth-clients?clientId=quyan-cli" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

预期返回包含:

- `reviewStatus: "approved"`
- `isSystemClient: true` (如果已标记)

### ✅ CLI 可以登录

```bash
cd apps/cli-native
cargo run -- login --browser
```

预期:

1. 浏览器打开授权页面（不显示"无效请求"）
2. 显示 "Quyan CLI" 应用信息
3. 授权后成功回调

### ✅ 启动验证通过

启动后端应用，查看日志:

```
[OAuthClientBootstrap] 系统 OAuth 客户端 quyan-cli 验证通过
```

如缺失:

```
[ERROR] 系统 OAuth 客户端缺失: quyan-cli. 请按照管理员手册注册。
```

---

## 权限要求

### 创建 OAuth 客户端

- **权限**: `OAUTH_CLIENT_CREATE`
- **角色**: 超级管理员、用户管理员

### 审核 OAuth 应用

- **权限**: `OAUTH_CLIENT_REVIEW_UPDATE`
- **角色**: 超级管理员

### 管理系统客户端

- **权限**: `OAUTH_CLIENT_SYSTEM_MANAGE`
- **角色**: 仅超级管理员

---

## 安全建议

### ✅ 推荐做法

1. **手动注册** - 通过管理后台或 API 明确创建
2. **文档记录** - 记录创建时间、操作人、用途
3. **最小权限** - 仅授予必要的 scopes
4. **定期审计** - 检查系统客户端的使用情况
5. **保护标记** - 生产环境的官方应用应标记为系统客户端

### ❌ 避免做法

1. ❌ 使用自动脚本批量创建（失去控制）
2. ❌ 给普通管理员 `OAUTH_CLIENT_SYSTEM_MANAGE` 权限
3. ❌ 在数据库中直接创建（跳过审计日志）
4. ❌ 将测试客户端标记为系统客户端

---

## 故障排查

### 问题: CLI 登录显示"无效的 OAuth 授权请求"

**原因**: 数据库中缺少 `quyan-cli` 客户端或未批准

**解决**:

1. 检查客户端是否存在:
   ```sql
   SELECT * FROM oauth_clients WHERE clientId = 'quyan-cli';
   ```
2. 如不存在，按照"快速开始"注册
3. 如存在但 `reviewStatus != 'approved'`，批准应用

### 问题: 启动日志显示"系统 OAuth 客户端缺失"

**原因**: 客户端未创建或未标记为系统客户端

**解决**:

1. 按照"快速开始"创建客户端
2. （可选）标记为系统客户端（见"数据库操作"部分）

### 问题: 无法删除系统客户端

**原因**: 代码层面的保护机制

**说明**: 这是预期行为。如需删除:

1. 在数据库中设置 `isSystemClient = false`
2. 通过 API 删除

---

## 管理脚本（可选）

如果你确实需要批量创建（如初始化新环境），可以使用以下脚本：

### create-system-clients.sh

```bash
#!/bin/bash

API_URL="http://localhost:10001"
ADMIN_TOKEN="your_admin_token_here"

# 创建 CLI 客户端
curl -X POST "$API_URL/v1/oauth-clients" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Quyan CLI",
    "clientId": "quyan-cli",
    "clientType": "public",
    "grantTypes": ["authorization_code", "refresh_token"],
    "redirectUris": ["http://127.0.0.1:40016/callback"],
    "scopes": ["profile", "relay:token:read", "relay:token:create", "relay:token:update", "relay:token:delete", "relay:channel:read", "relay:usage:read", "balance:read"],
    "isPkceRequired": true,
    "accessTokenLifetime": 3600,
    "refreshTokenLifetime": 604800,
    "description": "Official Quyan command-line interface"
  }'

echo "请手动批准应用并标记为系统客户端（如需要）"
```

**使用前提**:

- 仅用于新环境初始化
- 需要手动填入 admin token
- 创建后仍需手动批准

---

## 参考文档

- **权限定义**: `packages/shared/src/permission.ts`
- **Service 保护**: `apps/backend/src/services/users/oauth-client.service.ts`
- **启动验证**: `apps/backend/src/services/users/oauth-client-bootstrap.service.ts`
- **常量定义**: `apps/backend/src/constant/system-oauth-clients.ts`

---

## 总结

**推荐流程**:

1. 管理员通过**管理后台或 API 手动创建** OAuth 客户端
2. 提交审核并批准
3. （可选）通过数据库标记为系统客户端
4. 验证 CLI 可以正常登录

这种方式比自动脚本更加：

- ✅ 可控 - 管理员明确知道创建了什么
- ✅ 灵活 - 可以自定义配置
- ✅ 安全 - 有完整的审计日志
- ✅ 符合生产环境最佳实践
