# 认证中心应用接入

此页面用于注册把本平台当作统一认证中心使用的外部应用。

## 接入快速开始

1. 根据场景选择授权类型。
2. 配置与实际使用一致的 Redirect URI，并为授权码流程启用 PKCE。
3. 选择最小 Scope。
4. 创建应用并提交审核。
5. 按授权端点、令牌端点、发现端点或 SDK 文档完成接入。

认证中心管理页面顶部提供同样的清单；Scope 目录不可用时不能提交配置。

## 应用管理与审核

要创建或维护应用，请参阅[认证中心应用管理](/zh-CN/auth-center-client-management)。审核人员可参阅[认证中心应用审核](/zh-CN/auth-center-client-review-management)。

## 这项能力是什么

这套 Auth Center 能力**独立于现有 OAuth 2.0 功能**，不是替换 OAuth，而是新增一套面向第三方系统的认证中心方案。

它适合需要以下能力的接入方：

- 使用**短期 JWT 访问令牌**，并在自己的系统内本地校验
- 使用**长期刷新令牌**，在访问令牌过期后回到认证中心刷新
- 使用**非对称签名**，由下游系统通过 **JWKS / 公钥**验证访问令牌
- 按应用配置**访问令牌有效期**和**刷新令牌有效期**
- 同时支持**用户登录 / 用户授权**与**应用到应用**场景

也就是说：接入方自己验证短 token；短 token 过期后，再带着长 token 回到认证中心刷新新的短 token。

## 核心令牌模型

### 访问令牌（Access Token）

- 短期有效
- JWT 格式
- 由平台私钥签名
- 由接入方通过 JWKS / 公钥本地验证
- 适合接入应用自行完成签名校验和声明校验

### 刷新令牌（Refresh Token）

- 生命周期长于访问令牌
- 对接入方来说是不可本地校验的刷新凭据
- 必须回到认证中心换取新的访问令牌
- 不应该由第三方应用自行验证

### `client_credentials` 的重要规则

当应用启用 `client_credentials` 时：

- 认证中心**只返回访问令牌**
- **不会签发刷新令牌**

这样可以让机器间调用保持简单，也避免无意义的长生命周期凭据。

## 页面用途

你可以在这个页面中：

- 创建认证中心应用
- 选择 `confidential` 或 `public` 客户端类型
- 选择可用授权类型
- 为用户流程配置回调地址
- 配置访问令牌与刷新令牌有效期
- 轮换客户端密钥
- 提交审核
- 查看审核状态与审核意见

## 支持的授权类型

### `authorization_code`

适用于：

- 用户登录
- 用户授权确认
- 浏览器、移动端、或带后端的登录场景

行为：

- 返回短期 JWT 访问令牌
- 按应用配置可同时返回刷新令牌
- 至少需要一个已登记回调地址
- 公共客户端必须启用 PKCE；授权请求需提供 `code_challenge`，换取令牌时需提供对应的 `code_verifier`

### `refresh_token`

适用于：

- 在访问令牌过期后刷新新的短期访问令牌

行为：

- 只能与 `authorization_code` 一起使用
- 必须由认证中心验证刷新令牌是否合法
- 返回新的访问令牌，并可能按服务端策略轮换刷新状态

### `client_credentials`

适用于：

- 服务到服务调用
- 内部系统对接
- 定时任务
- 后台工作进程

行为：

- 认证的是应用自身
- 不代表具体终端用户
- 只返回短期 JWT 访问令牌
- **不会**签发刷新令牌
- 不能用于公共客户端

## 客户端类型建议

### 机密客户端（Confidential）

当接入系统有可信后端，并且可以安全保存密钥时，使用机密客户端。

典型示例：

- SaaS 后端
- 内部网关
- 服务型 API
- 批处理任务平台

### 公共客户端（Public）

当代码运行在用户设备上，无法安全保存密钥时，使用公共客户端。

典型示例：

- SPA
- 移动端 App
- 桌面客户端
- 浏览器扩展

使用 `authorization_code` 的公共客户端必须启用 PKCE。授权请求提供 `code_challenge`，换取令牌时提供对应的 `code_verifier`。

## JWT + JWKS 校验模型

推荐的职责分工是：

1. 认证中心签发 JWT 访问令牌。
2. 接入应用读取 JWKS 文档。
3. 根据 `kid` 选择对应公钥。
4. 在接入方本地校验 JWT 的签名、发行者、受众、过期时间与声明。
5. 访问令牌过期后，接入方再带刷新令牌回到认证中心换取新的访问令牌。

这样可以同时获得：

- 统一签发
- 分布式本地校验短 token
- 集中控制刷新与撤销

## 典型流程

### 1. 用户登录 / 用户授权流程

```text
用户 -> 部署提供的授权界面 -> Auth Center 授权预览 API
用户登录并确认授权，授权界面提交授权决定
Auth Center 返回包含 code 的回调地址，授权界面跳转
接入应用 -> POST /v1/auth-center/token (authorization_code)
Auth Center -> access_token（以及按配置可返回 refresh_token）
接入应用通过 JWKS / 公钥本地验证 access_token
```

适合外部系统需要建立用户身份会话的场景。

### 2. 刷新流程

```text
接入应用 -> POST /v1/auth-center/token (refresh_token)
Auth Center 校验 refresh token
Auth Center -> 新的 access_token 和轮换后的 refresh_token
接入应用继续本地校验新的 access_token
```

适合外部系统的用户会话需要长于访问令牌生命周期的场景。

### 3. 应用到应用流程

```text
服务 A -> POST /v1/auth-center/token (client_credentials)
Auth Center -> 仅返回 access_token
服务 A -> 服务 B / 受保护接口
服务 B 通过 JWKS / 公钥验证 JWT
```

适合没有最终用户参与的机器调用场景。

## 管理页主要字段

### 应用名称与说明

建议填写明确的业务名称，方便审核人员、运维人员和接入团队快速识别用途。

### 回调地址

`authorization_code` 必填。

建议：

- 开发、测试、生产环境分别登记
- 精确填写完整回调地址
- 下线后及时删除无用地址

### 授权类型

只选择真正需要的能力：

- 只做用户登录：`authorization_code`，通常配合 `refresh_token`
- 只做服务调用：`client_credentials`
- 同时支持多种场景：按应用职责谨慎组合

### 访问令牌有效期

决定 JWT 在接入方本地校验后可被接受多长时间。

值越短，安全性通常越高；值越长，刷新频率越低。

### 刷新令牌有效期

决定接入方在访问令牌过期后，可以在多长时间内回到认证中心刷新。

通常应当长于访问令牌有效期。

### 客户端密钥

只有机密客户端应依赖客户端密钥。

若怀疑泄露，应立即轮换。

## 审核与发布

认证中心应用通常会经历以下状态：

- `draft`
- `pending`
- `approved`
- `rejected`

典型流程：

1. 创建应用
2. 配置回调地址、授权类型和令牌有效期
3. 提交审核
4. 审核通过
5. 如有密钥，立即复制保存
6. 外部系统完成正式接入

## 发现文档与关键端点

接入方常用端点包括：

- `GET /v1/auth-center/.well-known/openid-configuration`
- `GET /v1/auth-center/.well-known/jwks.json`
- `GET /v1/auth-center/authorize`
- `POST /v1/auth-center/authorize`
- `POST /v1/auth-center/token`
- `POST /v1/auth-center/revoke`

授权预览和授权决定接口需要已登录的平台身份，分别返回预览数据和包含回调地址的结果；它们不是可直接打开的授权页面。内置 OAuth 授权页面使用另一套 OAuth 接口。JWKS 与发现接口的响应采用 `{ code, message, data }` 包装；签发者以部署配置为准。

本地 JWT 校验无法实时感知已经签发的访问令牌被撤销；请结合访问令牌有效期与实际接入方的授权策略。

## 最小接入清单

1. 创建认证中心应用。
2. 选择正确的客户端类型。
3. 只启用必须的授权类型。
4. 根据风险等级设置合理的令牌有效期。
5. 若是机密客户端，复制并安全保存客户端密钥。
6. 在接入系统中实现基于 JWKS 的 JWT 校验。
7. 刷新令牌只能回到认证中心使用。
8. 不要期望 `client_credentials` 返回刷新令牌。

## 推荐继续阅读

- [认证中心应用管理](/zh-CN/auth-center-client-management)
- [Node.js SDK](/zh-CN/auth-center-node-sdk)
- [Python SDK](/zh-CN/auth-center-python-sdk)
- [浏览器单页应用示例](/zh-CN/auth-center-browser-spa-example)
- [API 文档](/zh-CN/api-documentation)
