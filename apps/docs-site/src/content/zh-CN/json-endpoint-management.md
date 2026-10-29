# JSON 端点管理

JSON 端点用于发布可访问的 JSON 内容。每个端点可以公开访问、使用静态密码，或使用 Ed25519 数字签名保护。

编辑 JSON 时可切换可视化和代码模式。代码模式下先移开输入框焦点，确认没有解析错误再保存；有错误时保存可能提交之前的有效内容，而不是当前文本。快速模板会替换当前草稿。

## 访问地址

普通端点使用所属用户名隔离 slug：

```text
GET /v1/json/{username}/{slug}
```

拥有根 slug 权限的端点使用全局地址：

```text
GET /v1/json/{slug}
```

根 slug 只会从全局地址解析；用户名路径只会解析非根 slug。

## 访问模式

| 模式         | 用途                         | 请求方式                   |
| ------------ | ---------------------------- | -------------------------- |
| 公开         | 可公开分发的内容             | 直接 `GET`                 |
| 静态密码     | 简单的共享保护               | `X-Access-Password` 请求头 |
| Ed25519 签名 | 服务到服务或需要防重放的访问 | 签名请求头                 |

签名模式中，管理端只保存 Ed25519 SPKI PEM **公钥**。私钥只能由调用方保管，不能上传或写入前端配置。

在编辑表单中选择签名模式并生成密钥对后，先从弹窗复制或下载私钥并安全保存；关闭弹窗后无法再次从该弹窗取回。生成操作只填写表单中的公钥，还需保存端点才能生效。更换已用公钥前，请确保调用方能够使用新私钥；保存成功后用新密钥验证访问。

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
- `nonce`：每次请求都生成新的 base64url 随机字符串，建议至少 16 个字符。相同端点内的 nonce 只能使用一次。
- 签名使用 base64url 编码，不能使用普通 base64。

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
console.log(await response.json())
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
console.log(await response.json())
```

## 所需权限

| 操作             | 所需权限                  |
| ---------------- | ------------------------- |
| 查看端点         | `JSON_ENDPOINT_READ`      |
| 新建端点         | `JSON_ENDPOINT_CREATE`    |
| 编辑端点         | `JSON_ENDPOINT_UPDATE`    |
| 删除端点         | `JSON_ENDPOINT_DELETE`    |
| 使用根 slug      | `JSON_ENDPOINT_ROOT_SLUG` |
| 管理其他用户端点 | `JSON_ENDPOINT_MANAGE`    |

## 相关页面

- [API 文档]({{DOCS_BASE_URL}}/zh-CN/api-documentation)
- [文章管理]({{DOCS_BASE_URL}}/zh-CN/article-management)
