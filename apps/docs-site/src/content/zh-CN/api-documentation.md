# API 文档

此页面不应只是“地址清单”。它更适合扮演 **集成入口 + SDK 参考 + 示例代码中心** 的角色：让接入方从“知道接口存在”直接走到“复制示例就能跑通”。

## 页面定位

此页建议用于回答 4 类问题：

1. **我该用哪个基础地址？**
2. **我该选 JWT、OAuth、Access Key 还是 Relay Token？**
3. **有没有一段可以直接复制的 curl / TypeScript / Python 示例？**
4. **返回结构、分页、鉴权、错误处理应该怎么写？**

## 你会看到什么

### 端点标签页

- Base URL
- Provider URL
- Balance URL
- Platform-balance URL
- 复制按钮
- 完整路径显示开关

### 价格标签页

- 带筛选的价格列表
- 模型或供应商视图
- 刷新按钮
- 自定义倍率 / token 单位切换

## 建议文档结构

一个“可交付”的 API 文档，至少应包含：

- **接口地址**：知道发到哪里
- **鉴权方式**：知道怎么带凭证
- **请求示例**：知道 body / query / headers 怎么写
- **响应示例**：知道怎么取数据
- **错误处理**：知道失败时怎么兜底
- **SDK 示例**：知道如何在真实项目里封装
- **最小可运行 Demo**：知道从 0 到 1 跑通流程

## 基础地址

以线上环境为例：

```text
API Base URL: https://api.qysyw.cn
Swagger:      https://api.qysyw.cn/docs
OpenAPI JSON: https://api.qysyw.cn/docs/openapi.json
```

如果只是临时调试，可先用 Swagger；如果要真正接入业务，建议直接参考下面的代码模板。

## AI 中转快速接入

想调用 AI 时，使用 **AI 中转控制台**，而不是浏览器登录接口。最短流程如下：

1. 进入 **中转令牌管理**，点击“创建令牌”，选择可用渠道或自动代理池后保存令牌。
2. 在创建抽屉顶部或 **API 文档** 页的端点标签中复制 **Relay Base URL**。它是你的部署对外提供的中转地址，可能与管理后台或后端 API 地址不同。
3. 将令牌仅放在服务端环境变量中，并用 `Authorization: Bearer <relay_token>` 请求中转接口。
4. 先调用 `/v1/models` 查看当前令牌能使用的模型，再选择相应的请求格式。

以下示例中的 `https://relay.example.com` 必须替换为控制台显示的 Relay Base URL；不要猜测或把管理站域名当作中转地址。

```bash
# 查看此令牌可调用的模型
curl "https://relay.example.com/v1/models" \
  -H "Authorization: Bearer <relay_token>"

# OpenAI Chat Completions 兼容调用
curl "https://relay.example.com/v1/chat/completions" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-model",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

中转令牌只用于中转请求，不用于登录管理后台。令牌所属渠道、启用模型、请求格式、额度、IP 白名单和状态都会影响实际能否调用；遇到 `401`、`403` 或模型不可用时，先在中转令牌管理页面检查这些配置。

## 统一响应格式

后端大多数接口遵循统一结构：

```json
{
  "code": 0,
  "message": "Success",
  "data": {}
}
```

建议约定：

- `code === 0`：成功
- `code !== 0`：业务失败
- `message`：给日志或提示用
- `data`：真实业务载荷

### TypeScript 通用解析器

```ts
export interface ApiResponse<T> {
  code: number
  message: string
  data?: T
}

export function unwrapApi<T>(response: ApiResponse<T>): T {
  if (response.code !== 0) {
    throw new Error(response.message || `API failed: ${response.code}`)
  }
  return response.data as T
}
```

## 鉴权方式选择

| 场景                  | 推荐方式    | 说明               |
| --------------------- | ----------- | ------------------ |
| 浏览器登录态          | JWT         | 适合站内用户操作   |
| 第三方代用户访问      | OAuth 2.0   | 适合开放平台接入   |
| 服务端脚本 / 定时任务 | Access Key  | 适合无交互程序调用 |
| 网关 / 代理转发       | Relay Token | 适合中继与统一出口 |

如果你的目标是“给外部开发者一套真正可跑的接入说明”，建议每种鉴权都至少提供 1 段 curl 和 1 段 SDK 示例。

## OpenAI 图片编辑中转

通过 Relay Token 调用 OpenAI 兼容的 `/relay/proxy/v1/images/edits` 时，多张参考图应使用重复的 `image[]` 字段。中转也会兼容多个旧式 `image` 字段，并在转发前将其规范为 `image[]`，保留图片顺序、mask 和其他表单字段。

```bash
curl -X POST "https://api.qysyw.cn/relay/proxy/v1/images/edits" \
	-H "Authorization: Bearer <relay_token>" \
	-F "model=gpt-image-2" \
	-F "image[]=@first.png" \
	-F "image[]=@second.png" \
	-F "prompt=将两张参考图中的主体组合为一张新图"
```

建议新接入始终使用 `image[]`。能否实际理解或融合多张参考图仍取决于所选模型和上游渠道的能力。

## OpenAI 文本中转格式

Relay 将 OpenAI 的两种 v1 文本接口作为独立格式管理：

- **OpenAI Chat Completions**：`/relay/proxy/v1/chat/completions`，请求体使用 `messages`。
- **OpenAI Responses**：`/relay/proxy/v1/responses`，请求体使用 `input`。

使用任一接口前，Relay Token 所属渠道和所选模型都必须显式启用对应格式。旧 OpenAI 配置仅兼容为 Chat Completions；Responses 不会自动启用。

### OpenAI Responses 示例

```bash
curl "https://relay.example.com/v1/responses" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-enabled-model",
    "input": "你好"
  }'
```

其他兼容格式（Anthropic 或 Gemini）仅在令牌渠道显式启用后可用。接口路径和字段以控制台的 API 文档页面为准。

## 最小 curl 示例

### 1. JWT 用户态请求

```bash
curl -X GET "https://api.qysyw.cn/users/profile" \
	-H "Authorization: Bearer <access_token>"
```

### 2. Access Key 请求

```bash
curl -X GET "https://api.qysyw.cn/system/config" \
	-H "Authorization: Bearer <access_key>"
```

> 实际是否允许某接口被 Access Key 调用，仍以接口权限和服务端策略为准。

### 3. 带分页查询的列表示例

```bash
curl -G "https://api.qysyw.cn/oauth-clients/review" \
	-H "Authorization: Bearer <access_token>" \
	--data-urlencode "page=1" \
	--data-urlencode "pageSize=20" \
	--data-urlencode "reviewStatus=pending"
```

## TypeScript SDK 示例

如果接入方用前端或 Node.js，最实用的是一个轻量 SDK 包装层，而不是每次手写 `fetch`。

### 1. 通用请求器

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOptions {
  method?: HttpMethod
  token?: string
  body?: unknown
}

const API_BASE_URL = 'https://api.qysyw.cn'

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  })

  const json = await response.json()
  if (json.code !== 0) throw new Error(json.message || 'Request failed')
  return json.data as T
}
```

### 2. OAuth 应用审核列表示例

```ts
export interface OAuthReviewItem {
  id: string
  name: string
  clientId: string
  reviewStatus: 'draft' | 'pending' | 'approved' | 'rejected'
  reviewComment?: string
}

export interface OAuthReviewListResponse {
  items: OAuthReviewItem[]
  total: number
  page: number
  pageSize: number
}

export async function listOAuthAppsForReview(token: string) {
  return apiRequest<OAuthReviewListResponse>('/oauth-clients/review?page=1&pageSize=20', {
    token,
  })
}
```

### 3. 审核操作示例

```ts
export async function reviewOAuthApp(
  token: string,
  id: string,
  reviewStatus: 'approved' | 'rejected',
  reviewComment?: string,
) {
  return apiRequest(`/oauth-clients/${id}/review`, {
    method: 'POST',
    token,
    body: {
      reviewStatus,
      reviewComment,
    },
  })
}
```

## Python 示例

对于后端开发者，提供 Python 示例通常比单纯参数表更有用。

```python
import requests

API_BASE_URL = "https://api.qysyw.cn"
ACCESS_TOKEN = "<access_token>"

response = requests.get(
		f"{API_BASE_URL}/oauth-clients/review",
		headers={"Authorization": f"Bearer {ACCESS_TOKEN}"},
		params={"page": 1, "pageSize": 20, "reviewStatus": "pending"},
		timeout=15,
)
response.raise_for_status()

payload = response.json()
if payload["code"] != 0:
		raise RuntimeError(payload["message"])

for item in payload["data"]["items"]:
		print(item["name"], item["reviewStatus"])
```

## OAuth 授权码流程 Demo

如果文档站要更像“开放平台文档”，建议至少给出完整授权码流程示例。

### 第一步：跳转到授权页

```text
GET https://api.qysyw.cn/v1/oauth/authorize
	?response_type=code
	&client_id=oc_live_xxx
	&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fcallback
	&scope=profile%20email
	&state=random-csrf-token
	&code_challenge=pkce-challenge
	&code_challenge_method=S256
```

### 第二步：后端换 token

```bash
curl -X POST "https://api.qysyw.cn/v1/oauth/token" \
	-H "Content-Type: application/json" \
	-d '{
		"grant_type": "authorization_code",
		"client_id": "oc_live_xxx",
		"client_secret": "oc_secret_xxx",
		"code": "returned_code",
		"redirect_uri": "https://demo.example.com/callback",
		"code_verifier": "pkce-verifier"
	}'
```

## 分页约定建议

文档里应明确告诉接入方：

- `page`：页码，通常从 `1` 开始
- `pageSize`：每页条数
- 后端可能限制最大值，例如 `pageSize <= 100`

推荐写法：

```ts
const page = 1
const pageSize = 20 // 不要盲目传超大值
```

## 错误处理建议

不要只展示”成功示例”，还应展示失败时怎么处理。

```ts
try {
  const data = await listOAuthAppsForReview(token)
  console.log(data.items)
} catch (error) {
  console.error('Load failed:', error)
  // 建议这里做 toast、重试、降级提示、日志上报
}
```

### 常见 `code` 值

`code` 是响应体内的业务状态码（参见上文”统一响应格式”），与 HTTP 状态码是两套独立的体系——HTTP 状态为 `200 OK` 的响应仍可能携带非零 `code`，表示业务层面的失败。

| `code` | 含义                       | 建议处理方式                      |
| ------ | -------------------------- | --------------------------------- |
| `0`    | 成功                       | 直接使用 `data`                   |
| `1001` | 认证失败                   | 提示重新登录                      |
| `1002` | 参数校验失败               | 修正请求体/参数，不要重试         |
| `1003` | 资源不存在                 | 不要重试，展示”未找到”状态        |
| `1004` | 权限不足                   | 不要重试，当前 token 缺少所需权限 |
| `1006` | Token 因用户信息变更而过期 | 刷新 token 后重试一次             |
| `1013` | Token 已过期               | 刷新 token 后重试一次             |
| `1014` | Token 无效或伪造           | 不要重试，强制重新登录            |
| `1017` | 重放保护校验失败           | 获取新的签名会话后重试一次        |
| `1018` | 需要二次验证               | 完成 2FA 挑战后重试               |
| `1429` | 请求过于频繁（限流）       | 按响应建议的重试等待时间再重试    |

完整列表位于 `CustomCode`（`packages/shared/src/custom-code.ts`），并会持续增加——遇到未识别的 code 时应视为通用业务失败，而不要臆测其具体含义。

### 重试建议

- 只对表示”临时性状态”的 code 进行重试（token 刷新、重放保护会话续期、限流）。对 `1002`/`1003`/`1004`/`1014` 重试没有意义，因为请求本身就是问题所在，每次结果都相同。
- 遇到 `1429`（限流）时，应遵循响应中建议的重试等待时间，而不是立即重试。
- 自动重试次数建议限制在 1-2 次，超过后应将错误呈现给用户或调用方，而不是持续循环重试。

## 文档应提供的最小 Demo 清单

建议后续至少补齐这几类：

1. **curl Demo**：适合快速验证
2. **TypeScript Demo**：适合前端和 Node.js
3. **Python Demo**：适合后端脚本和运维
4. **OAuth 完整流程 Demo**：适合开放平台接入方
5. **错误码与重试建议**：适合真实生产落地

## 推荐阅读顺序

1. 先看本页获取基础地址和鉴权方式。
2. 再看 Swagger 确认具体字段。
3. 接入 OAuth 时继续阅读 `oauth-app-management`。
4. 使用程序化凭证时阅读 `access-key-management` 或 `relay-token-management`。

## 相关页面

- `oauth-app-management`
- `access-key-management`
- `relay-token-management`
- `json-endpoint-management`
