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
  code: number;
  message: string;
  data?: T;
}

export function unwrapApi<T>(response: ApiResponse<T>): T {
  if (response.code !== 0) {
    throw new Error(response.message || `API failed: ${response.code}`);
  }
  return response.data as T;
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
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
}

const API_BASE_URL = "https://api.qysyw.cn";

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const json = await response.json();
  if (json.code !== 0) throw new Error(json.message || "Request failed");
  return json.data as T;
}
```

### 2. OAuth 应用审核列表示例

```ts
export interface OAuthReviewItem {
  id: string;
  name: string;
  clientId: string;
  reviewStatus: "draft" | "pending" | "approved" | "rejected";
  reviewComment?: string;
}

export interface OAuthReviewListResponse {
  items: OAuthReviewItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listOAuthAppsForReview(token: string) {
  return apiRequest<OAuthReviewListResponse>(
    "/oauth-clients/review?page=1&pageSize=20",
    {
      token,
    },
  );
}
```

### 3. 审核操作示例

```ts
export async function reviewOAuthApp(
  token: string,
  id: string,
  reviewStatus: "approved" | "rejected",
  reviewComment?: string,
) {
  return apiRequest(`/oauth-clients/${id}/review`, {
    method: "POST",
    token,
    body: {
      reviewStatus,
      reviewComment,
    },
  });
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
GET https://api.qysyw.cn/oauth/authorize
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
curl -X POST "https://api.qysyw.cn/oauth/token" \
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
const page = 1;
const pageSize = 20; // 不要盲目传超大值
```

## 错误处理建议

不要只展示“成功示例”，还应展示失败时怎么处理。

```ts
try {
  const data = await listOAuthAppsForReview(token);
  console.log(data.items);
} catch (error) {
  console.error("Load failed:", error);
  // 建议这里做 toast、重试、降级提示、日志上报
}
```

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
