# SDK 与示例

根据接入方式选择示例。开始前，请确认当前部署的 API 地址、认证方式和所需权限。

## 服务端调用 API

- [Node SDK](/zh-CN/node-sdk)：使用 Node.js 调用 API，并处理响应和错误。
- [Python SDK](/zh-CN/python-sdk)：使用 Python 调用 API，并处理响应和错误。
- [API 文档](/zh-CN/api-documentation)：了解 API 地址、认证方式、请求格式和错误处理；具体字段以 API 参考为准。

Node 和 Python 页面提供基于 HTTP 客户端的代码示例和可自行维护的封装，不需要安装平台专用 SDK 包。令牌应保存在服务端环境变量或其他安全存储中，不要提交到版本库。

## 第三方授权

1. 在 [OAuth 应用管理](/zh-CN/oauth-app-management)中创建应用、登记回调地址并提交审核。
2. 阅读 [OAuth 授权码示例](/zh-CN/oauth-demo)，使用 PKCE 发起授权并安全处理回调。
3. 按需使用获得授权的令牌调用 API；OAuth scope 与账户及资源权限都可能影响访问结果。

## 认证中心接入

如果第三方系统需要使用本平台作为认证中心，请阅读[认证中心应用接入](/zh-CN/auth-center-app-management)，然后选择适合的示例：

- [认证中心 Node SDK](/zh-CN/auth-center-node-sdk)
- [认证中心 Python SDK](/zh-CN/auth-center-python-sdk)
- [浏览器单页应用示例](/zh-CN/auth-center-browser-spa-example)

认证中心接入与 OAuth 应用接入的令牌和校验流程不同，请按照对应指南配置。
