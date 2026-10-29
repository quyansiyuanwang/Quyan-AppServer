# API 文档

了解接口地址、认证方式、请求示例和错误处理，再通过 API 参考确认具体接口的字段和权限要求。

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

## 基础地址

以下地址仅为示例。调用前请替换为当前部署提供的 API 地址；认证站地址可能不同：

```text
API Base URL: https://api.qysyw.cn
Swagger:      https://api.qysyw.cn/docs
OpenAPI JSON: https://api.qysyw.cn/docs/openapi.json
```

可以使用 Swagger 查看和调试接口。访问 OpenAPI JSON 可能需要身份认证及相应权限，详见下方的“生成的 OpenAPI 规范访问”。

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

调用前请确认令牌具有目标接口所需的权限；OAuth 令牌还需相应 scope。

## OpenAI 图片编辑中转

将下方示例域名替换为控制台显示的 Relay Base URL。通过 Relay Token 调用 OpenAI 兼容的 `/v1/images/edits` 时，多张参考图应使用重复的 `image[]` 字段。中转也会兼容多个旧式 `image` 字段，并在转发前将其规范为 `image[]`，保留图片顺序、mask 和其他表单字段。

```bash
curl -X POST "https://relay.example.com/v1/images/edits" \
	-H "Authorization: Bearer <relay_token>" \
	-F "model=gpt-image-2" \
	-F "image[]=@first.png" \
	-F "image[]=@second.png" \
	-F "prompt=将两张参考图中的主体组合为一张新图"
```

建议新接入始终使用 `image[]`。能否实际理解或融合多张参考图仍取决于所选模型和上游渠道的能力。

## OpenAI 文本中转格式

Relay 将 OpenAI 的两种 v1 文本接口作为独立格式管理：

- **OpenAI Chat Completions**：`/v1/chat/completions`，请求体使用 `messages`。
- **OpenAI Responses**：`/v1/responses`，请求体使用 `input`。

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
curl -X GET "https://api.qysyw.cn/v1/users/me" \
	-H "Authorization: Bearer <access_token>"
```

### 2. Access Key 请求

```bash
curl -X GET "https://api.qysyw.cn/v1/users/me" \
	-H "Authorization: Bearer <access_key>"
```

> 实际是否允许某接口被 Access Key 调用，仍以接口权限和服务端策略为准。

### 3. 带分页查询的列表示例

此接口用于审核 OAuth 应用，需要相应的审核权限。

```bash
curl -G "https://api.qysyw.cn/v1/oauth-clients/review" \
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
  if (!response.ok || json.code !== 0)
    throw new Error(json.message || `Request failed: ${response.status}`)
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
  return apiRequest<OAuthReviewListResponse>('/v1/oauth-clients/review?page=1&pageSize=20', {
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
  return apiRequest(`/v1/oauth-clients/${encodeURIComponent(id)}/review`, {
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
		f"{API_BASE_URL}/v1/oauth-clients/review",
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

使用授权码流程前，请先创建应用并登记回调地址；应用需要通过审核。将示例中的站点地址、客户端信息和回调地址替换为实际值，并使用随机生成的 `state` 和 PKCE verifier 计算对应的 S256 challenge。完整流程见 [OAuth 示例]({{DOCS_BASE_URL}}/zh-CN/oauth-demo)。

### 第一步：跳转到授权页

```text
GET https://auth.qysyw.cn/oauth/authorize
	?response_type=code
	&client_id=oc_live_xxx
	&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fcallback
	&scope=profile%20email
	&state=random-csrf-token
	&code_challenge=pkce-challenge
	&code_challenge_method=S256
```

授权页面位于认证站；`https://api.qysyw.cn/v1/oauth/authorize` 是由该页面调用、且需要登录会话的 API，不应直接在浏览器地址栏打开。

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

分页参数因接口而异，请以具体接口的 API 参考为准。常见参数包括：

- `page`：页码，通常从 `1` 开始
- `pageSize`：每页条数
- 后端可能限制最大值，例如 `pageSize <= 100`

推荐写法：

```ts
const page = 1
const pageSize = 20 // 不要盲目传超大值
```

## 生成的 OpenAPI 规范访问

`GET /docs/openapi.json` 返回原始生成的 OpenAPI 文档，不使用通用响应包装。可信本地访问保留 `local-or-jwt` 认证行为。远程 JWT 访问需要 `DEBUG_OPENAPI_READ`；IAM 强制模式下，该资格必须来自真实部署全局组，并允许 `quyan:system:GetOpenApiSpecification` 对 `acs:platform:*:platform:system/openapi-spec` 的访问。

路径和 Action 由服务端固定，查询参数和 Header 不能选择其他文件或授予权限。读取过程中授权或当前角色会话失效时，文档不会返回；匹配的 Deny 优先于 Allow。

## 错误处理建议

调用接口时应处理失败响应，并根据错误原因决定是否重试。

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

| `code` | 含义                           | 建议处理方式                           |
| ------ | ------------------------------ | -------------------------------------- |
| `0`    | 成功                           | 直接使用 `data`                        |
| `1001` | 认证失败                       | 提示重新登录                           |
| `1002` | 参数校验失败                   | 修正请求体/参数，不要重试              |
| `1003` | 资源不存在                     | 不要重试，展示”未找到”状态             |
| `1004` | 权限不足                       | 检查身份、授权和资源范围               |
| `1006` | Token 因用户信息变更或会话失效 | 重新登录或重新认证                     |
| `1013` | Token 已过期                   | 刷新 token 后重试一次                  |
| `1014` | Token 无效或伪造               | 不要重试，强制重新登录                 |
| `1017` | 重放保护校验失败               | 检查错误原因；会话失效时重新获取并签名 |
| `1018` | 需要二次验证                   | 完成 2FA 挑战后重试                    |
| `1048` | 密码加密公钥已失效             | 重新获取公钥、重新加密后重试一次       |
| `1429` | 请求过于频繁（限流）           | 按响应建议的重试等待时间再重试         |

业务状态码可能随版本增加；遇到未识别的 code 时，应作为业务失败处理并保留错误信息，不要臆测其具体含义。

### 重试建议

- 仅在处理了失败原因后重试，例如刷新有效会话、重新签名或等待限流恢复。参数、资源、权限或凭据错误需要先修正，不能靠立即重复请求解决。
- 遇到 `1429`（限流）时，应遵循响应中建议的重试等待时间，而不是立即重试。
- 限制自动重试次数并向调用方显示持续的错误。写操作若因网络中断而结果未知，先查询操作结果或使用接口支持的幂等机制，避免重复执行。

## 推荐阅读顺序

1. 先看本页获取基础地址和鉴权方式。
2. 再看 Swagger 确认具体字段。
3. 接入 OAuth 时继续阅读 [OAuth 应用管理]({{DOCS_BASE_URL}}/zh-CN/oauth-app-management)。
4. 使用程序化凭证时阅读 [访问密钥管理]({{DOCS_BASE_URL}}/zh-CN/access-key-management) 或 [转发 Token 管理]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)。

## 相关页面

- [OAuth 应用管理]({{DOCS_BASE_URL}}/zh-CN/oauth-app-management)
- [访问密钥管理]({{DOCS_BASE_URL}}/zh-CN/access-key-management)
- [转发 Token 管理]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)
- [JSON 端点管理]({{DOCS_BASE_URL}}/zh-CN/json-endpoint-management)
