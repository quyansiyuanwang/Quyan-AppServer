# 系统级 OAuth 客户端管理工具

本目录包含管理系统级 OAuth 客户端（官方应用）的工具和脚本。

## 📁 目录结构

```
scripts/system-clients/
├── seed.ts              # 自动初始化脚本（可选）
└── README.md            # 本文档
```

## 🎯 使用场景

### 场景 1: 快速初始化（开发/测试环境）

适用于需要快速搭建环境的场景。

```bash
cd apps/backend
pnpm run db:seed:system-clients
```

**特点**:

- ✅ 一条命令完成
- ✅ 幂等，可重复运行
- ⚠️ 配置固定，无法自定义

### 场景 2: 手动注册（生产环境推荐）

适用于生产环境或需要精确控制的场景。

📖 **完整文档**: [`../../docs/system-oauth-clients-admin-guide.md`](../../docs/system-oauth-clients-admin-guide.md)

**特点**:

- ✅ 完全可控，管理员明确每一步
- ✅ 灵活，可自定义配置
- ✅ 有完整审计日志
- ⚠️ 需要多个步骤

## 🚀 快速开始

### 自动初始化

```bash
# 1. 确保已运行数据库迁移
pnpm run db:migrate:deploy

# 2. 确保已创建 admin 用户
pnpm run db:seed:prod  # 首次部署时

# 3. 初始化系统客户端
pnpm run db:seed:system-clients
```

**输出示例**:

```
开始初始化系统级 OAuth 客户端...

✓ Quyan CLI (quyan-cli)
  - 类型: public
  - 状态: approved
  - 系统客户端: true

===========================================
系统级 OAuth 客户端初始化完成！
===========================================
```

### 验证

```bash
# 验证 CLI 可以登录
cd apps/cli-native
cargo run -- login --browser

# 预期: 浏览器打开授权页面，不显示"无效请求"
```

## 📚 相关文档

- **管理员手册**: [`../../docs/system-oauth-clients-admin-guide.md`](../../docs/system-oauth-clients-admin-guide.md)
  - 手动注册流程
  - API 示例
  - 配置参考
  - 故障排查

- **技术文档**: [`../../docs/system-oauth-clients.md`](../../docs/system-oauth-clients.md)
  - 架构设计
  - 保护机制
  - 权限控制

## 🔧 脚本说明

### `seed.ts`

**用途**: 自动创建和更新系统级 OAuth 客户端

**工作原理**:

1. 从 `src/constant/system-oauth-clients.ts` 读取配置
2. 使用 `upsert` 确保幂等性
3. 自动设置 `isSystemClient: true` 和 `reviewStatus: "approved"`

**何时使用**:

- ✅ 新环境快速搭建
- ✅ CI/CD 自动化流程
- ✅ 开发/测试环境
- ⚠️ 生产环境需谨慎（推荐手动注册）

**何时不用**:

- ❌ 需要自定义配置
- ❌ 需要完整审计日志
- ❌ 不确定配置是否正确

## ⚠️ 重要提示

### 生产环境建议

**推荐**: 使用手动注册方式

- 通过管理后台或 API 明确创建
- 记录操作人、时间、用途
- 有完整的审计日志

**可选**: 使用自动脚本

- 仅用于快速恢复或紧急修复
- 运行前务必了解脚本的具体操作
- 记录脚本执行时间和操作人

### 安全提示

1. **权限控制**: 仅超级管理员可执行
2. **配置审查**: 脚本修改需代码审查
3. **操作记录**: 生产环境操作需记录到文档
4. **定期审计**: 检查系统客户端使用情况

## 🔗 相关文件

- **常量定义**: `src/constant/system-oauth-clients.ts`
- **Service 保护**: `src/services/users/oauth-client.service.ts`
- **启动验证**: `src/services/users/oauth-client-bootstrap.service.ts`
- **Schema 定义**: `prisma/schema.prisma` (OAuthClient 模型)

## 📝 添加新的系统客户端

如需添加新的官方应用（如 Desktop、Mobile）：

1. **更新常量** (`src/constant/system-oauth-clients.ts`):

   ```typescript
   DESKTOP: {
     clientId: "quyan-desktop",
     name: "Quyan Desktop",
     description: "Official desktop application",
   }
   ```

2. **更新脚本** (`scripts/system-clients/seed.ts`):
   - 复制 CLI 客户端的 upsert 逻辑
   - 修改配置（clientId、redirectUris 等）

3. **更新验证** (`src/services/users/oauth-client-bootstrap.service.ts`):

   ```typescript
   const systemClientIds = ["quyan-cli", "quyan-desktop"];
   ```

4. **运行初始化**:

   ```bash
   pnpm run db:seed:system-clients
   ```

5. **更新文档**:
   - 在管理员手册中添加配置参考
   - 说明新客户端的用途和配置

## 🆘 故障排查

### 问题: 脚本运行失败 "Admin user not found"

**原因**: 数据库中没有 admin 用户

**解决**: 先运行生产种子

```bash
pnpm run db:seed:prod
```

### 问题: CLI 登录仍显示"无效请求"

**原因**: 客户端未创建或配置错误

**解决**:

1. 检查数据库:
   ```sql
   SELECT * FROM oauth_clients WHERE clientId = 'quyan-cli';
   ```
2. 确认 `reviewStatus = 'approved'`
3. 如缺失，重新运行脚本或手动创建

## 💡 最佳实践

1. **开发环境**: 自由使用自动脚本
2. **测试环境**: 优先使用自动脚本
3. **预生产环境**: 推荐手动注册
4. **生产环境**: 强烈推荐手动注册

---

**需要帮助？** 查看完整文档: [`system-oauth-clients-admin-guide.md`](../../docs/system-oauth-clients-admin-guide.md)
