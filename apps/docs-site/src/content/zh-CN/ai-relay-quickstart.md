# 调用 AI 快速开始

本页说明如何用中转令牌调用已启用的 AI 模型。

## 开始前

需要已登录 AI 中转控制台，并拥有可用的渠道或自动代理池。中转令牌只用于 API 请求，不能用于登录管理后台。

## 四步调用

1. 打开“中转令牌管理”，点击“创建令牌”。
2. 为令牌选择渠道或自动代理池，保存后复制创建抽屉顶部的 **Relay Base URL** 和令牌值。
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

## 常见问题

- `401`：确认使用的是中转令牌，且 `Authorization` 头为 `Bearer <relay_token>`。
- 模型不可用：重新请求 `/v1/models`，并检查令牌渠道是否已启用该模型和格式。
- `403`：检查令牌状态、IP 白名单和额度限制。

相关页面：`relay-token-management`、`api-documentation`、`relay-settings`。
