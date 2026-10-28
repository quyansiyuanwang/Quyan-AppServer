# 认证中心应用管理

此页面用于维护站内“认证中心应用”后台资料。它面向平台管理员或应用所有者，重点是创建、编辑、提交审核、轮换密钥和删除应用。

## 页面定位说明

这一页和 `auth-center-app-management` 不是同一类文档：

- [`auth-center-client-management`](/zh-CN/auth-center-client-management)：后台操作手册，说明站内管理页面怎么用。
- [`auth-center-app-management`](/zh-CN/auth-center-app-management)：外部接入说明，面向第三方系统开发者。

如果你当前是在管理后台里维护应用资料，请看本页；如果你是在给第三方系统做接入，请看 `auth-center-app-management`。

## 页面用途

- 创建认证中心应用。
- 配置客户端类型、授权类型、回调地址和作用域。
- 调整访问令牌与刷新令牌有效期。
- 查看审核状态和审核意见。
- 提交审核、轮换客户端密钥、删除应用。

## 你会看到什么

### 顶部参考区

页面顶部有一张授权类型参考表，帮助你快速理解：

- `authorization_code` 适合用户登录或用户授权。
- `refresh_token` 适合在访问令牌过期后续期。
- `client_credentials` 适合服务到服务调用。

这部分更像“选型说明”，方便你在填写表单前先确认应用职责。

### 应用列表

桌面端和移动端都会展示应用清单，常见字段包括：

- 应用名称
- 审核状态与审核意见
- `clientId`
- `clientType`
- `grantTypes`
- 访问令牌 / 刷新令牌有效期
- 回调地址摘要
- 密钥预览
- 是否要求 PKCE
- 最近使用时间

### 常用操作

每条应用通常可以执行以下动作：

- 编辑
- 提交审核
- 轮换密钥
- 删除

其中“提交审核”只会在 `draft` 或 `rejected` 状态下出现；“轮换密钥”只会在存在客户端密钥时出现。

### 创建 / 编辑弹窗

表单分为几个区域：

- 基本信息
- 授权类型
- 回调地址
- 令牌设置
- 作用域
- 接入元数据

这意味着即使是同一个应用，也需要同时满足“业务用途、授权方式、安全要求、回调地址”几类配置。

## 关键字段与规则

### `clientType`

你会在 `confidential` 和 `public` 之间选择：

- `confidential`：适合有可信后端、能安全保存密钥的系统。
- `public`：适合 SPA、移动端、桌面端、浏览器插件等无法安全保存密钥的场景。

如果应用运行在用户设备上，就不应该把它当作可安全保存密钥的客户端。

### `grantTypes`

当前页面围绕以下几类授权类型展开：

- `authorization_code`
- `refresh_token`
- `client_credentials`

使用时要特别注意这些约束：

- `refresh_token` 必须和 `authorization_code` 一起使用，不能单独存在。
- `public` 客户端不能启用 `client_credentials`。
- 当 `public` 客户端启用了 `authorization_code`，PKCE 会被强制开启。
- 如果启用了 `authorization_code`，至少要配置一个回调地址。

### `redirectUris`

回调地址是用户授权类流程最容易出错的配置项之一。

- 它主要服务于 `authorization_code`。
- 建议把开发、测试、生产环境分开登记。
- 应精确填写协议、域名、端口、路径和尾部斜杠。
- 旧地址停用后应及时删除。

### `scopes`

当前后台页会展示可勾选的作用域，例如 `profile`。它描述的是：

- 应用拿到访问令牌后，准备申请哪些能力。
- 后续接入方在授权阶段允许请求哪些范围。

勾选范围时仍然建议遵循最小授权原则。

### `isPkceRequired`

这个开关表示授权码流程是否必须使用 PKCE。

- 对 `public + authorization_code` 场景，系统会锁定为启用状态。
- 对可安全保管密钥的场景，可以根据接入策略决定是否强制要求。

如果你不确定，通常宁可更严格一些，也不要放宽。

### `accessTokenLifetime` 和 `refreshTokenLifetime`

这两项分别控制：

- `accessTokenLifetime`：JWT 访问令牌可以在接入方本地校验多久。
- `refreshTokenLifetime`：应用可以带着刷新令牌回到认证中心续期多久。

页面当前要求：

- `refreshTokenLifetime` 不能小于 `accessTokenLifetime`。

一般来说，访问令牌应更短，刷新令牌应更长。

## 审核状态怎么理解

认证中心应用通常会经历以下流转：

- `draft`：草稿，尚未提交审核。
- `pending`：已提交，等待审核。
- `approved`：已通过审核，可以进入正式接入。
- `rejected`：被拒绝，需要根据意见修改后再次提交。

使用时要注意：

- `draft` 和 `rejected` 状态下通常可以再次编辑并提交审核。
- 一旦再次编辑已通过或已拒绝的应用，系统通常会把它重新视为待确认资料，并回到草稿语义。
- 审核意见会直接影响应用所有者后续的整改动作。

## 敏感操作说明

### 提交审核

提交审核表示你认为当前资料已经可以进入平台审核流程。提交前建议再核对：

- `clientType` 是否选对
- `grantTypes` 是否最小化
- `redirectUris` 是否完整且精确
- 令牌有效期是否符合风险要求

### 轮换密钥

轮换密钥属于高敏感操作。

- 轮换后，旧密钥不应再继续使用。
- 新密钥通常只会完整展示一次。
- 如果你怀疑密钥已泄露，不应尝试“找回旧值”，而应立即轮换。

### 删除应用

删除通常适用于：

- 接入方案废弃
- 资料创建错误
- 应用不再需要保留

如果该应用已经被外部系统使用，删除前应先确认停用计划，避免影响现网集成。

## 常见操作

1. 先阅读顶部授权类型参考表，确认应用要走哪种集成模式。
2. 创建应用并填写基本信息、授权类型、回调地址和作用域。
3. 根据客户端类型和风险等级设置 PKCE 与令牌有效期。
4. 保存后再次核对列表中的状态、回调地址和密钥预览。
5. 资料确认无误后提交审核。
6. 如需要更换密钥，再执行轮换并立即保存新值。

## 权限要求

本页通常涉及以下权限：

- `auth_center:client:read`
- `auth_center:client:create`
- `auth_center:client:update`
- `auth_center:client:delete`

提交审核本身依赖应用维护流程；真正的审核通过 / 拒绝动作不在本页完成，而是在 `auth-center-client-review-management` 中由审核角色处理。

## 说明

- `client_credentials` 不会返回刷新令牌。
- `public` 客户端不应启用 `client_credentials`。
- 使用 `authorization_code` 时，回调地址和 PKCE 要求都应严格核对。
- 若应用资料被审核拒绝，优先根据审核意见整改，而不是盲目重复提交。

## 相关页面

- [`auth-center-app-management`](/zh-CN/auth-center-app-management)
- [`auth-center-client-review-management`](/zh-CN/auth-center-client-review-management)
- [`oauth-app-management`](/zh-CN/oauth-app-management)
- [`api-documentation`](/zh-CN/api-documentation)

## IAM 资源范围

在启用 IAM 强制授权的环境中，应用列表只展示你有 `quyan:auth_center:ListClients` 权限的自有应用；打开应用详情还需要 `quyan:auth_center:GetClient`。列表权限不自动授予详情权限。

应用资源 ARN 为 `acs:auth-center:*:<accountId>:client/<userId>/<clientId>`。其中 `clientId` 是应用记录 ID，而不是登录接入用的公开客户端标识。账号和用户标识由登录身份确定，策略不能让你读取其他用户或其他账号的应用。可将自有应用加入资源组，以资源组范围授权。

没有匹配的 Allow 或存在匹配的 Deny 时，应用不会出现在列表中；详情请求会被拒绝。列表和详情只返回密钥预览及是否配置密钥，不返回原始密钥或其 hash。创建、轮换密钥、审核等操作仍需各自的权限，并保留原有的二次验证要求。

在 IAM 强制授权模式下，提交审核、轮换密钥和删除分别需要 `quyan:auth_center:SubmitClientReview`、`quyan:auth_center:RotateClientSecret` 和 `quyan:auth_center:DeleteClient`，目标均为上述应用 ARN。读取权限不会自动授予这些操作。轮换成功只在该次响应中返回新密钥，请立即安全保存；后续列表和详情仍只显示预览。操作期间若授权被撤销或应用版本改变，写入会被拒绝或回滚。

编辑应用需要 `quyan:auth_center:UpdateClient` 对应应用资源权限。修改 scopes 时还会检查当前身份能否授予该 scope；使用角色会话时，以角色权限为准。编辑不能直接批准审核或写入客户端密钥。修改已批准或已拒绝应用的配置会将审核状态重置为草稿；切换为公开客户端时会清除原有密钥，并继续执行 PKCE 与授权类型校验。

使用 OAuth bearer token 调用应用管理接口时，需要可授予的 `auth_center_client` scope（或等价的认证中心应用读取权限 scope）。该 scope 用于进入管理接口，不能代替 IAM 策略授权；应用的读取、编辑、删除、审核提交和密钥轮换仍分别检查操作权限与资源范围。角色会话不能借用登录用户在角色之外的权限来授予 scope。

创建应用需要 `quyan:auth_center:CreateClient` 对登录用户父资源 `acs:quyan:*:<accountId>:user/<userId>` 的权限；已有应用的读取或编辑权限不能代替创建权限。新应用由服务端生成记录 ID 和公开客户端标识，初始审核状态为草稿；保密客户端的新密钥只在创建成功的响应中返回。创建权限不会自动授予后续读取、编辑或删除权限，仍需按应用 ARN 配置。
