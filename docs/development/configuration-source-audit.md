# 全仓配置、常量与唯一事实来源审计

## 结论

**完成一轮覆盖主仓和已检出的全部三个子模块的静态扫描、跨来源比对和逐领域人工核查。确认 22 组待治理问题，其中 C01–C04 应优先处理。检查完成不等于整改完成，也不是“仓库已无硬编码问题”的保证。**

审计基准：主仓 `3bf8a294e750868e2099ebe7a3d276d88a745e7f`（已经包含 JWT P0 修复）。本轮不修改运行时代码、不执行 seed/部署、不修改子模块或暂存区；仅添加审计报告和开发文档索引。既有 P0 修复保留。

P1 表示已确认来源不一致或执行入口脱节，具有功能/部署风险；P2 表示已确认重复来源或散落策略，未必已有用户可见故障。不是把每一项都认定为安全漏洞或 P0。

## 范围、方法与限制

通过 Git index 枚举跟踪文件，并递归识别 gitlink，不用手维护“待扫描应用清单”。扫描 URL、接口路径、权限/scope 字面量、状态、分页、超时/重试等，再读取上下文判断语义。关键词命中只是候选，不直接计为缺陷。

| 仓库/区域                                                | 跟踪普通文件数 | 核查重点                                                      |
| -------------------------------------------------------- | -------------: | ------------------------------------------------------------- |
| 主仓全部                                                 |           2075 | 包含以下四应用、packages、脚本、CI、部署、文档及根配置        |
| `apps/backend`（主仓子集）                               |            832 | env/领域常量、Controller/DTO/schema、Service/Repository、seed |
| `apps/frontend`（主仓子集）                              |            792 | 站点/导航/产品、Service/Store、表单默认值、分页、性能工具     |
| `apps/docs-site`（主仓子集）                             |            291 | 构建入口、文档注册、语言、知识生成                            |
| `apps/cli-native`（主仓子集）                            |             35 | 配置、认证协议、服务与发布契约、内联测试                      |
| `packages/shared` / `packages/appserver-mcp`（主仓子集） |        24 / 17 | 规范数据源与消费者、profile 注册                              |
| `integrations/remote-agent`                              |             14 | 协议包、Agent runtime 和配置                                  |
| `integrations/server-sdk`                                |             29 | 各语言 OAuth 实现、环境配置及示例                             |
| `products/remote-terminal-cloud`                         |            108 | Rust crates、桌面/安装器、平台路径和发布入口                  |
| **主仓 + 子模块合计（不重复计应用子集）**                |       **2226** | 全部纳入文件清单                                              |

子模块版本分别为 `f5c9a4ff`、`61d898ad`、`d6866fc7`。统计自动分为源码/配置候选 1560、测试/夹具 303、文档/资源/翻译 290、生成/锁文件/迁移 73；Rust 内联测试会被初步归到源码，人工核查时另行排除。

- 纳入 CI/workflow、正式脚本、构建配置、部署示例，不只查 `src` 或性能脚本。
- 不检查被 Git 忽略的依赖、构建产物、私有环境文件、临时排查数据或外部运行中的配置；不对生成 SDK 手工整改。`tmp` 仅用来保存本次扫描证据。
- 文档和示例中的固定值按说明用途审阅，不当作运行默认值。迁移历史、锁文件、协议/格式约定、测试输入和 CSS 尺寸不机械提取。
- 全范围扫描已做，人工确认集中于下列问题及相关消费者；**没有逐行证明所有文件无语义重复，也没有进行全仓动态验证、Git 历史密钥审计或线上配置审计。**
- 暂存/工作树状态在本轮核查前后检查；运行源码无本轮新增修改。

## 已确认问题

### C01 · P1 · 第一方站点清单重复维护且已漏站点

定位：

- `apps/backend/src/config/env/domain.ts:3`
- `scripts/setup-local-domains.mjs:16`
- `apps/frontend/vite.config.ts:99`
- `apps/frontend/src/config/site-catalog.ts:32`

**事实与风险：** 前端站点目录从产品 slug 构造子站，但本地 hosts/证书脚本、Vite allowedHosts、后端 firstPartyHostPrefixes 又各维护一份手写列表。三个列表均缺少现有产品 `json-endpoints.console`；脚本/后端各 21 项、Vite 20 项（legacy 本来就有部署差异，不能强行要求所有集合完全相同）。调用实际 `buildFirstPartyOrigins` 与共享产品表对照，确认缺失 JSON Endpoints 产品 origin。

**建议归属/推导方式：** 建立不依赖 Vue/图标的站点拓扑规范，产品部分从共享产品定义派生；以显式用途标签区分本地 hosts、开发 allowedHosts、可信回跳/CORS 等集合。后端不能导入前端 UI，也不能把缺口修成通配信任全部子域。开发端口与本地域名默认值按同一部署领域管理。

**整改验收：** 新增产品时集合覆盖测试；验证本地 DNS/证书 SAN、开发主机校验、精确信任 origin。实际线上是否被环境覆盖、是否已经导致请求失败，本轮未验证。

### C02 · P1 · Relay 管理表单的回退值已与后端默认值漂移

定位：

- `apps/backend/src/constant/relay-config.ts:3`
- `apps/frontend/src/views/relay/relay-settings/useRelaySettingsManagement.ts:353`
- `apps/frontend/src/views/relay/relay-settings/useRelaySettingsManagement.ts:385`
- `apps/frontend/src/views/relay/relay-settings/components/RelaySettingsPageDesktop.vue:471`

**事实与风险：** 后端 DEFAULT_RELAY_CONFIG 定义并发 3、队列超时 300000ms；前端初始化和读取缺失字段时使用并发 5、超时 30000ms。loadConfig 失败只提示错误，表单仍保留默认值；save 会把这些值写入载荷，桌面保存按钮没有配置加载成功的前置条件。这是已确认的定义差异和潜在覆盖路径，不是已确认发生过线上误写。

**建议归属/推导方式：** 服务端实际配置为权威。编辑表单应等待成功加载；失败后阻止保存，而不是用猜测值填充。若必须有共享的“创建默认值”，放在 Relay 配置领域，以返回配置或显式契约消费，不能给现存配置缺字段静默补另一套默认值。

**整改验收：** 分别覆盖配置成功、缺字段、任一并行请求失败、重试、保存；验证初始/失败状态不能发送默认配置覆盖服务端。

### C03 · P1 · 文档站存在两个可被加载的 Vite 配置入口

定位：

- `apps/docs-site/vite.config.ts:7`
- `apps/docs-site/vite.config.js:6`
- `apps/docs-site/tsconfig.node.json:13`

**事实与风险：** vite.config.ts 与提交到 Git 的 vite.config.js 同时存在，内容近似编译副本；tsconfig.node.json 仅包含 TS 文件。通过已安装 Vite 的 resolveConfig 实测，默认加载的是 vite.config.js。当前两份主要内容一致，但“改 TS、检查 TS、运行 JS”已经是可验证的入口分裂。

**建议归属/推导方式：** 只保留一个受维护、受检查的配置入口。防止类型检查再向源码旁输出 JS；核对 noEmit/输出目录和忽略规则。若有其他消费方明确需要 JS，则从 TS 生成到独立输出目录，而不是保持两个手写或可漂移入口。

**整改验收：** 清理后回读 resolveConfig().configFile；类型检查不再产生并列配置；验证实际 server/build 配置。

### C04 · P1 · 部署影响范围规则互相矛盾，漏掉共享依赖

定位：

- `.github/workflows/deploy.yml:6`
- `.github/workflows/deploy.yml:34`
- `scripts/check-cd-changes.mjs:3`
- `apps/backend/package.json:119`

**事实与风险：** check-cd-changes.mjs 将 packages/** 视为后端影响；deploy.yml 的 push.paths 不包含 packages/**，job 的 backend 过滤器又只有 apps/backend/\*\*。后端实际依赖 @quyan/shared。因此仅修改共享源码时该自动工作流不会因该改动触发；仅改 pnpm-lock.yaml 虽能触发 workflow，却不能让 backend 过滤器命中。手动部署或外部 CD 是否补偿，未验证。

**建议归属/推导方式：** 从 workspace/package 依赖得到应用影响范围，再在部署领域集中维护无法推导的构建/环境文件规则。GitHub workflow 的触发过滤和 job 过滤必须同步：可用宽触发加统一依赖判定，或从规范生成并校验静态过滤规则。不要把应用列表分散复制到更多脚本。

**整改验收：** 分别验证 backend、shared、lockfile、根构建配置、无关 docs 的变更样例；测试只计算计划，不触发部署。

### C05 · P2 · 产品目录存在多份完整枚举和 slug 映射

定位：

- `packages/shared/src/developer-product.ts:1`
- `packages/shared/src/developer-product.ts:22`
- `apps/frontend/src/config/site-catalog.ts:21`
- `apps/frontend/src/constant/developer-product-metadata.ts:14`

**事实与风险：** 共享包内部同时手写 DEVELOPER_PRODUCT_CODES 与 DEVELOPER_PRODUCTS；前端 site-catalog 再定义 ProductCode 联合类型、产品数组和 slug 条件分支，developer-product-metadata 也重复 code/urlSlug。新增产品要多处同步，C01 已说明这种维护方式的实际后果。

**建议归属/推导方式：** 共享产品描述表作为产品 code/slug 的唯一源，从它派生 code 类型、代码列表和查询。前端只维护按 ProductCode 校验覆盖性的 label/icon/导航权限等展示附加信息，站点从共享 slug 推导；不能把所有展示字段塞回共享包。

**整改验收：** 产品目录唯一性、code/slug 覆盖、站点路径和导航映射一致性测试；保持生成路由与懒加载边界。

### C06 · P2 · Project API Key scope 在 DTO、schema、Repository 重复

定位：

- `apps/backend/src/api/dto/developer/developer.dto.ts:1`
- `apps/backend/src/api/schema/developer/developer.schema.ts:6`
- `apps/backend/src/store/developer/developer-project.repository.ts:63`

**事实与风险：** DeveloperApiKeyScope 的联合类型、Zod scopes 数组和 PROJECT_KEY_SCOPES Set 分别维护相同的六个值；监控 HTTP 方法和响应匹配模式也在 schema 与 Repository 重复。类型存在不保证运行时列表完整。

**建议归属/推导方式：** 在开发者产品/项目密钥领域建立 scope 和监控能力定义，派生类型、Zod 校验、Set。Project Key scope 不应被替换成 RBAC Permission 或 OAuth 全部 scopes，它们是不同授权边界。

**整改验收：** 接受/拒绝 scope、方法与匹配模式边界测试；涉及 DTO/schema 时执行 OpenAPI 生成及契约验证。

### C07 · P2 · 系统 OAuth 客户端 seed、CLI 协议参数重复

定位：

- `apps/backend/src/constant/system-oauth-clients.ts:5`
- `apps/backend/prisma/seed.ts:503`
- `apps/backend/prisma/seed.prod.ts:83`
- `apps/backend/scripts/system-clients/seed.ts:30`
- `apps/cli-native/src/cli/handlers/auth.rs:18`

**事实与风险：** 已有 SYSTEM_OAUTH_CLIENTS，但两份 Prisma seed 仍手写 clientId/name/description；三处创建逻辑重复 callback、scopes、生命周期，Rust CLI 再定义 clientId/callback/scopes。还存在 seed.ts 的 update 不更新 scopes，而生产 seed/独立 seed 会更新的行为差异；需要确认这是有意策略还是漂移。三处 homepageUrl 仍是占位链接。

**建议归属/推导方式：** 系统客户端领域集中客户端定义及 seed 应用逻辑；创建与更新的差异必须具名且有测试。CLI 使用有版本的非敏感协议描述/生成产物或契约一致性测试，不手抄另一份。请求 scope 是明确的最小权限子集，不能直接请求共享 catalog 的全部权限。

**整改验收：** 三种 seed 的幂等性和授权范围测试；CLI 回调/clientId/scope 契约测试；不运行真实生产 seed。

### C08 · P2 · 状态规范已经存在，但仍有重复定义和裸数字

定位：

- `packages/shared/src/status.ts:1`
- `apps/frontend/src/constant/status.ts:4`
- `apps/backend/src/constant/status.ts:4`
- `apps/backend/src/services/agent/agent.service.ts:114`

**事实与风险：** 共享 MANAGED_STATUS 已定义 -1/0/1，前端 ACCOUNT_STATUS 又独立写同样值（ACTIVE 对应 ENABLED），部分 Agent/开发者服务仍直接写 status: -1 或 1。不能据此把所有 status 数字统一替换：后端 RECORD_STATUS.DELETED 为 0，BALANCE_ACCOUNT_STATUS 的 0 又表示未初始化，进程退出码也不是业务状态。

**建议归属/推导方式：** 先按实体/schema 确认语义；相同状态域复用共享值，别名从规范值派生。不同状态域保留独立命名定义，禁止全仓把 0 一律替换为 DISABLED。

**整改验收：** 按被改实体验证创建、禁用、软删除、查询过滤；不得改迁移历史或生成代码。

### C09 · P2 · 工单枚举绕过共享类型再次声明

定位：

- `packages/shared/src/ticket.ts:1`
- `apps/frontend/src/views/workspace/WorkspaceTicketView.vue:136`
- `apps/frontend/src/views/settings/TicketReviewManagementView.vue:472`
- `apps/backend/src/api/controllers/v1/ticket/ticket.controller.ts:75`

**事实与风险：** 共享包已有 TICKET_TYPES/TICKET_PRIORITIES/TICKET_WORKFLOW_STATUSES，后端 schema 已正确引用；前端工单提交/审核页面仍手写选项数组，Controller 查询参数重新列出联合类型。

**建议归属/推导方式：** 列表/类型从工单共享定义派生，界面翻译或排序用薄映射保留。Controller 使用生成器能够识别的共享类型；有意子集必须标明用途，不假装完整 catalog。

**整改验收：** 前后端枚举覆盖和过滤参数测试；修改 Controller 后按规则重新生成 OpenAPI。

### C10 · P2 · Relay 流缓冲限制未复用已有共享定义

定位：

- `packages/shared/src/relay-stream-config.ts:16`
- `apps/frontend/src/views/relay/relay-settings/useRelaySettingsManagement.ts:356`
- `apps/frontend/src/views/relay/relay-settings/components/RelaySettingsPageDesktop.vue:155`
- `apps/frontend/src/views/relay/relay-settings/components/RelaySettingsPageMobile.vue:300`

**事实与风险：** 共享包已有默认、最小、最大缓冲字节数，后端 schema 已引用。前端初始化和回退另写 2MiB，桌面/手机输入控件重复最小 0.25、最大 10（MiB）。

**建议归属/推导方式：** 从共享 DEFAULT/MIN/MAX_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES 派生显示单位，输入到字节的转换由领域 helper 统一。1024 是单位换算，不需要另建全仓数字常量。

**整改验收：** 最小/最大/默认值及字节↔显示单位转换测试；桌面/手机约束一致。

### C11 · P2 · 计费单位与缓存倍率已有定义但未统一消费

定位：

- `apps/backend/src/constant/pricing.ts:2`
- `apps/backend/src/services/support/support-ai.service.ts:858`
- `apps/frontend/src/components/balance/TransactionHistory.vue:1071`
- `apps/frontend/src/views/relay/relay-settings/useRelaySettingsManagement.ts:426`

**事实与风险：** 后端 pricing.ts 有 TOKEN_PRICE_DIVISOR 和缓存倍率；support-ai.service 仍直接除 1_000_000，前端 TransactionHistory 另定义 RATE_PER_MILLION_DIVISOR，Relay 表单重复 1.25/0.1 回退。并非所有“百万”数字都属于计费，例如微秒换算、展示缩写不能替换成计费常量。

**建议归属/推导方式：** 计费单位按 pricing 领域共享，应用侧 re-export 或消费；管理员实际价格/倍率以服务端返回值为准。保留金额精度、舍入规则和业务配置边界，不因集中管理改变计算方式。

**整改验收：** 原有计费/展示快照及临界舍入测试；确认迁移不改变账单金额。

### C12 · P2 · 特殊传输服务仍重复定义已有 API 路径

定位：

- `apps/frontend/src/service/replaySigningService.ts:14`
- `apps/frontend/src/service/errorReportService.ts:34`
- `apps/frontend/src/utils/tracker/index.ts:27`

**事实与风险：** 签名材料、错误上报、埋点服务直接写 /v1 路径，规范来源已经是后端 Controller 和按 Controller 生成的描述符。特殊 fetch/keepalive 传输本身不一定错误，但路径无需再手写。

**建议归属/推导方式：** 只引用所需 Controller 描述符的 url 或等价生成常量，保持原特殊传输的认证/生命周期语义；不可为消除路径字面量引入完整 endpoint registry，也不可让签名预取依赖自身请求拦截器而造成递归。

**整改验收：** 路径一致性、启动依赖图、签名引导和页面关闭上报测试；不得手改 src/client。

### C13 · P2 · 导航基础数据和认证页面分类仍有重复来源

定位：

- `apps/frontend/src/config/navigation-metadata.ts:300`
- `apps/frontend/src/layouts/AsideMenu.vue:1491`
- `apps/frontend/src/plugins/analytics.ts:7`
- `apps/frontend/src/app-runtime.ts:26`

**事实与风险：** 纯 navigation-metadata 已存在，但 AsideMenu 的部分分组继续重复相同 route/label/permission 数据（例如 ipMonitoring）；analytics 的 BLACKLIST 手写四个认证路径，而启动逻辑已经从 route.meta.isAuthEntry 推导。展示树结构、旧路由迁移表不一定可以一一合并。

**建议归属/推导方式：** 复用基础导航元数据，保留各展示树的局部布局；需要排除的页面由路由元数据或明确的 analytics eligibility 规则推导。旧 URL 兼容映射本身是需要维护的事实，不能从新路由反推出历史事实。

**整改验收：** 导航可见性/权限矩阵和认证页面埋点排除测试；维持路由懒加载。

### C14 · P2 · 列表分页策略重复散落

定位：

- `apps/frontend/src/views/relay/RedemptionCodeManagementView.vue:88`
- `apps/frontend/src/views/system/system-logs/components/SystemLogsApiTab.vue:29`
- `apps/frontend/src/views/system/DataLifecycleView.vue:16`

**事实与风险：** 多个列表重复 [10,20,50,100]、默认 pageSize 20、不同页面的特殊选项。扫描到 33 处 page-sizes 属性，但其中包含变量引用，不能把 33 当作重复硬编码数量；也不能把 overview 只展示若干项等用途并入分页默认。

**建议归属/推导方式：** 为常规管理列表定义默认分页策略，按业务域保留可解释的覆盖；服务端最大值继续由服务端 enforce。不要把动态资源的固定首批 100 条当作“全量数据”。

**整改验收：** 分页/修改 pageSize/总数/筛选重置测试，核对端点的实际上限。

### C15 · P2 · 前端进度与遥测传输策略仍有未命名/重复值

定位：

- `apps/frontend/src/stores/topLoadingProgressStore.ts:140`
- `apps/frontend/src/utils/http-client.ts:45`
- `apps/frontend/src/utils/http-client.ts:57`
- `apps/frontend/src/utils/tracker/index.ts:42`

**事实与风险：** 进度 store 的任务清理、延迟移除、完成驻留时长直接嵌在回调中；HttpClient 默认重试/超时与 Tracker 的显式配置重复 3000/2/1000。已有 loading-policy 已覆盖会话和预取，不代表其他领域已经治理。

**建议归属/推导方式：** 进度策略在进度模块集中；遥测 HTTP 的默认值和覆盖在遥测传输领域集中，Tracker 要么复用默认值，要么显式命名差异。不要把 UI 动画时长、认证超时、埋点重试全部塞到 loading-policy。

**整改验收：** fake timers 验证进度不提前消失/不挂起；遥测重试与队列上限测试。

### C16 · P2 · 后端探针和并发协调的调度策略散落在实现里

定位：

- `apps/backend/src/services/relay/relay-channel-probe.service.ts:1310`
- `apps/backend/src/services/relay/relay-concurrency.service.ts:109`
- `apps/backend/src/services/relay/relay-concurrency.service.ts:119`

**事实与风险：** 探针 start 直接写 5000ms 调度与一小时清理，并发等待循环直接写 100ms，租约心跳下限与比例写在方法内。已有 env/config 的其他超时不一定与这些值同义，不能按相同数字合并。

**建议归属/推导方式：** 探针调度、队列等待、租约续约各自按领域命名并推导单位；需要运营调整的值走既有 env/config 校验，纯内部策略留模块常量。安全与资源上限不能因为参数化而被任意关闭。

**整改验收：** 精确服务单测覆盖时钟、等待截止、后端故障和租约丢失；不为纯常量整理启动全套数据库测试。

### C17 · P2 · Rust CLI 默认 endpoint 存在重复回退

定位：

- `apps/cli-native/src/core/config.rs:19`
- `apps/cli-native/src/core/config.rs:32`
- `apps/cli-native/src/core/api.rs:36`
- `apps/cli-native/src/cli/runner.rs:137`

**事实与风险：** Config::default 内写 API/Relay/Auth 默认 origin，default_auth_base_url 又写 Auth origin，ApiClient::new 再写 API/Relay 默认地址。本次搜索到的正式 runner 使用 with_endpoints，因此这是已确认的重复定义，不是已确认用户配置被当前主流程忽略。TUI 测试中的相同地址不算生产重复。

**建议归属/推导方式：** 默认 endpoint 只在 core/config 领域定义；ApiClient 使用解析后的配置，冗余构造入口可删或委托。旧 public OAuth origin 是迁移匹配条件，应保留具名历史常量，不能随当前默认地址一起变化。

**整改验收：** 默认值、用户覆盖、环境覆盖、旧地址迁移和自定义地址保留测试。

### C18 · P2 · CLI 发布平台清单及制品限制重复维护

定位：

- `scripts/cli-native.ts:14`
- `scripts/cli-native.ts:19`
- `scripts/cli-native.ts:86`
- `.github/workflows/cli-native-release.yml:29`

**事实与风险：** scripts/cli-native.ts 同时手写 Target 联合类型与 targets 对象，release workflow 再维护平台矩阵；12MiB 限制在 package 和 verify 两处重复。Windows 本地 MSVC 与 Linux 交叉编译 GNU 是显式差异，不应误报为错误。

**建议归属/推导方式：** 从发布领域的目标描述派生 Target、参数校验和 CI matrix，保留按构建宿主/工具链选择；同一包内的制品上限只定义一次，文件名/扩展名从目标和 Cargo 版本派生。

**整改验收：** 无构建副作用的矩阵/文件名/size limit 单测；发布改动才执行各目标打包验收。

### C19 · P2 · MCP 检查 profile 名称与定义重复

定位：

- `packages/appserver-mcp/src/checks.ts:7`
- `packages/appserver-mcp/src/checks.ts:38`
- `packages/appserver-mcp/src/git.ts:93`

**事实与风险：** CHECK_PROFILES 数组与 CHECKS Record 同时列出检查名，两个 target-file 特例在分支维护；git 命令超时 30_000 多处重复。Record 已能约束部分静态一致性，尚未发现当前列表缺失。

**建议归属/推导方式：** 将检查定义（含 target-file 构造方式）登记在检查领域入口，从键派生名称/校验；git 操作超时在 git adapter 内命名。明确的命令白名单是安全边界，不应动态执行任意 package script。

**整改验收：** profile 枚举与 handler 完整性、target path 拒绝、命令参数测试。

### C20 · P2 · 文档语言和占位符支持集未完全派生

定位：

- `apps/docs-site/src/docs/types.ts:1`
- `apps/docs-site/scripts/generate-support-knowledge.mjs:10`
- `apps/docs-site/src/config/site.ts:15`
- `apps/docs-site/src/config/site.ts:22`

**事实与风险：** DocsLocale 联合类型与知识生成脚本的 locales 数组各自列出支持语言；site.ts 已有 tokenMap，却在正则里再枚举 APP_BASE_URL/DOCS_BASE_URL/SWAGGER_DOCS_URL。模块 index 的顺序数组是编辑顺序决策，不能简单判为多余。

**建议归属/推导方式：** 支持语言在 docs 领域建立可供构建和浏览器消费的最小元数据，类型/遍历派生；占位符匹配后只查 tokenMap 的 own keys，未知占位符原样保留。文档语言不必强行与主站 emoji locale 合并。

**整改验收：** 语言文件覆盖、知识索引完整性、已知/未知占位符和原型键输入测试。

### C21 · P2 · Remote Agent 子模块协议重复且未消费自身版本常量

定位：

- `packages/shared/src/agent.ts:30`
- `integrations/remote-agent/agent-protocol/src/index.ts:1`
- `integrations/remote-agent/remote-agent/src/index.ts:18`
- `integrations/remote-agent/remote-agent/src/index.ts:22`

**事实与风险：** 主仓 shared/agent.ts 与 remote-agent/agent-protocol 分别声明相同 runtime 消息结构；子模块已有 AGENT_PROTOCOL_VERSION，但 runtime hello 仍写 protocolVersion:1。runtime 内心跳/命令超时和缓冲容量也直接写在调用点。

**建议归属/推导方式：** 先复用子模块已有版本常量；以版本化协议包/语言无关描述或兼容性测试统一主仓与独立子模块契约，不能用跨仓相对源码导入破坏独立发布。运行策略在 Agent runtime 域集中，并核对已下发 limits 的实际约束。

**整改验收：** 主仓↔agent 消息 round-trip/版本拒绝测试；runtime 心跳和命令资源限制测试。子模块需独立提交，再更新主仓 gitlink。

### C22 · P2 · Remote Terminal Cloud 的平台日志路径重复实现

定位：

- `products/remote-terminal-cloud/apps/rtc-agentd/src/support.rs:31`
- `products/remote-terminal-cloud/apps/rtc-agent-installer/src/main.rs:225`
- `products/remote-terminal-cloud/apps/rtc-agent-desktop/src-tauri/src/lib.rs:1079`
- `products/remote-terminal-cloud/crates/rtc-agent-runtime/src/lib.rs:227`

**事实与风险：** agentd、installer、desktop 各自实现 managed_logs_dir，重复 ProgramData 回退、产品目录和 logs 拼接；非 Windows 分支还分别依赖配置/偏好目录，不能不核对就合并。runtime 已命名 WebSocket 主要阈值，但 watchdog 的 5 秒在两个参数重复写。

**建议归属/推导方式：** 复用该产品已有 rtc-agent-platform/config 领域，定义带平台语义的路径 helper；内部 watchdog 由单一 Duration 常量派生。保留自定义路径、旧安装迁移和跨平台差异，不把产品内部策略塞进主仓 shared。

**整改验收：** Windows/macOS/Linux 路径、自定义配置位置、安装/升级兼容及定时器测试；不运行真实安装器或移动用户日志。

## 明确不应机械整改的部分

1. **刚修复的 JWT：** 当前身份与过期时间已经复用 `utils/jwt.ts`，测试使用 `tests/helpers/access-token.ts` 的标准顶层 claims。历史重复解析造成了 P0，已在前一项工作修复，不重复计作本轮待修问题。
2. **性能正式工具：** `scripts/performance/` 目前只有 manifest 分析器和 README，读取真实 Vite 配置/manifest，基线和允许增幅需要显式输入。协议版本、指标列名是该报告格式自身的定义，不是应从业务页面猜测的数据。旧演示数据位于忽略的 `tmp`，没有恢复为生产基线。
3. **领域入口已经做得合理的部分：** `packages/shared` 的 Permission/CustomCode/OAuth scope catalog，前后端 re-export，`loading-policy.ts`、request 的认证策略、后端 env 分域配置、RTC config/runtime 的多数命名阈值，应继续消费，不另造总配置表。声明式实体/路由/文档元数据本身也需要一个规范来源，不能要求它“从不存在的来源推导”。
4. **数字相同不等于语义相同：** 业务状态、进程退出码、HTTP 状态、字节换算、微秒换算、计费单位、卡片数量不是一个领域。分包组件分组是明确的构建策略；若集中在构建入口且没有重复事实，不因数组较长就认定为硬编码缺陷。
5. **独立 SDK/示例：** server-sdk 各语言实现的认证地址和客户端身份来自环境配置；Node 客户端的默认超时已在实例创建处设置。Python/Java 示例的重复 timeout 可在各示例模块命名，但不应为了共享一个数字让独立可下载示例依赖主仓源码。协议字段如 `S256`、grant type 属于协议常量，不等同于部署参数。
6. **测试与临时脚本：** Rust `#[cfg(test)]` 中的 URL、回调和路径是夹具，不算运行时重复默认。`apps/cli-native/test_oauth_url.rs` 则是仓库根部独立 `main` 的复现程序，复制了实际 URL 构造逻辑；应移到临时区域或改为调用正式实现的回归测试，不把它当作契约验收证据。
7. **部署示例：** `deployment/nginx/*.conf.example` 明确使用示例域名、证书目录和 loopback upstream，不代表线上配置硬编码。可改成显式输入的部署模板并集中 upstream，但不能通过简单域名替换自动扩大 CORS/CSP 信任；SSE location 的差异应保留。没有执行 Nginx reload 或改动在线 CDN。
8. **生产 seed：** 已核对 `seed.prod.ts` 首次创建管理员使用随机密码及显式凭据文件，并非开发 seed 的固定演示口令；不能把开发夹具的搜索命中直接报告为线上固定密码。

## 推荐整改顺序与领域边界

1. **先修 C01–C04：** 站点覆盖、Relay 表单读取失败保护、文档站实际配置入口、部署依赖过滤。各自独立补回归测试，不合并成一次巨大重构。
2. **再消除契约副本：** C05–C12、C21。已有共享/生成来源优先复用；新增共享契约按领域拆分。DTO/Controller/schema 变更必须跑 OpenAPI 流水线。
3. **最后整理策略与工具：** C13–C20、C22。分页、进度、遥测、探针、租约、CLI 发布、MCP 各有自己的入口；同值但异义不能强行共用。
4. 对无法可靠推导的策略，用具名定义说明单位、含义和所有者；需要动态配置的走既有配置及校验，而不是把所有数字变成 env。
5. 后续防回归应添加有针对性的集合覆盖/一致性测试（如产品↔站点、发布依赖、默认值契约），不要用“禁止所有字面量”的 lint 规则制造误报。

## 本轮实际执行的检查

- Git 跟踪文件清单、子模块版本、工作区状态；临时清单保存在 `tmp/hardcoding-audit/inventory.json`，人工定位在 `evidence.json`。这两个文件是快照证据，不是正式运行配置。
- 搜索后逐项读取规范源和消费者，确认以上 22 组问题；记录了应保留的例外。
- 用实际 `buildFirstPartyOrigins` 与 `DEVELOPER_PRODUCTS` 对照，输出缺失的 `json-endpoints.console` origin；同时验证本地域名脚本/Vite 列表也缺该项。只运行纯配置函数，未启动服务器。
- 执行 `pnpm --filter @quyan/docs-site exec node --input-type=module -e "import {resolveConfig} from 'vite'; const c=await resolveConfig({mode:'development'},'serve'); console.log(c.configFile)"`，确认实际入口为 `vite.config.js`；未启动 dev server 或做构建。
- 新增报告和索引执行定向 Prettier、文件引用核验及 `git diff --check`。
- **未执行** 全仓测试、应用全量构建、`precommit`、数据库/seed、CLI 编译/安装、生产部署。这轮不修改运行行为，这些高成本/有副作用检查不能证明审计结论更多成立。

**当前状态：本轮审计完成；以上 22 组整改尚未实施。**
