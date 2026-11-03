# 认证中心浏览器接入

浏览器应用无法保守客户端密钥。使用认证中心时，请将浏览器应用注册为公共客户端，并使用授权码和 PKCE（S256）。以下说明侧重接入边界；页面中的认证中心接口需要由具备平台登录态的授权界面调用。

## 开始前

1. 在[认证中心应用管理]({{DOCS_BASE_URL}}/zh-CN/auth-center-client-management)中创建公共客户端，启用 `authorization_code`，登记准确的回调地址和所需 scope，并确认应用已通过审核且处于启用状态。公共客户端的授权码流程必须使用 PKCE；需要刷新时同时启用 `refresh_token`，不能启用 `client_credentials`。
2. 确认部署提供的认证中心授权界面。`GET /v1/auth-center/authorize` 是需要已登录身份的授权预览 API，不是直接在浏览器地址栏打开的授权页面。内置的 OAuth 授权页面使用的是另一套 OAuth 接口。
3. 规划应用自己的后端和会话存储：认证中心令牌只交给可信后端处理，浏览器持有你自己应用的会话标识。

本页采用“浏览器 + 可信后端”的接入方式，不提供可直接部署的纯浏览器登录应用。部署没有提供认证中心授权界面时，需要先补齐该界面；不能将认证中心 Client ID 直接交给内置 OAuth 授权页。接口发现文档也不会自动创建交互式登录页面。

## 区分授权界面与 API

以下路径相对于本部署的 API 根地址。授权界面负责展示应用与 scope、让用户明确同意或拒绝，再处理返回的回调地址。

| 接口                                        | 调用者与结果                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /v1/auth-center/authorize`             | 授权界面携带平台登录身份，读取授权预览；成功响应为 `{ code, message, data }`。                              |
| `POST /v1/auth-center/authorize`            | 授权界面提交同一组授权参数及 `approve`；成功响应的 `data.redirectTo` 是回调 URL，接口本身不执行浏览器跳转。 |
| `POST /v1/auth-center/token`                | 应用可信后端交换授权码或刷新令牌；成功响应是直接的令牌对象，不包裹在 `data` 中。                            |
| `GET /v1/auth-center/.well-known/jwks.json` | 可信后端读取验签公钥；成功响应中的公钥位于 `data.keys`。                                                    |

授权预览与授权决定需要平台登录态，IAM 强制模式下还分别需要 `quyan:auth_center:GetAuthorizationPreview` 和 `quyan:auth_center:DecideAuthorization`。应用 Client ID、授权码或认证中心访问令牌不能代替这里的平台登录身份。

## 发起授权与处理回调

1. 每次授权生成不可预测的 `state` 和 PKCE verifier，并计算其 S256 challenge。将 `state` 与 verifier 保存在当前授权会话中，不要在多个用户或浏览器会话之间共用。
2. 通过部署提供的授权界面发起授权，提交 `response_type=code`、应用 Client ID、已登记的回调地址、scope、`state`、`code_challenge` 和 `code_challenge_method=S256`。不要省略方法：服务端默认使用 `plain`，与 S256 challenge 不匹配。明确列出需要的 scope；省略时使用客户端配置的全部 scope。用户登录并确认后，授权界面处理认证中心返回的回调地址。
3. 回调时在交换授权码**之前**核对返回的 `state` 与该会话中保存的值；缺失、不匹配或会话过期时停止流程并重新开始。每次授权只使用对应的 verifier，并在处理后清除临时数据。
4. 由可信后端调用 `POST /v1/auth-center/token`，提交授权码、Client ID、完全一致的回调地址和 `code_verifier`。公共客户端不提交客户端密钥。令牌响应应保存在服务端，不要返回或记录刷新令牌。
5. 后端按[令牌校验指南]({{DOCS_BASE_URL}}/zh-CN/auth-center-node-sdk)校验签名、签发者、受众、有效期、令牌用途和所需 scope，再创建自己的应用会话。可以复用 SDK 页面中的校验函数；公共客户端交换时省略 `client_secret`，不要照搬其机密客户端注册要求。Cookie 应使用 `HttpOnly`、`Secure`、合适的 `SameSite` 策略，并配合服务端 CSRF 防护。

授权码有效期为 5 分钟且只能使用一次；刷新令牌成功使用后会轮换。网络中断时不能假定服务端未处理请求；无法恢复新令牌时应重新授权。是否返回刷新令牌取决于客户端是否启用刷新授权。

用户拒绝时，回调携带 `error=access_denied` 和原 `state`，没有授权码。先校验 `state`，再显示取消结果并清理临时会话，不要发起令牌交换。即使曾经授权，预览中的 `requireConsent=false` 也不是新的授权码；仍需完成授权决定步骤。请求包含用户当前无法授予的 scope 时，批准会失败。

## 会话与退出边界

本地验签不会实时查询远端令牌撤销、用户状态或客户端停用情况；应用会话也不会因为平台退出登录而自动结束。请让自己的后端管理会话有效期、退出、令牌保存及撤销策略，并在刷新后重新检查返回的 scope。浏览器不应仅凭解码 JWT 创建登录态。

回调 URL 中的授权码是临时数据，处理完成后清理地址栏及临时会话，避免重复交换。签发者和 JWKS 地址使用预先确认的部署配置；不要根据未验证令牌中的内容自行选择可信签发者。

## 常见问题

- **授权预览返回 401 或 403**：确认授权界面具备有效的平台登录态和访问权限，且应用已通过审核。
- **回调被拒绝**：检查回调地址与登记值是否完全一致，以及当前会话中的 `state` 是否仍然有效。
- **令牌交换失败**：确认 PKCE verifier 与发起授权时的 challenge 对应，授权码未被使用或过期。
- **校验令牌失败**：确认使用本部署的 JWKS、配置的 issuer、当前 Client ID 和正确的 scope；不要仅凭解析 JWT 的内容判断授权通过。

## 相关文档

- [认证中心应用接入]({{DOCS_BASE_URL}}/zh-CN/auth-center-app-management)
- [认证中心 Node SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-node-sdk)
- [认证中心 Python SDK]({{DOCS_BASE_URL}}/zh-CN/auth-center-python-sdk)
