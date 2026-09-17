# 会话恢复 P0 回归排查：JWT 载荷解析与并行加载

## 结论与证据边界

已通过源码比对、真实前端请求链测试和本地生产产物浏览器复现确认：
**前端按不存在的嵌套 JWT 格式解析身份，`01d0b002` 又将该身份解析变成资料加载的前置条件，导致冷启动恢复在 HTTP 成功后仍被会话边界拦截。**

这是本地已复现的确定性缺陷，足以解释“登录成功后跳转到业务子站，全站显示会话加载失败”。
没有访问生产用户凭据、生产监控或线上发布记录，因此不声称已确认全部线上故障均由此导致，也不声称线上已经恢复。
浏览器验证为全请求拦截的 `.test` 虚拟站点，未向真实后端发送任何测试 Token。

## 四次生产合并的作用

以下日期为 Git 记录的合并时间（UTC+08:00），不是线上实际部署时间。

| 生产合并                                   | 合并时间            | 与此故障的关系                                                                                                                                                                           |
| ------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `9ef1b6ea831ce874a2612ddd3f7a53591b1dc390` | 2026-09-16 19:02:48 | 增加全局错误通知、调整请求错误处理及样式。未修正 JWT 身份解析；不是本次成功响应后缺少身份的直接触发改动。                                                                                |
| `8bc958b07a84f72d5b54984eda2ea7d96555f864` | 2026-09-17 00:36:34 | 过滤无害 ResizeObserver 通知。未改变本次故障涉及的身份提取和资料/权限加载顺序。                                                                                                          |
| `c6c05a9cfb2e043cc7175619a84008e88a3183a8` | 2026-09-17 20:23:26 | 除权限元数据拆分外，还引入 RouteAccessBoundary、保护路由守卫和 SessionRestoreError。将恢复失败显式展示为全站访问边界；此时仍先获取资料，再加载当前用户权限，不强制依赖 JWT 提取用户 ID。 |
| `01d0b00237db2ccb8a05e614902abca7c531ff66` | 2026-09-17 23:17:10 | 将资料和权限改为并行加载，先计算 `user?.id                                                                                                                                               |     | getUserIdFromToken(getAccessToken()) |     | currentUserId`，缺少身份立即抛错；使已有 JWT 解码缺陷成为冷启动必经阻断点。启动恢复 Promise 的复用进一步使守卫接收到同一个失败结果。 |

不能仅凭提交标题判定影响面：`c6c05a9c` 的改动明显超出“权限导入调整”。

## 实际数据链

### 后端签发

- `apps/backend/src/util/auth/index.ts`：`JWTUtil.generateToken` 直接签名 `{ ...payload, jti }`，由 jsonwebtoken 添加 `iat` / `exp`。
- `apps/backend/src/services/auth/auth.service.ts`：登录和刷新都传入顶层 `userId`、`updatedAt`、`status`；刷新返回 `access_token`，不返回用户资料。

### 前端旧逻辑

- `apps/frontend/src/utils/storageScope.ts`：`JSON.parse(claims.data)`，然后读取 `payload.data.userId` / `updatedAt`。
- `apps/frontend/src/stores/request.ts`：另写一份相同解码，读取自定义 `expiration`。
- 真实 Token 没有 `claims.data`；异常被解码函数捕获并返回 `null`。

### 故障顺序

1. 身份站登录成功，浏览器跳转业务子站，新的 JavaScript 上下文没有内存用户资料。
2. Cookie 刷新请求成功，收到标准 JWT。
3. 前端未能从 Token 读出身份，也不能依据身份恢复相应资料缓存。
4. 并行加载逻辑在请求 `/users/me` 和用户权限之前抛出 `Unable to resolve the authenticated user id`。
5. 路由守卫捕获异常，RouteAccessBoundary 展示“会话加载失败”。

因此网络面板中已经发出的请求可以全部成功，而关键资料请求根本没发出。
本地旧产物复现时可见刷新、签名材料和心跳请求成功，但未发出资料/用户权限请求。
当前开发分支的等价错误为 `SessionRestoreError(profile)`，内部原因是 `Missing session identity`。
仅增加重试或清缓存无法修复确定性的载荷解析错误。

该缺陷同时导致 `exp` 未被识别，影响提前刷新；`updatedAt` 未被识别，影响授权版本和按用户缓存恢复。

## 修复边界

运行时代码仅修改认证数据解码的三个文件：

1. 新增 `apps/frontend/src/utils/jwt.ts`，唯一解码实现，只接受 JSON 对象载荷，正确处理 UTF-8 / Base64URL。
2. `storageScope.ts` 从顶层读取 `userId` / `updatedAt`，严格检查字符串类型，不强制转换无效身份。
3. `request.ts` 复用解码并读取有限数值 `exp`；新 Token 无有效过期时间时清除上一 Token 的期限。

未绕过资料或权限请求、未放宽路由授权、未修改服务端 JWT 格式、未增加令牌持久化或记录敏感载荷。
后端 Controller/DTO/schema 没有变更，无需 OpenAPI 再生成。
这是既有登录流程的缺陷修复，不新增用户工作流；同步开发认证文档，不新增 docs-site 功能页面。

## 为什么已有测试未发现

原会话和请求工具测试手工构造了 `{ data: JSON.stringify({ data: {...}, expiration }), type: 'access' }`。
这恰好符合错误的客户端实现，却不符合后端签发格式；会话测试还模拟了用户和权限 Service，缺少真实传输链覆盖。

修复后统一测试 Token 工厂到 `tests/helpers/access-token.ts`，使用后端实际顶层字段。
新增 `session-transport.dom.test.ts`，只用 Axios adapter 模拟 HTTP 响应，保留真实生成客户端、请求拦截器、Service、Store、Coordinator 和路由守卫。
后台心跳及签名材料获取在该测试中隔离；生产浏览器复验覆盖真实签名材料流程。

## 本地验证

- 修复前，将测试 Token 从嵌套格式改为后端顶层格式，真实链路稳定失败于 `Missing session identity`。
- 修复前的已有生产产物，使用顶层 JWT，在 Chromium 中复现原样错误页及 `Unable to resolve the authenticated user id`。
- 精确测试：JWT 解码、过期时间、会话、真实传输链、守卫、请求拦截器共 6 文件、69 测试通过。
- 前端 `pnpm --filter @quyan/frontend run type-check` 通过。
- 前端 `pnpm --filter @quyan/frontend run build:only:production` 通过。
- 新生产构建在相同浏览器夹具下成功请求资料和权限，进入账户中心，未出现控制台警告或错误。
- 变更文件的定向 ESLint、Prettier 和 `git diff --check` 通过；未执行全仓测试、全仓构建或 precommit。

旧产物为工作区已保存的性能 baseline，未独立验证其制品来源或校验和，不能将其称为某个生产提交的精确发布包。
四个提交的归因依据为各自 first-parent diff 及相关源码；未为四个提交分别做完整构建/上线测试。

## 发布与验收

- P0 热修复应限制在上述三个运行时文件及对应测试，不需要将未完成的全仓整理或其他性能重构一并上线。
- 当前修改基于开发分支；已额外生成 `tmp/session-incident/production-hotfix.patch`，仅包含上述三个运行时文件，并在从 `01d0b002` 提取的隔离源码快照上通过 `git apply --check` 和实际应用。此检查仅证明补丁可应用，不代表已经在生产分支完成构建或线上验收；不要直接覆盖整个请求文件。
- 发布采用新的完整前端产物；核对 HTML 引用的新资源版本和 CDN 缓存，不能只替换少量分包。
- 在授权的真实账户上验收：登录后跨子站跳转、直接访问保护页、整页刷新、Token 到期后的请求，以及无权限路由仍被拒绝。
- 不复制或索取完整 JWT/Cookie；线上对照只需脱敏异常栈、请求路径/状态、时间和部署版本。

以上发布/线上验收尚未执行。
