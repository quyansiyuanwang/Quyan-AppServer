# 认证中心审核

此页面用于审核已提交的认证中心应用。它属于审核端页面，主要帮助审核角色确认应用资料是否可以让第三方系统把本平台作为统一认证中心来接入。

## 页面用途

- 查看待审核或历史审核的认证中心应用。
- 按关键字和审核状态筛选目标记录。
- 检查 `clientType`、`grantTypes`、回调地址和令牌有效期等关键资料。
- 对 `pending` 应用执行通过或拒绝。
- 在必要时删除无效或不应保留的应用记录。

## 你会看到什么

### 筛选区

常见筛选项包括：

- 关键字
- 审核状态

这让审核人员可以按应用名称、所有者或其他可搜索资料快速定位目标。

### 审核列表

表格通常会显示：

- 应用名称
- 审核状态
- 所有者用户名
- `clientId`
- `clientType`
- `grantTypes`
- 回调地址摘要
- 提交时间
- 审核时间

和普通 OAuth 审核相比，这里会更强调“客户端类型、授权类型、PKCE 和令牌模型是否合理”。

### 操作区

常见动作包括：

- 删除
- 审核通过
- 审核拒绝

同样地，只有 `pending` 才能执行通过或拒绝。

## 审核状态怎么理解

认证中心应用通常经历以下状态：

- `draft`
- `pending`
- `approved`
- `rejected`

当前审核页里应理解为：

- `pending`：等待审核，可以处理。
- `approved`：已允许作为认证中心接入使用。
- `rejected`：需要应用所有者根据意见整改。

`draft`、`approved`、`rejected` 不应被再次直接审批。

## 审核时建议重点核对什么

### `clientType` 是否符合实际架构

先判断应用到底是：

- 能安全保存密钥的 `confidential`
- 还是运行在用户设备上的 `public`

如果类型选错，后面的密钥、PKCE 和授权模式都可能一起失真。

### `grantTypes` 是否合理

建议重点确认：

- 是否真的需要 `authorization_code`
- 是否错误勾选了 `refresh_token` 却没有 `authorization_code`
- 是否把 `client_credentials` 用在了 `public` 客户端上

授权类型过多会扩大安全面，过少又可能无法支撑业务。

### `redirectUris` 是否可信

对于启用了 `authorization_code` 的应用，回调地址仍然是审核重点：

- 是否为受控地址
- 是否把多环境区分清楚
- 是否存在明显测试、临时或不应对外开放的地址

### 令牌生命周期是否合理

建议同时看：

- 访问令牌是否过长
- 刷新令牌是否短于访问令牌
- 是否与业务风险、接入模式匹配

如果令牌过长，第三方系统一旦泄露凭据，影响窗口也会更长。

### PKCE 要求是否匹配

对于 `public + authorization_code` 的场景，PKCE 应当被严格要求。

如果应用本身不适合保管密钥，却又放宽 PKCE，要额外谨慎。

## 审核弹窗会做什么

点击“通过”或“拒绝”后，会进入审核弹窗，用来：

- 确认审核决策
- 填写审核意见

审核意见建议明确指出整改点，例如：

- 回调地址缺少生产环境
- `public` 客户端不应启用 `client_credentials`
- 访问令牌有效期过长

这能帮助应用所有者更快修正资料。

## 删除动作怎么理解

审核端删除一般适用于：

- 明显错误的创建记录
- 重复或测试数据
- 不应继续保留的无效应用

如果应用仍有整改价值，优先拒绝并给出意见，通常比直接删除更利于协作。

## 常见操作

1. 用关键字或状态筛出目标应用。
2. 检查 `clientType`、`grantTypes`、回调地址和令牌有效期。
3. 对 `pending` 应用打开审核弹窗。
4. 写清审核意见后选择通过或拒绝。
5. 对明显无效记录再考虑删除。

## 权限要求

本页通常涉及以下权限：

- `auth_center:client:review:read`
- `auth_center:client:review:update`

其中读取权限负责进入审核页并查看列表，更新权限负责实际执行通过或拒绝。

## 说明

- 本页是认证中心应用的审核端，不替代应用所有者使用的 `auth-center-client-management`。
- 审核重点不仅是资料齐不齐，更包括令牌模型、客户端类型、PKCE 与授权类型是否彼此匹配。
- 审核意见应尽量具体，方便后续整改和复核。

## 相关页面

- [`auth-center-client-management`](/zh-CN/auth-center-client-management)
- [`auth-center-app-management`](/zh-CN/auth-center-app-management)
- [`oauth-app-review-management`](/zh-CN/oauth-app-review-management)
- [`business-logs`](/zh-CN/business-logs)
