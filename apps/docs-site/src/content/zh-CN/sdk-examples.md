# SDK 与示例

这个入口页用于帮助接入方快速选择最合适的模板，而不是把所有内容堆在同一页里。

## 如何选择

### `Quyan-ServerSDK` 目录

适合：

- 希望直接拿到可运行示例工程的接入方
- 需要按接入方式快速选择 SDK 或 Demo 的团队
- 想先跑通流程、再回头精简到最小代码的场景

你会看到：

- 按场景整理的 SDK 或 Demo
- 比文档页代码片段更完整的工程化样例
- 可作为二次开发起点的集成模板
- 当前 OAuth 路径示例：`ServerSDK/demos/oauth/node/`、`ServerSDK/sdks/oauth/node/`、`ServerSDK/sdks/oauth/python/`、`ServerSDK/sdks/oauth/java/`、`ServerSDK/sdks/oauth/go/`

### `Node SDK`

适合：

- Node.js 服务端
- TypeScript / JavaScript API 集成
- 需要快速接入业务 API 的后端项目

你会看到：

- 直接调用 API 的最小 Node 示例
- Node 环境变量建议
- 服务端调用注意事项

### `Python SDK`

适合：

- Python 后端
- 脚本工具
- 内部自动化服务

你会看到：

- 直接调用 API 的最小 Python 示例
- `requests` 调用模板
- Python 集成时的超时与错误处理建议

### `OAuth Demo`

适合：

- 第三方登录
- OAuth 账号绑定
- 需要完整授权码流程示例的项目

你会看到：

- OAuth 时序图
- OAuth 流程图
- Node 最小 OAuth Demo
- Python 最小 OAuth Demo

### `认证中心应用管理`

适合：

- 希望把本平台作为统一认证中心对外开放的团队
- 采用 JWT + JWKS 校验设计的系统
- 需要双令牌访问 / 刷新机制的接入方
- 需要应用注册与审核流程说明的场景

你会看到：

- 认证中心与 OAuth 的区别
- 短 token 与长 token 的行为说明
- `client_credentials` 不返回刷新令牌的规则
- 应用注册、审核与密钥轮换说明

### `认证中心 Node SDK`

适合：

- 需要在 Node.js 后端本地校验 JWT 的系统
- 在可信服务端完成授权码交换与刷新逻辑的场景
- 使用 `client_credentials` 的机器到机器集成

### `认证中心 Python SDK`

适合：

- 需要在 Python 服务端本地校验 JWT 的系统
- 自动化任务与后端集成
- 在服务端完成刷新令牌交换的场景

### `认证中心 Browser / SPA 示例`

适合：

- 浏览器优先应用
- 使用 PKCE 的公共客户端
- 需要明确刷新令牌应存放在何处的团队

你会看到：

- PKCE 工具代码
- 回调处理示例
- 后端交换建议
- 浏览器安全边界说明

## 推荐阅读顺序

0. 如果你更偏向“先运行一个完整工程”，先查看 `Quyan-ServerSDK` 目录结构，再按场景选择对应 SDK 或 Demo。
1. 先看 `OAuth App Management`，完成应用创建与回调地址登记。
2. 再看 `OAuth Demo`，跑通授权码流程。
3. 如果你只是调业务接口，则直接看 `Node SDK` 或 `Python SDK`。
4. 最后回到 `API Documentation` 和 Swagger 查具体字段与接口约束。
5. 如果你要接入认证中心模式，先看 `认证中心应用管理`，再按语言栈选择 Node、Python 或 Browser 示例。

## 最小接入清单

1. 确认环境地址与 Swagger 文档地址。
2. 选定认证方式：JWT、Access Key 或 OAuth。
3. 先用 `curl` 验证接口可达。
4. 再选择对应语言模板落地。
5. 若是第三方登录，先创建 OAuth 应用并登记回调地址。
6. 若是认证中心接入，先确认应用应注册为 `public` 还是 `confidential`，再实现基于 JWKS 的 JWT 校验。

## 推荐联动阅读

- `Quyan-ServerSDK`
- `Node SDK`
- `Python SDK`
- `OAuth Demo`
- `API Documentation`
- `OAuth App Management`
- `认证中心应用管理`
- `认证中心 Node SDK`
- `认证中心 Python SDK`
- `认证中心 Browser / SPA 示例`
