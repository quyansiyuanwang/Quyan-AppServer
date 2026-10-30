# 调用 AI 快速开始

使用 Relay Token 发起第一个 AI 请求，并核对返回结果和消费记录。以下生成请求可能产生费用；先确认模型价格、令牌额度及可用格式。

## 开始前

需要一个仍有效且允许目标模型和格式的 Relay Token，以及当前部署的 Relay Base URL。已有这两项信息时，可直接从第三步验证调用。

自行创建令牌时，先登录 AI 中转控制台。进入令牌管理及 API 文档需要 `RELAY_TOKEN_READ`，创建入口需要 `RELAY_TOKEN_CREATE`；实际创建、选用渠道、查看及披露凭据仍分别受服务端授权限制。按提示完成二次验证和重放保护，创建成功不代表一定能读取完整凭据。

Relay Token 用于中转请求，不是管理后台登录凭证，也不能用账号 AccessKey、OJ API Key 或第三方认证令牌代替。

## 第一步：创建并保存令牌

1. 打开 **中转令牌管理**，单击 **创建令牌**。
2. 选择自己有权使用的渠道或自动代理池。组合令牌等进阶配置见[Relay Token 管理]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)。
3. 按需设置名称、有效期、额度和 IP 白名单，确认模型及格式可用后保存。
4. 创建成功后在列表中找到新令牌，使用复制凭据操作。若只显示遮罩或提示凭据不可用，检查读取及披露授权，不要反复创建令牌来尝试解决。

把凭据放在调用方服务端的环境变量或安全存储中，不要提交到代码仓库、写入公开日志或放进浏览器代码。

## 第二步：复制 Relay Base URL

打开 **API 文档 → API 端点**，复制当前部署显示的 **通用兼容端点**，作为 Relay Base URL。完整路径开关用于不同客户端的地址格式，不会改变服务部署。

中转、后台 API、管理站和认证站可能使用不同域名。客户端可能自行拼接 `/v1`，先确认其 Base URL 要求，避免重复路径。下面的 `https://relay.example.com`、`<relay_token>` 和模型 ID 都是占位值，运行前替换；示例命令采用 Bash 风格的续行与引号。

## 第三步：确认 Chat Completions 模型

```bash
curl "https://relay.example.com/v1/models" \
  -H "Authorization: Bearer <relay_token>"
```

成功结果是模型列表，从 `data` 数组中的 `id` 选择请求模型。此接口按 **Chat Completions 入口**计算可用模型，也会考虑令牌已配置的格式转换；它不是所有协议和图片能力的完整目录。

只有 Responses、Anthropic 或 Gemini 能力的令牌可能无法通过这个模型查询。此时核对令牌页面的对应格式模型与渠道配置，不要仅凭列表为空或查询失败判断其他格式都不可用。模型出现在列表中也不保证额度、余额、并发或上游服务始终满足下一次请求。

## 第四步：发送生成请求

先使用少量输出和非流式请求验证 Chat Completions：

```bash
curl "https://relay.example.com/v1/chat/completions" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-model",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 256
  }'
```

示例使用 `max_tokens` 限制输出；如模型要求 `max_completion_tokens`，请使用该字段。令牌将 Chat Completions 转换为 Anthropic 时必须提供其中一个正数。

如需 Responses，先确认渠道和模型启用了该格式，再使用独立的路径和字段：

```bash
curl "https://relay.example.com/v1/responses" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-responses-model",
    "input": "你好",
    "max_output_tokens": 256
  }'
```

Chat Completions 与 Responses 不会因为同属 OpenAI 兼容协议而自动互通。Anthropic、Gemini 及图片请求的地址和字段见[API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)。

## 核对结果和费用

非流式 Chat Completions 正常返回兼容 JSON，可查看 `choices` 中的回复；Responses 使用自己的输出结构。检查 HTTP 状态和相应协议的错误信息，不能套用平台业务 API 的 `code === 0` 解包规则。

首个请求成功后，再在客户端启用需要的流式模式。流式请求必须按所选协议的事件格式读取，并等待完整结束；已收到部分内容不代表请求完整成功。

在[消费记录]({{DOCS_BASE_URL}}/zh-CN/consumption-records)核对实际用量、费用及适用的月卡抵扣。必要时保留请求 ID 排查。网络超时、中途断流或本地没有对应结算记录，都不能单独证明上游没有处理请求或产生用量。

## 常见问题

| 现象                         | 检查方法                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| 创建成功但无法复制凭据       | 检查列表/读取及凭据披露授权；创建权限不等于披露权限                         |
| `401`、`404` 或提示令牌无效  | 核对 Relay Base URL、凭证类型和完整值，检查令牌是否已禁用或删除             |
| `400` 或提示过期、格式不支持 | 检查有效期、请求字段、模型及格式；`/v1/models` 仅验证 Chat Completions 入口 |
| `403` 或提示 IP 不允许       | 检查调用方实际出口 IP 与白名单，不能用自定义来源头替代                      |
| `429` 或提示额度/并发限制    | 检查令牌额度窗口、并发和排队限制；等待后有限退避，不要并发重发              |
| 模型列出但生成失败           | 继续检查账户余额、额度、渠道状态、路由和上游返回的信息                      |
| 返回 HTML 或路径不存在       | 检查是否误用前端域名，或客户端重复拼接了 `/v1`                              |

不要只凭 HTTP 状态猜测原因；结合错误内容和请求 ID 排查。价格、窗口、可用模型和容量均以当前部署及实际请求配置为准。

## 资源限制与重试

服务器可能限制并发、排队时间、上传及上游响应大小。超过容量、请求超时或响应过大可能失败；已经开始的流式传输也可能中断。不要将部分输出当作完整成功结果。

手动重试会再次提交请求，可能重复生成并产生费用。先核对原请求结果；只有确认需要重试时，才按服务端提示有限退避。`Idempotency-Key` 被转发不代表平台提供全局去重或上游一定执行幂等。

## 请求头转发

以下内容供需要自定义客户端或上游兼容性时参考；完成第一次调用不需要修改转发白名单。

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

## 相关页面

- [Relay Token 管理]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)
- [API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)
- [中转设置]({{DOCS_BASE_URL}}/zh-CN/relay-settings)
- [消费记录]({{DOCS_BASE_URL}}/zh-CN/consumption-records)
