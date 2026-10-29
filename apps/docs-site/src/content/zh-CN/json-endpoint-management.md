# JSON 端点管理

JSON 端点管理用于创建、编辑和删除 JSON 分享端点，并设置公开、静态密码或 Ed25519 签名访问。使用产品实例和产品 Key 发布内容时，请同时参见 [JSON 端点产品]({{DOCS_BASE_URL}}/zh-CN/developer-product-json-endpoint)。

## 进入页面与所需权限

登录核心管理站，打开 JSON 端点管理页面（`/content/json-endpoints`）。页面入口要求 `json_endpoint:read`；能看到列表或编辑按钮不代表具备提交修改的权限。

| 操作              | 产品权限与授权说明                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------- |
| 查看自己的端点    | `json_endpoint:read`                                                                      |
| 新建自己的端点    | `json_endpoint:create`                                                                    |
| 编辑自己的端点    | `json_endpoint:update`                                                                    |
| 删除自己的端点    | `json_endpoint:delete`                                                                    |
| 使用或切换根 slug | 额外需要 `json_endpoint:root_slug`                                                        |
| 管理其他用户端点  | 旧授权模式使用 `json_endpoint:manage`；IAM 强制模式仍需具体操作和资源授权，范围限同一账号 |

IAM 强制模式下，列表、详情、新建、更新、删除、所属用户选项和根 slug 使用独立动作，见下文。请让管理员按任务授权，不要把管理权限理解为可跨所有账号访问。

## 创建和编辑端点

1. 点击新建，填写名称、URL slug、可选描述和 JSON 内容。新建表单默认公开，内容为 `{}`。
2. 名称为 1～100 个字符；slug 为 1～100 个小写字母、数字、下划线或连字符；描述最多 500 个字符。有管理权限时可选择所属用户，有根 slug 权限时可选择全局路径。
3. 核对地址预览和访问方式。需要保护时，关闭公开访问并完成密码或签名设置。
4. 点击“确认”，成功后在列表核对，再使用实际访问方式测试地址。

选择已有端点的“编辑”可修改名称、描述、内容和访问方式，不能修改 slug 或所属用户。切换根 slug 会改变访问路径，原路径不会自动重定向。新建若提示标识冲突，请更换 slug；已删除端点的标识也可能仍被占用。

编辑器支持可视化和代码模式。代码模式需先移开文本框焦点并修正解析错误，再确认保存；外层保存不会因解析错误自动禁用，可能提交此前的有效内容。快速模板直接替换草稿。建议根值使用对象或数组；字符串、数字等根值可能显示为 `{}`，请先通过 API 核对实际内容。

编辑表单直接使用最近一次加载的列表内容，打开时不会再获取最新详情。多人编辑前应先刷新列表；保存是整体更新，不提供草稿版本合并。关闭抽屉会清除未保存内容，需要保留时先复制。清空描述后保存会省略该字段，不能用这个操作保证移除已有描述。

桌面版提供查看 JSON、复制地址、编辑和删除；“查看 JSON”显示已加载的管理数据，不是一次新的分享请求，也不能验证密码或签名。手机版点击条目进入编辑，没有桌面列表的查看、复制和删除按钮，需要这些操作时使用桌面版。

列表无分页和自动刷新，页面标题数量是当前已加载的可见条目数。管理权限下的所属用户筛选会重新加载列表。加载失败可能保留旧数据；先成功刷新，再操作，空列表也不能单独证明部署中没有端点。

## 配置访问保护

- **公开访问**：任何知道地址的人都可读取。切换为公开并保存会清除原密码或公钥配置；再次切回保护模式时需要重新配置。
- **静态密码**：关闭公开访问，选择静态密码并设置 4～100 个字符的密码。同一密码模式下编辑时留空会保留原密码；从公开或签名切入时必须提供新密码。密码不会回显。调用方通过 `X-Access-Password` 请求头传入，不要放在 URL 中。
- **Ed25519 签名**：关闭公开访问，选择签名模式，填入 Ed25519 SPKI PEM 公钥或在浏览器生成密钥对。切换模式会移除另一模式的凭据；更换公钥前先协调调用方。

签名私钥由调用方保管。生成后先复制或下载 PKCS#8 PEM 私钥，关闭弹窗后无法再次取回；生成只填写表单中的公钥，还需确认保存才生效。浏览器生成依赖安全上下文和 Ed25519 Web Crypto 支持。私钥丢失时应生成新密钥对、更新公钥并分发新私钥。

保护只限制分享读取，不替代管理 API 的权限检查，也不会撤回已经下载或缓存的内容。直接打开受保护 URL 不会出现网页登录表单，必须携带相应请求头。

## 删除与结果核对

桌面列表点击“删除”并确认后，端点停止提供分享内容，页面不提供恢复功能。超时或报错时操作可能已完成，先刷新并核对原地址，不要直接重复新建或删除。

删除产品关联的端点不会同时删除产品实例，但会使该实例的内容读取和编辑失败。删除整个产品实例则会撤销 Key 并清理关联端点。仅需限制分享时优先设置访问保护；停用产品实例不会关闭分享地址。

## 访问地址

普通端点使用所属用户名隔离 slug：

```text
GET /v1/json/{username}/{slug}
```

拥有根 slug 权限的端点使用全局地址：

```text
GET /v1/json/{slug}
```

根 slug 只会从全局地址解析；用户名路径只会解析非根 slug。将路径与当前部署的 API 地址组合，优先使用页面复制的地址。切换根路径后需更新调用方，旧路径不会重定向。

## 访问模式

| 模式         | 用途                         | 请求方式                   |
| ------------ | ---------------------------- | -------------------------- |
| 公开         | 可公开分发的内容             | 直接 `GET`                 |
| 静态密码     | 简单的共享保护               | `X-Access-Password` 请求头 |
| Ed25519 签名 | 服务到服务或需要防重放的访问 | 签名请求头                 |

## Ed25519 签名规则

签名模式仅保护 `GET` 请求。客户端以 UTF-8 编码以下五行内容，并使用 Ed25519 私钥签名：

```text
GET
<pathname>
<canonical-query>
<unix-seconds>
<nonce>
```

- `pathname`：例如 `/v1/json/alice/config`，不含域名和查询字符串。
- `canonical-query`：将全部查询参数解码后，分别使用 `encodeURIComponent` 编码键和值，拼为 `key=value`，按完整字符串升序排序，以 `&` 连接。没有查询参数时为空行。
- `unix-seconds`：当前 Unix 秒级时间戳，服务端允许正负 5 分钟偏差。
- `nonce`：每次请求生成新的 16～256 个字符的 base64url 随机字符串。服务端在同一端点的 5 分钟占用窗口内拒绝重复 nonce，重试也必须生成新值。
- 签名使用 base64url 编码，不能使用普通 base64。

签名原文使用四个换行符连接这五行，不在最后追加换行。保留重复查询参数及空值；没有查询参数时第三行仍保留为空行。签名服务依赖 Redis，不可用时拒绝访问。

请求必须携带：

```text
X-Json-Timestamp: <unix-seconds>
X-Json-Nonce: <nonce>
X-Json-Signature: <base64url-ed25519-signature>
```

## Node.js 20+ 示例

将管理页面下载的 PKCS#8 PEM 私钥保存到调用方的受保护文件系统后，设置以下环境变量：

```text
JSON_ENDPOINT_URL=https://api.example.com/v1/json/alice/config?locale=zh-CN
JSON_ENDPOINT_PRIVATE_KEY_PATH=/secure/path/json-endpoint.ed25519.pem
```

将以下代码保存为 `signed-request.mjs`，在已设置上述环境变量的终端中运行 `node signed-request.mjs`。`.mjs` 后缀使 Node.js 将文件作为 ES 模块执行；请将示例地址和私钥路径替换为实际值。

```js
import { readFile } from 'node:fs/promises'
import { createPrivateKey, randomBytes, sign } from 'node:crypto'

const endpoint = new URL(process.env.JSON_ENDPOINT_URL)
const privateKeyPem = await readFile(process.env.JSON_ENDPOINT_PRIVATE_KEY_PATH, 'utf8')

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&')
}

const timestamp = String(Math.floor(Date.now() / 1000))
const nonce = randomBytes(24).toString('base64url')
const payload = [
  'GET',
  endpoint.pathname,
  canonicalQuery(endpoint.searchParams),
  timestamp,
  nonce,
].join('\n')

const signature = sign(
  null,
  Buffer.from(payload, 'utf8'),
  createPrivateKey(privateKeyPem),
).toString('base64url')
const response = await fetch(endpoint, {
  headers: {
    'X-Json-Timestamp': timestamp,
    'X-Json-Nonce': nonce,
    'X-Json-Signature': signature,
  },
})

if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
const result = await response.json()
if (result.code !== 0) throw new Error(result.message || 'API request failed')
console.log(result.data.data)
```

## 浏览器 Web Crypto 示例

浏览器调用必须先满足目标服务的 CORS 配置，并在支持 Ed25519 Web Crypto 的安全上下文中运行。私钥不应嵌入公开网页；只应从用户受控的安全存储或一次性导入流程取得。以下 `privateKeyPem` 是占位符，运行前须用安全导入的 PKCS#8 PEM 私钥替换，并将地址替换为实际端点。

```js
const endpoint = new URL('https://api.example.com/v1/json/alice/config?locale=zh-CN')
const privateKeyPem = '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, '')
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function base64Url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&')
}

const privateKey = await crypto.subtle.importKey(
  'pkcs8',
  pemToArrayBuffer(privateKeyPem),
  { name: 'Ed25519' },
  false,
  ['sign'],
)
const timestamp = String(Math.floor(Date.now() / 1000))
const nonceBytes = crypto.getRandomValues(new Uint8Array(24))
const nonce = base64Url(nonceBytes)
const payload = [
  'GET',
  endpoint.pathname,
  canonicalQuery(endpoint.searchParams),
  timestamp,
  nonce,
].join('\n')
const signature = base64Url(
  await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(payload)),
)

const response = await fetch(endpoint, {
  headers: {
    'X-Json-Timestamp': timestamp,
    'X-Json-Nonce': nonce,
    'X-Json-Signature': signature,
  },
})
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
const result = await response.json()
if (result.code !== 0) throw new Error(result.message || 'API request failed')
console.log(result.data.data)
```

## 管理 API 与细粒度授权

管理 API 使用 `/v1/json-endpoints`：列表为 `GET`，创建为 `POST`；单端点详情、更新和删除使用 `/{id}` 的 `GET`、`PUT`、`DELETE`。更新或删除依赖管理授权，不通过分享密码或 Ed25519 签名取得权限。受防重放保护的管理请求由控制台自动签名，机器集成请按 API 契约配置。

IAM 强制模式下，`quyan:json_endpoint:ListEndpoints` 决定列表可见性；列表响应包含 JSON 内容，因此应按内容读取能力授予。详情需要独立的 `GetEndpoint`，修改需要 `UpdateEndpoint`，删除需要 `DeleteEndpoint`。端点资源为 `acs:json-endpoint:*:<accountId>:endpoint/<ownerUserId>/<endpointId>`，同一账号内可按端点委派，不能跨账号访问。

新建在所属用户资源 `acs:quyan:*:<accountId>:user/<ownerUserId>` 上检查 `CreateEndpoint`；新建为根 slug 还需同一用户资源上的 `SetRootSlug`。已有端点切换根 slug 时，在端点资源上额外检查 `SetRootSlug`。所属用户选项使用独立的 `ListEndpointOwners` 授权。角色会话到期、撤销、身份停用或策略变更后，原先可见的操作可能不再允许。更多策略规则见 [RAM 管理]({{DOCS_BASE_URL}}/zh-CN/ram-management)。

## 响应、访问统计与常见问题

分享读取成功返回统一响应信封，JSON 内容在 `data.data`，同层还有 `slug`、`ownerUsername`、`publicUrl` 和 `lastUpdated`。产品 Key 读取响应使用 `data.jsonContent`，不能混用解析方式。

分享读取通过认证后会异步记录访问次数及最后访问时间；它们不是独立访客数、完整审计或计费次数。访问统计更新也可能改变 `lastUpdated`，不能仅凭该时间判断内容已改。分享与管理入口不经过产品 Key 的调用计量，产品 Key 读写按产品规则计量。

| 现象                           | 排查方法                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------- |
| 列表加载失败但仍有记录         | 可能是旧数据，重新刷新成功后再编辑；打开编辑不会自动重新读取详情              |
| 保存成功但 JSON 不符           | 修正代码模式解析错误后重新保存，并通过 API 核对实际结果                       |
| 密码模式无法访问               | 确认传入 `X-Access-Password`，不要使用产品 Key 或签名私钥代替密码             |
| 签名失败或 nonce 已用          | 检查实际路径、全部查询参数、时钟、公钥和 base64url 编码；每次请求生成新 nonce |
| 签名服务暂不可用               | 联系管理员检查 Redis，服务不可用时不会放行签名访问                            |
| 保存或删除提示冲突或资源不可用 | 保留草稿，刷新核对其他修改及最新权限，再重试；不要据此认定资源一定不存在      |
| 原分享地址不再存在             | 检查端点是否删除、根路径是否切换，以及用户名和 slug 是否正确                  |

## 相关页面

- [JSON 端点产品]({{DOCS_BASE_URL}}/zh-CN/developer-product-json-endpoint)
- [API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)
