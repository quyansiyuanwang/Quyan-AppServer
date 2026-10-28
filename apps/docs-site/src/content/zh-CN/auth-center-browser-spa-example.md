# 认证中心浏览器接入

浏览器应用无法保守客户端密钥。使用认证中心时，请将浏览器应用注册为公共客户端，并使用授权码和 PKCE（S256）。以下说明侧重接入边界；页面中的认证中心接口需要由具备平台登录态的授权界面调用。

## 开始前

1. 在[认证中心应用管理](/zh-CN/auth-center-client-management)中创建公共客户端，启用 `authorization_code`，登记准确的回调地址和所需 scope，并提交审核。
2. 确认部署提供的认证中心授权界面。`GET /v1/auth-center/authorize` 是需要已登录身份的授权预览 API，不是直接在浏览器地址栏打开的授权页面。内置的 OAuth 授权页面使用的是另一套 OAuth 接口。
3. 规划应用自己的后端和会话存储：认证中心令牌只交给可信后端处理，浏览器持有你自己应用的会话标识。

## 发起授权与处理回调

1. 每次授权生成不可预测的 `state` 和 PKCE verifier，并计算其 S256 challenge。将 `state` 与 verifier 保存在当前授权会话中，不要在多个用户或浏览器会话之间共用。
2. 通过部署提供的授权界面发起授权，提交应用 Client ID、已登记的回调地址、scope、`state` 和 PKCE challenge。用户登录并确认后，授权界面处理认证中心返回的回调地址。
3. 回调时在交换授权码**之前**核对返回的 `state` 与该会话中保存的值；缺失、不匹配或会话过期时停止流程并重新开始。每次授权只使用对应的 verifier，并在处理后清除临时数据。
4. 由可信后端调用 `POST /v1/auth-center/token`，提交授权码、Client ID、完全一致的回调地址和 `code_verifier`。公共客户端不提交客户端密钥。令牌响应应保存在服务端，不要返回或记录刷新令牌。
5. 后端按[令牌校验指南](/zh-CN/auth-center-node-sdk)校验签名、签发者、受众、有效期、令牌用途和所需 scope，再创建自己的应用会话。Cookie 应使用 `HttpOnly`、`Secure`、合适的 `SameSite` 策略，并配合服务端 CSRF 防护。

授权码只能使用一次；刷新令牌成功使用后会轮换。网络中断时不能假定服务端未处理请求；无法恢复新令牌时应重新授权。

## 常见问题

- **授权预览返回 401 或 403**：确认授权界面具备有效的平台登录态和访问权限，且应用已通过审核。
- **回调被拒绝**：检查回调地址与登记值是否完全一致，以及当前会话中的 `state` 是否仍然有效。
- **令牌交换失败**：确认 PKCE verifier 与发起授权时的 challenge 对应，授权码未被使用或过期。
- **校验令牌失败**：确认使用本部署的 JWKS、配置的 issuer、当前 Client ID 和正确的 scope；不要仅凭解析 JWT 的内容判断授权通过。

## 相关文档

- [认证中心应用接入](/zh-CN/auth-center-app-management)
- [认证中心 Node SDK](/zh-CN/auth-center-node-sdk)
- [认证中心 Python SDK](/zh-CN/auth-center-python-sdk)
