# 调用 AI 快速开始

本页说明如何用中转令牌调用已启用的 AI 模型。

## 开始前

需要已登录 AI 中转控制台，并拥有可用的渠道或自动代理池。中转令牌只用于 API 请求，不能用于登录管理后台。

## 四步调用

1. 打开“中转令牌管理”，点击“创建令牌”。
2. 在创建抽屉中复制顶部的 **Relay Base URL**，选择渠道或自动代理池并保存。创建成功后，在令牌列表中找到新令牌并复制其凭据；如果凭据不可用，请检查[凭据披露权限]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)。
3. 在调用方的服务端环境变量中保存令牌。不要提交到代码仓库或发送到浏览器。
4. 先请求 `Relay Base URL + /v1/models`，从返回列表选择模型；再按该模型已启用的格式发起请求。

## 最小请求

将示例域名替换为控制台显示的 Relay Base URL：

```bash
curl "https://relay.example.com/v1/chat/completions" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-enabled-model","messages":[{"role":"user","content":"你好"}]}'
```

OpenAI Responses 格式使用 `/v1/responses` 和 `input` 字段。渠道、模型、请求格式、令牌状态、额度窗口和 IP 白名单都会影响调用结果。

## 请求头转发

转发使用默认协议白名单和渠道额外白名单，而不是原样透传所有字段。普通请求、流式请求和图片请求使用相同规则：

- 通用字段：`Content-Type`、`Accept`、`Accept-Encoding`、`User-Agent`、`X-Request-Id`、`X-Client-Request-Id`、`Idempotency-Key`。
- 所有格式默认保留 `X-Opencode-Session`，用于需要会话标识的兼容上游。
- OpenAI 格式额外保留：`OpenAI-Organization`、`OpenAI-Project`、`OpenAI-Beta`。
- Anthropic 格式额外保留：`anthropic-version`、`anthropic-beta`。未指定版本时才补充默认值 `2023-06-01`，不会覆盖调用者指定的版本。
- Gemini 格式额外保留：`X-Goog-Api-Client`。

这些字段是否被接受、对应功能和幂等语义是否生效，由上游服务决定。格式转换时，以实际发送给上游的格式选择协议字段，不会把另一协议的专用字段一并转发。

用于认证本平台的 `Authorization`、`X-Api-Key` 等凭据不会作为上游凭据透传，而是替换为所选渠道的凭据。`Cookie`、`Host`、连接级字段、`Connection` 指定的字段、代理来源字段和未进入白名单的自定义请求头不会转发。`Content-Length` 根据实际发送的请求体重新计算。不要依赖自定义请求头控制渠道、计费或平台权限。

### 动态配置额外请求头

拥有渠道编辑权限的管理员可在 **AI 中转设置 → 渠道管理 → 创建/编辑物理渠道 → 额外转发请求头** 中输入头名并按回车添加，例如 `x-stainless-retry-count` 或 `x-opencode-session`。配置按渠道保存，不需要重启服务；支持独立渠道和物理成员渠道，混池按最终选中的物理渠道配置转发，重试换渠道时使用该渠道自己的列表。

- 仅填写精确头名，不填写值，不支持 `*` 或通配前缀；头名不区分大小写，自动去重。
- 最多 64 个额外头名，每个最多 128 字符；保存无效、敏感或保留头名时会报错，不会静默放行。
- 默认协议头继续保留；清空额外列表只撤销额外转发，不会关闭默认头。
- 可按需添加 SDK 元数据的具体头名（例如 `x-stainless-retry-count`），未添加的其他 `X-Stainless-*` 头仍不会转发。
- `Authorization`、API Key、Cookie、内部控制/防重放/代理来源及连接级请求头禁止加入；即使额外允许的头被 `Connection` 指定，也不会转发。
- 只转发用户请求中实际存在的合法值；渠道配置不会生成或覆盖头值。不要把密钥放进自定义元数据头；这些头的值会被发送给选中的上游。

## 常见问题

- `401`：确认使用的是中转令牌，且 `Authorization` 头为 `Bearer <relay_token>`。
- 模型不可用：重新请求 `/v1/models`，并检查令牌渠道是否已启用该模型和格式。
- `403`：检查令牌状态、IP 白名单和额度限制。

相关页面：[转发 Token 管理]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)、[API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)、[转发设置]({{DOCS_BASE_URL}}/zh-CN/relay-settings)。

## 资源保护与重试

服务器可能限制全站并发、排队时间、上传及上游响应大小。资源繁忙时返回 429，请采用退避重试，不要立即并发重发。超过响应容量会中断上游，不会返回截断的成功结果。流中失败不代表未发生上游用量，请以用量记录为准。具体预算由部署配置决定。
