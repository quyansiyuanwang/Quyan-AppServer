# KV 存储

KV 存储适用于前端配置、功能开关和短期 JSON 数据。键只在当前实例内唯一，值按 JSON 保存；不适合大文件、复杂关系查询或高频队列。计数器等读后写场景需要应用自行协调并发，否则更新可能互相覆盖。

## 权限与限制

读取需要 KV 读取权限，写入和删除需要 KV 写入权限。键只能使用字母、数字、点、下划线、冒号和连字符，长度不超过 191 个字符。单个 JSON 值序列化后最多 64 KiB，每个实例最多 1000 个条目。TTL 为 1 秒至 30 天；过期条目读取时等同不存在。

## 在控制台管理

打开 KV 产品实例，选择“新建”，填写键、有效的 JSON 值和可选的 TTL 秒数后保存。写入已有键会覆盖原值并重新设置到期时间，保存前请核对键名。列表显示键、版本和到期时间；选择“编辑”会先读取当前值，键名不能在编辑时修改。删除需要确认。查看和保存分别需要读取和写入权限。

编辑带到期时间的条目时，表单填入打开时的剩余秒数。保存会从保存时刻重新计算到期时间；如果编辑窗口停留较久，请重新检查 TTL。留空 TTL 保存会移除到期时间。

列表加载失败时，页面可能保留上次列表，切换实例后也可能如此；空列表也不能证明当前实例没有条目。点击错误提示中的“重试”，加载成功后再操作。保存或删除后的刷新也可能失败，即使同时出现成功提示，也应先重试加载并读取条目核对结果，再决定是否重复操作。

## API

产品 API 请求使用 `Authorization: Bearer sk-dpk-...`，请在可信服务端调用并保护 Key。向浏览器提供前端配置时，由自己的后端按业务权限读取并返回所需数据，不要把产品 Key 放入前端代码或浏览器存储。

```http
POST /v1/products/kv/entries/ui.theme
Authorization: Bearer sk-dpk-...
Content-Type: application/json

{ "value": { "mode": "dark" }, "ttlSeconds": 86400 }
```

`GET /v1/products/kv/entries` 返回键列表，`GET /v1/products/kv/entries/{key}` 读取单个值，`DELETE /v1/products/kv/entries/{key}` 删除条目。写入为 upsert，响应包含 `version`、`updateTime` 与可选的 `expiresAt`。每次写入都会重新设置过期时间；不提供 TTL 时，条目不再设置过期时间。`version` 可用于展示变化，但写入接口没有按版本条件更新：并发的读后写可能互相覆盖，计数器等场景需要在应用侧协调并发。产品 API 调用计入用量，额度和超额费用以当前产品配置为准。

不要将 API Key 或其他机密直接作为 KV 值保存；需要由平台代管的凭据请使用[密钥托管]({{DOCS_BASE_URL}}/zh-CN/developer-product-secret)。

## JWT 项目管理接口

项目 KV 管理使用 `quyan:developer:ListKv`、`GetKv`、`SetKv` 和 `DeleteKv`，可逐键委派同账户权限。键的 ARN 为 `acs:developer:*:<accountId>:kv-item/<projectId>/<encodedKey>`，末段是原键的 UTF-8 base64url 编码（无填充）。直接使用响应中的 resourceArn 可避免编码错误。

`GET /v1/developer/projects/{projectId}/kv/entries/page` 返回过滤后的分页元数据（items、page、pageSize、hasNext），不返回值和 total。空页可能有后续页。enforce 下原数组列表只返回默认第一页，过期读取或列表不会删除条目。读取名为 page 的键仍使用 `GET .../kv/page`。项目本身的授权不会自动获得所有键的权限。更多策略和资源组规则见 [RAM 管理]({{DOCS_BASE_URL}}/zh-CN/ram-management)。
