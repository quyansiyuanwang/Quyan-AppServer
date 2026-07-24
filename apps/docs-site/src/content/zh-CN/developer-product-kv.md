# KV 存储

KV 存储适用于前端配置、轻量计数器、功能开关和短期 JSON 数据。键只在当前实例内唯一，值按 JSON 保存；不适合大文件、复杂关系查询或高频队列。

## 权限与限制

读取需要 KV 读取权限，写入和删除需要 KV 写入权限。键只能使用字母、数字、点、下划线、冒号和连字符，长度不超过 191 个字符。TTL 最长 30 天；过期条目读取时等同不存在，并会被异步清理。

## API

所有请求使用 `Authorization: Bearer dpk_...`：

```http
POST /v1/products/kv/entries/ui.theme
Content-Type: application/json

{ "value": { "mode": "dark" }, "ttlSeconds": 86400 }
```

`GET /v1/products/kv/entries` 返回键列表，`GET /v1/products/kv/entries/{key}` 读取单个值，`DELETE /v1/products/kv/entries/{key}` 删除条目。写入为 upsert，响应包含 `version`、`updateTime` 与可选的 `expiresAt`，可用于客户端冲突提示和展示。

不要将 API Key 或其他机密直接作为 KV 值保存；需要由平台代管的凭据请使用密钥托管产品。
