# 设置

**设置**是侧边栏的一个顶级导航项，展开后包含四个子页面。点击设置旁边的箭头展开子菜单，然后跳转到所需页面。

## 子页面

### 个人资料

路径：**设置 → 个人资料**

管理显示名称、邮箱地址和用户名。

- 编辑显示名称。
- 通过发送到新邮箱的验证码修改邮箱。
- 查看用户名（只读）。

### 偏好设置

路径：**设置 → 偏好设置**

调整界面外观并清理本地缓存数据。

- 切换亮色或暗色主题。
- 切换界面语言。
- 清理 LocalStorage、SessionDB 或全部缓存数据。

### 账户安全

路径：**设置 → 账户安全**

管理凭证和认证方式。

- 修改密码（需要 `user:change_self_password` 权限）。
- 创建、复制和删除访问密钥。
- 注册和删除用于无密码登录的通行密钥（Passkey）。
- 启用或关闭双重验证（TOTP）。
- 管理可跳过重复 2FA 验证的受信任设备。

### 事件中心

路径：**设置 → 事件中心**

配置通知偏好、邮件推送和 Webhook。详见 `notification-settings`。

## 说明

- 修改邮箱和密码可能需要验证步骤或 2FA 挑战。
- 清理缓存可能会重置主题、语言等临时界面状态，并可能导致退出登录。
- 访问密钥、通行密钥和受信任设备在账户安全页的抽屉中进行管理，详见 `access-key-management`、`passkey-management`、`trusted-device-management`。

## 相关页面

- `access-key-management`
- `passkey-management`
- `trusted-device-management`
- `notification-settings`
- `auth-verification`
