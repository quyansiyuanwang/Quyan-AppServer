# SDK 与示例

根据要完成的任务选择示例。开始前确认当前部署的地址、凭证类型和权限，避免把平台业务 API、AI 中转与认证中心的令牌混用。

## 选择接入路径

| 你要完成的任务                               | 从哪里开始                      | 需要准备什么                                              |
| -------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| 服务端读取平台用户资料或余额流水             | 下方 Node.js 或 Python API 示例 | 后端 API 地址、已授权访问凭证及目标资源权限               |
| 让用户授权第三方访问平台 API                 | OAuth 授权码示例                | 应用注册、通过审核、准确的回调地址和最小 scope            |
| 让自己的系统使用平台认证，并校验认证中心令牌 | 认证中心应用接入                | 独立的认证中心应用及其对应流程配置                        |
| 在浏览器单页应用中使用认证中心               | 浏览器单页应用示例              | public 客户端、已登记回调地址及 PKCE                      |
| 调用 AI 模型                                 | AI 中转快速开始                 | Relay Base URL、Relay Token、可用模型与格式，以及相应额度 |

## 服务端调用 API

- [Node.js API 调用示例]({{DOCS_BASE_URL}}/zh-CN/node-sdk)：创建示例文件、配置凭证，使用 `fetch` 处理 HTTP 与业务错误、超时和请求 ID。
- [Python API 调用示例]({{DOCS_BASE_URL}}/zh-CN/python-sdk)：安装依赖、配置凭证，使用 `requests` 处理响应，并区分连接、读取超时。
- [API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)：复制端点、比较价格、选择认证方式；具体字段以 API 参考为准。

两页提供可复制并自行维护的 HTTP 封装，无需安装平台专用 SDK 包。它们从已有访问凭证开始，不会自动登录、刷新或重试。先验证资料请求成功，再按授权启用余额流水请求；不要用需要管理员权限的写操作测试连通性。

## 第三方授权

1. 在 [OAuth 应用管理]({{DOCS_BASE_URL}}/zh-CN/oauth-app-management)中创建应用、登记回调地址并提交审核，通过后再接入。
2. 阅读 [OAuth 授权码示例]({{DOCS_BASE_URL}}/zh-CN/oauth-demo)，使用 PKCE 发起授权并安全处理回调。
3. 按需使用获得授权的令牌调用 API；OAuth scope 与账户及资源权限都可能影响访问结果。

## 认证中心接入

如果自己的系统需要使用本平台作为认证中心，请先阅读[认证中心应用接入]({{DOCS_BASE_URL}}/zh-CN/auth-center-app-management)。创建及维护应用使用[认证中心应用管理]({{DOCS_BASE_URL}}/zh-CN/auth-center-client-management)，然后选择示例：

- [认证中心 Node SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-node-sdk)
- [认证中心 Python SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-python-sdk)
- [浏览器单页应用示例]({{DOCS_BASE_URL}}/zh-CN/auth-center-browser-spa-example)

认证中心与 OAuth 应用独立注册，令牌签发和校验流程不同。不要把认证中心 JWT 直接当作平台业务 API 的登录访问令牌，也不要把客户端密钥放进浏览器。公共客户端按公共客户端流程使用 PKCE。

## AI 中转接入

按照 [AI 中转快速开始]({{DOCS_BASE_URL}}/zh-CN/ai-relay-quickstart)创建 Relay Token 并配置模型客户端。平台业务 API 的通用 `{ code, message, data }` 解包器不适用于中转协议或事件流。

发起模型请求可能产生费用。调用前核对模型、请求格式和额度，调用后在[消费记录]({{DOCS_BASE_URL}}/zh-CN/consumption-records)核对结果。

## 验证接入结果

- 核对请求确实发往当前部署的正确服务，而非前端或文档站。
- 同时验证 HTTP 状态、响应格式及对应协议的成功条件；能打开页面不代表 API 已授权。
- 为错误保留必要的请求 ID、状态和业务码；凭证、刷新令牌、客户端密钥和完整个人资料不进入公开日志或版本库。
- 按认证流程处理过期和撤销，不对权限拒绝无限重试；写操作断线后先核对结果，防止重复提交。
