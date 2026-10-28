# KV 存储

KV 存储适用于前端配置、轻量计数器、功能开关和短期 JSON 数据。键只在当前实例内唯一，值按 JSON 保存；不适合大文件、复杂关系查询或高频队列。

## 权限与限制

读取需要 KV 读取权限，写入和删除需要 KV 写入权限。键只能使用字母、数字、点、下划线、冒号和连字符，长度不超过 191 个字符。TTL 最长 30 天；过期条目读取时等同不存在。

## API

所有请求使用 `Authorization: Bearer sk-dpk-...`：

```http
POST /v1/products/kv/entries/ui.theme
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{ "value": { "mode": "dark" }, "ttlSeconds": 86400 }
```

`GET /v1/products/kv/entries` 返回键列表，`GET /v1/products/kv/entries/{key}` 读取单个值，`DELETE /v1/products/kv/entries/{key}` 删除条目。写入为 upsert，响应包含 `version`、`updateTime` 与可选的 `expiresAt`，可用于客户端冲突提示和展示。

不要将 API Key 或其他机密直接作为 KV 值保存；需要由平台代管的凭据请使用密钥托管产品。

## JWT 项目管理接口

项目 KV 管理使用 `quyan:developer:ListKv`、`GetKv`、`SetKv` 和 `DeleteKv`，可逐键委派同账户权限。键的 ARN 为 `acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`，末段是原键的 UTF-8 base64url 编码（无填充）。直接使用响应中的 resourceArn 可避免编码错误。

`GET /v1/developer/projects/{projectId}/kv/entries/page` 返回过滤后的分页元数据（items、page、pageSize、hasNext），不返回值和 total。空页可能有后续页。enforce 下原数组列表只返回默认第一页，过期读取或列表不会删除条目。读取名为 page 的键仍使用 `GET .../kv/page`。项目本身的授权不会自动获得所有键的权限。更多策略和资源组规则见 [RAM 管理](./ram-management)。
