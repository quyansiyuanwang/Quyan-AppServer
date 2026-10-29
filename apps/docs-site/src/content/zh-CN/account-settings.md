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
- 按项清理浏览器中的 LocalStorage 和 SessionDB 数据。

#### 清理本地缓存

1. 在偏好设置中选择 **清理缓存**，查看当前可清理的项目及其大小。
2. 勾选需要清理的项目或项目组，选择 **清理所选**。至少需要选择一项。
3. 清理认证令牌等登录数据会提示退出登录并重新加载页面；清理主题、语言或用户信息缓存等项目也会重新加载页面。请在操作前保存尚未提交的内容。

此操作针对当前浏览器中所选的本地数据，不会删除服务器上的账户数据。未列出的浏览器数据不在此页面的清理范围内。

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

配置通知偏好、邮件推送和 Webhook。详见 [通知设置]({{DOCS_BASE_URL}}/zh-CN/notification-settings)。

## 说明

- 修改邮箱和密码可能需要验证步骤或 2FA 挑战。
- 清理主题、语言等缓存可能重置相应的本地偏好；清理认证令牌后需要重新登录。
- 访问密钥、通行密钥和受信任设备在账户安全页的抽屉中进行管理，详见 [访问密钥管理]({{DOCS_BASE_URL}}/zh-CN/access-key-management)、[通行密钥管理]({{DOCS_BASE_URL}}/zh-CN/passkey-management)、[受信任设备管理]({{DOCS_BASE_URL}}/zh-CN/trusted-device-management)。

## 个人资料权限和资源范围

启用 IAM 强制授权后，读取当前资料使用 `quyan:user:GetCurrentUser`，资源为 `acs:quyan:*:<accountId>:user/<userId>`。已认证身份默认只能读取本人资料，匹配的显式 Deny 仍会阻止读取；这个能力不允许查询其他用户或管理账号。

修改显示名称需要独立的 `quyan:user:UpdateProfile` 权限，不会因为能读取资料就自动获得。策略可限制到当前用户：

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Allow",
    "Action": "quyan:user:UpdateProfile",
    "Resource": "acs:quyan:*:<accountId>:user/<userId>"
  }
}
```

请替换为实际账号和当前用户 ID。修改显示名称不允许修改邮箱、密码、账户状态或所属用户组，即使使用通配符授权也不能通过个人资料接口修改其他用户。

资料在请求过程中变化时，读取或修改可能返回冲突；刷新后再确认修改，系统不会自动覆盖并发变更。账户或角色会话失效后操作会被拒绝。第三方 OAuth 应用还需要 `profile` scope（兼容对应历史权限 scope）；这个 scope 不能代替修改资料的 IAM 权限。

## 邮箱权限与资源范围

启用 IAM 强制授权后，发送邮箱变更验证码需要 `quyan:user:SendEmailChangeCode`，提交验证码完成修改需要 `quyan:user:ChangeEmail`。两个操作均使用当前用户的 `acs:quyan:*:<accountId>:user/<userId>` 资源，权限相互独立：可以发送验证码不代表可以修改邮箱。修改姓名或读取资料也不会自动获得邮箱操作权限。

策略可以对当前用户 ARN 授予这两个 Action。匹配的显式 Deny 优先于 Allow，即使授予通配符权限，也不能通过个人接口修改其他用户的邮箱。已有验证码、双因素、人机验证、重放保护、邮箱唯一性和每日一次限制仍然生效。第三方 OAuth 应用还必须具备 `email` scope，仅有 `profile` scope 不足以操作邮箱。

发送验证码或提交邮箱写入前会再次复核授权和用户状态。操作期间账户、授权、角色会话或 OAuth 凭证状态发生变化时，请求可能被拒绝或返回冲突；请刷新会话后重新确认。`legacy` 与 `shadow` 保留原有效邮箱权限，`shadow` 同时记录 IAM 决策。

## 相关页面

- [访问密钥管理]({{DOCS_BASE_URL}}/zh-CN/access-key-management)
- [通行密钥管理]({{DOCS_BASE_URL}}/zh-CN/passkey-management)
- [受信任设备管理]({{DOCS_BASE_URL}}/zh-CN/trusted-device-management)
- [通知设置]({{DOCS_BASE_URL}}/zh-CN/notification-settings)
- [验证页面]({{DOCS_BASE_URL}}/zh-CN/auth-verification)
