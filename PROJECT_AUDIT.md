# AppServerMonorepo 项目问题排查报告

> **生成时间**：2026-08-28 ｜ **分支**：`dev` ｜ **HEAD**：`0ce5a9b`
> **排查方式**：全量 `pnpm run type-check`（通过）+ 三路并行深度探查（后端 / 前端 / 拓扑与工程化）+ 人工复核全部 P0/P1 关键结论。
> **使用方式**：后续对话可直接引用问题编号（如 `P1-4`）讨论；修复阶段按第四节路线图分批执行。

---

## 一、执行摘要

**总体评价：工程质量明显高于平均水平，属于"骨架优秀、局部肥胖"。**

- 代码卫生极佳：后端 + 前端 **0 处 TODO/FIXME、0 处 @ts-ignore**（非生成代码）、仅 4 处 eslint-disable；全仓库 5 个 workspace 项目 `type-check` 全绿。
- 架构纪律好：后端分层（Controller → Service → Repository）有 ESLint 自定义规则硬约束；前端分层（View → Composable → Service → 生成 client）模式统一；测试有完整 taxonomy 与分类配置。
- 但存在**一个仓库状态级 P0**（子模块 gitlink 未提交）、**三项后端安全问题**（prod seed 弱口令、用户对话内容泄漏到 stdout、资金路径吞错）、**两个业务域的结构性肥胖**（后端 relay 域 4 个 2000+ 行 service、前端 relay 域 3.1 万行 + 五个 2~3k 行巨型 composable），以及**文档与实际的大面积漂移**（AGENTS.md 的数字几乎全部过时）。

### Top 问题速览

| 编号  | 级别   | 问题                                                                                              | 位置                                                                            |
| ----- | ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P0-1  | **P0** | `integrations/remote-agent` 子模块 gitlink 未提交，`.gitmodules` 与索引不一致，所有克隆永久脏状态 | 仓库根                                                                          |
| P1-1  | P1     | prod seed 内置默认超管弱口令 `admin123` 并打印密码                                                | `apps/backend/prisma/seed.prod.ts:30,52`                                        |
| P1-2  | P1     | AI Provider 用 `console.log` 打印用户对话内容到 stdout（敏感信息泄漏）                            | `apps/backend/src/services/chat/ai-provider.service.ts:349`                     |
| P1-3  | P1     | 资金路径退款失败被静默吞掉 `.catch(() => {})`                                                     | `apps/backend/src/services/developer/developer-product-platform.service.ts:948` |
| P1-4  | P1     | relay 域巨型 service 群：单文件 5,321 行 / 154 个方法，4 个 service 超 2,000 行                   | `apps/backend/src/services/relay/`                                              |
| P1-5  | P1     | store 层反向依赖 service 层（层次倒置）+ 1,973 行"神文件" repository（HTTP/邮件/加密混杂）        | `apps/backend/src/store/`                                                       |
| P1-9  | P1     | 前端 relay 巨型 composable 群（5 个共约 11.8k 行，最大 2,983 行且零测试）                         | `apps/frontend/src/views/relay/`                                                |
| P1-10 | P1     | 776 行 HTTP 客户端实现内嵌在 Pinia store 文件里                                                   | `apps/frontend/src/stores/request.ts:240-1015`                                  |
| P1-15 | P1     | AGENTS.md / CLAUDE.md / docs 结构树与统计数字全面漂移（虚构 3 个不存在的包）                      | 仓库根 + `docs/development/`                                                    |

---

## 二、仓库拓扑总览

### 实际结构（已核实）

```
AppServerMonorepo/
├── apps/
│   ├── backend/    @appserver/backend   Express + TSOA + Prisma (port 10001)
│   ├── frontend/   @appserver/frontend  Vue 3 + Element Plus + Vite
│   └── docs-site/  @appserver/docs-site Vue 3 文档站点
├── packages/
│   ├── shared/     @appserver/shared    前后端共享契约（唯一规范源）
│   └── appserver-mcp/  @appserver/mcp   给 AI 代理用的 stdio MCP（bun 直跑）
├── integrations/                        # git submodule，刻意不在 workspace 内
│   ├── server-sdk/    Quyan-ServerSDK   第三方 OAuth 接入 SDK
│   └── remote-agent/  Quyan-RemoteAgent 独立 pnpm workspace（agent-protocol / remote-agent / remote-mcp-bridge）
├── products/
│   └── remote-terminal-cloud/  Quyan-RemoteTerminalCloud（Rust + Tauri 远控终端客户端）
├── deployment/     nginx 反代示例（ai / api）
├── scripts/        仓库级编排脚本（7 个，无坏链）
└── docs/development/  详细开发文档（14 篇）
```

**依赖关系**：

```
@appserver/backend  ──workspace:*──▶ @appserver/shared
@appserver/frontend ──workspace:*──▶ @appserver/shared
@appserver/mcp      （独立，无内部依赖；pnpm run mcp:serve 启动）
shared              （零依赖）
integrations/*、products/*  → git submodule，自管安装，不进 workspace
```

**主耦合带是 OpenAPI**：TSOA 从 65 个 Controller 生成 swagger.json → 同步到前端 → @hey-api/openapi-ts 生成 `src/client/`（前后端均 gitignore 生成物，CI 重建）。

**部署单线化于 backend**：`deploy.yml` 在 master push 时 rsync 到 SSH 主机 → 远端 `prisma migrate deploy` + PM2 cluster。前端与 docs-site 无自动化部署工作流。

> ⚠️ AGENTS.md 中的结构树与上述实际结构不符（见 P1-15）：它虚构了 `packages/utils`、`packages/config-typescript`、`packages/config-prettier` 三个不存在的包，且完全遗漏 `packages/appserver-mcp`、`integrations/`、`products/`、`deployment/`。

---

## 三、问题清单

### P0 — 仓库状态损坏

**[P0-1] `integrations/remote-agent` 子模块 gitlink 未提交**

- **证据**（已人工复核）：`.gitmodules`（已提交）注册了 3 个子模块，但 `git ls-tree HEAD integrations/` 只有 `integrations/server-sdk` 一个 gitlink；`git submodule status` 不列出 remote-agent；`git status` 永久显示 `?? integrations/remote-agent/`。该目录内是带真实 `.git/` 的独立克隆。
- **影响**：全新克隆执行 `git submodule update --init --recursive` 会失败/跳过 remote-agent；仓库状态永久脏；README 的克隆说明对该目录失效。
- **建议**：在子模块内确认目标提交后 `git add integrations/remote-agent` 并提交 gitlink（可顺带 `git submodule absorbgitdirs` 统一管理）。

### P1 — 后端（`apps/backend`）

**[P1-1] prod seed 内置默认超管弱口令**

- 证据：`prisma/seed.prod.ts:30` `md5(md5("admin123"))` 创建超级管理员，`:52` 在控制台打印密码；`prisma/seed.ts:205-271` 同样含 `admin123/sysadmin123/editor123`。`db:seed:prod` 是正式 npm 脚本，人工误跑即留下弱口令 admin 账号。
- 建议：prod seed 强制从 env 读取密码或随机生成并要求首次登录改密。

**[P1-2] 用户对话内容泄漏到 stdout**

- 证据：`src/services/chat/ai-provider.service.ts` 共 9 处 `console.log`，其中 `:349` `console.log("[AIProvider] Yielding content:", content)` 把用户对话内容打到日志。项目有统一 logger（`util/logger`，65 处正确使用）。
- 建议：全部换 logger 并对内容脱敏/截断。

**[P1-3] 资金路径静默吞错**

- 证据：`src/services/developer/developer-product-platform.service.ts:948` `await this.refundQuota(receipt).catch(() => {})` —— 退款失败无日志无补偿。全仓 `.catch(() => {})` / `.catch(() => null)` 共约 37 处，多为通知类 fire-and-forget（可接受），但资金路径必须留痕。
- 建议：至少 `logger.error` + 落补偿/重试表。

**[P1-4] relay 域巨型 service 群（最大复杂度热点）**

- 证据（行数已核实）：`relay-proxy.service.ts` **5,321 行 / 154 个方法**、`relay-channel.service.ts` 3,296、`relay-channel-probe.service.ts` 2,119、`relay-token.service.ts` 2,008，合计约 1.3 万行。
- 建议：relay-proxy 按"协议适配 / 流式转发 / 故障转移 / 配额计费"拆子模块；拆分同时解决测试缺口（见 P1-8）。

**[P1-5] 层次倒置与"神文件" repository**

- 证据：`src/store/billing/balance.repository.ts:5`、`src/store/developer/developer-project.repository.ts:12-14`、`src/store/relay/relay-proxy.repository.ts:9,12` 等 6 处 repository 反向 import `@/services/*`（文件级循环依赖目前为 0，但持续膨胀有风险）。`developer-project.repository.ts` **1,973 行**，在 store 层做 HTTP 调用（axios、百度地理编码）、发邮件（nodemailer）、裸开 mysql2 连接、AES 加密。
- 建议：副作用上提到 service 层；神文件拆成 repository + 独立 geo/email/outbound 工具。

**[P1-6] 14 个外键列缺覆盖索引（数字已用脚本修正）**

- 证据：自写脚本扫描 `prisma/schema.prisma`（120 个 model），按 MySQL 复合索引前缀规则统计，**95 个含外键模型中共 14 个 FK 列无任何覆盖索引**。热点：`AgentTask.conversationId / relayTokenId`、`AgentApproval.stepId / decidedBy`、`RelayChannelProbeProfile.relayChannelId`、`ContentSafetyUserConfig.userId`、`DeveloperPushDelivery.channelId`、`DeveloperProductInstance.backingProjectId`、`McpCredential.serverId`、`RemoteTerminalEntitlementToken.entitlementId` 等。MySQL 不会自动为 FK 建索引，缺索引会在 join 与级联删除时全表扫描。
- 验证脚本：`tmp/check-fk-index.mjs`（node tmp/check-fk-index.mjs，可复跑）。
- 建议：为 14 个 FK 补 `@@index`（一个 Prisma migration 即可），低频字段（如 reviewedByUserId）可豁免并注释理由。

**[P1-7] 生产 dependencies 混入工具依赖 + alpha 版核心框架**

- 证据（已核实，均在 `dependencies` 段）：`depcheck`、`tsc-alias`、`tsx`（scripts 全用 bun，0 引用）、`@types/ioredis@^4`（ioredis v5 自带类型，属过时冲突源）；`crypto-js`、`helmet` 在 src 中 **0 引用**；`tsoa@^7.0.0-alpha.0`（alpha 版承载全站路由生成）。
- 建议：移除/移入 devDependencies；`helmet` 要么接入 `app.use(helmet())` 要么删除；评估 tsoa 换 stable 并锁精确版本。

**[P1-8] 巨型 service 测试缺口**

- 证据：relay 域 5 个巨型 service 约 1.3 万行仅 16 个测试文件；`external-auth.service.ts`（1,156 行）0 个直测文件；contract 测试仅 2 个文件。
- 建议：拆分时同步补测试；契约型项目补齐 contract 测试。

**其他后端发现（P2 级）**：非空断言 `!.` 约 448 处（集中在 controller 的 `request` 取值，建议 TypedRequest 辅助）；`as any` 约 67 处（eslint 关闭了 no-explicit-any）；未启用 type-aware lint（no-floating-promises 缺位）；`src/routes/` 空目录、`tests/unit/util` 与 `tests/unit/utils` 并存；md5 遗留弱哈希已有 bcrypt 自动升级迁移路径（`auth.service.ts:548`，可接受）；schema 无 Prisma enum（状态约束全靠应用层）；权限存 JSON 字符串列而非关系表。

### P1 — 前端（`apps/frontend`）

**[P1-9] relay 巨型 composable 群（前端最大债务）**

- 证据（行数已核实）：`useRelayTokenManagement.ts` **2,983 行（零测试）**、`useRelaySettingsManagement.ts` 2,760、`useRelayChannelProbeManagement.ts` 2,251、`useRemoteTerminalManagement.ts` 2,162、`useMonthlyPassManagement.ts` 1,681，合计约 11.8k 行；`views/relay` 独占 31,154 行（全前端非生成代码约四分之一）。
- 建议：按抽屉/表格/批量操作/配额窗口拆 composable + 子组件；仓库已有 `appserver-vue-view-splitting` 技能可直接套用。

**[P1-10] HTTP 客户端实现内嵌 Pinia store**

- 证据（已核实）：`src/stores/request.ts` 共 1,046 行，`class MyAxios` 在 `:240-1015`（776 行，token 刷新/2FA 跳转/JWT 解析全在内），`defineStore` 直到 `:1016` 才出现。
- 建议：MyAxios 抽到 `src/utils/http/`，store 只留响应式状态。

**[P1-11] 巨石组件与超长内联模板**

- 证据（行数已核实）：`AsideMenu.vue` **3,011 行**；`RelaySettingsChannelDialogs.vue` 模板 1,616 行（全文件 1,903）；`RelayTokenEditDrawer.vue` 模板 1,247 行；`TransactionHistory.vue` 模板 768 行。
- 建议：每个 dialog/drawer 独立成文件；AsideMenu 按分区/拖拽/搜索拆分。

**[P1-12] content-safety 与 support 域绕过 service 层**

- 证据：6 个文件直接调用生成 client（两域均无 `*Service.ts`）：`ContentSafetyManagementPanel.vue:328`、`ContentSafetyIncidentTable.vue:131`、`ContentSafetySettingsView.vue:308`、`SupportAssistantPanel.vue:82`、`SupportAiConfigView.vue:84`、`SupportAiAnalyticsView.vue:84`。其余 96 处 client 引用均为类型导入，属正常。
- 建议：补 `contentSafetyService.ts`、`supportService.ts`，统一单例 + cacheObject 模式。

**[P1-13] 死依赖与死代码（已逐一核实 0 引用）**

- 证据：`@tanstack/vue-query`（仅 `src/config/vueQuery.ts` 自嗨，`setupVueQuery` 无任何调用方）、`heatmap.js`、`github-markdown-css`、`nvm@^0.0.4`（npm 占位伪包）。另有 `xterm@5.3.0` 已停止维护（官方迁 `@xterm/xterm`）。
- 建议：`pnpm remove` 四者并删除 `src/config/vueQuery.ts`；xterm 择期迁移。

**[P1-14] 分页/表格状态重复造轮子**

- 证据：5 个最大 composable 中 `src/composables/usePagination.ts` 引用数为 0，各自手写分页状态。
- 建议：拆分时统一接入现有 composable。

**其他前端发现（P2 级）**：`BalanceScriptDialogV1/V2` 双版本共存（V1 291 行刻意保留回退）；`emoji.ts` 假语言包 5,207 行与中英文同步维护三份；`as any` 约 71 处（NavMenuItems 7 处、AsideMenu 5 处）；`routes.ts` 1,313 行/129 条路由单文件；路由守卫只做认证不做路由级权限（`meta` 无 permission 字段，权限拦截全靠组件级 PermissionWrapper + 后端兜底）；`src/events/` 空目录与 2 个一次性迁移脚本遗留；约 18/63 service 无测试。

### P1 — 拓扑、文档与工程化

**[P1-15] 文档与实际全面漂移**

- **结构树虚构**：AGENTS.md（L32-36）与 CLAUDE.md（L20-24）声称 `packages/` 下有 `utils`、`config-typescript`、`config-prettier` —— 实际不存在；遗漏 `packages/appserver-mcp`、`integrations/`、`products/`、`deployment/`。
- **统计数字过时**（→ 为实际核实值）：Controllers 47→**65**；Services 56→**80**；Prisma 模型 68→**120**；Permission 130+→**196**；CustomCode 30+→**48**；NotificationEvent 25→**28**；前端 Stores 11→**13 个 defineStore**；事件总线"6 个"→实际 **3 个单例**（i18n/window/aprilFools）。
- **docs/development 内部自相矛盾**：`README.md` 说 47 Controllers/71 模型/135+ Permission，`02-backend.md` 说 47/56，`05-database.md` 说 68，与根文档三者互不一致。
- 建议：数字改为模糊描述（"数十个/百+"）或一次性校正；结构树按第二节重写。

**[P1-16] 根文档链接到未被 Git 跟踪的项目级文档**

- 证据：`apps/backend/.gitignore`、`apps/frontend/.gitignore` 均忽略 `/*.md` 与 `CLAUDE.md`（`git ls-files` 确认未跟踪），但根 README/AGENTS.md 链接它们 —— 新克隆 404。
- 建议：`git add -f` 纳入跟踪，或移除链接。

**[P1-17] 文档引用不存在的文件**

- 证据：`docs/development/09-deployment.md:229` 链接 `deployment/nginx/appserver-spa.conf.example`，该文件不存在（目录只有 ai/api 两个示例）。
- 建议：补文件或改链接。

**[P1-18] `packages/shared` 的测试永不执行**

- 证据：`packages/shared/src/relay-model-availability.test.ts` 存在，但 shared 无 `test` 脚本、无 vitest 依赖；后端 vitest include 只覆盖 `tests/**`；CI 不跑。
- 建议：shared 加 vitest devDep + test 脚本并入 CI，或把测试移入 `apps/backend/tests/unit`。

### P2 — 工程化杂项汇总

| #     | 问题                                                                                                                        | 证据                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| P2-1  | `.gitignore` 中的 `pnpm-lock.yaml` 是死条目且自相矛盾（文件已被跟踪，CI 全靠 `--frozen-lockfile`）                          | `.gitignore:8`                                                |
| P2-2  | CI 对 `packages/` 零覆盖：shared 的 lint、mcp 的 lint + `bun test`（4 个测试文件）从不执行                                  | `.github/workflows/quality-check.yml`                         |
| P2-3  | quality-check 路径过滤器不含根级工程化文件（eslint/prettier/cspell/commitlint/husky/scripts 改动不触发任何检查）            | `quality-check.yml:38-58`                                     |
| P2-4  | `CD:check:*` 未被 GitHub Actions 引用，但仍可能被 EdgeOne 等仓外构建平台引用，不能直接删除                                  | `package.json`、`scripts/check-cd-changes.mjs`                |
| P2-5  | lint-staged 不覆盖 `packages/**`，shared/mcp 提交时不做 ESLint                                                              | `lint-staged.config.js`                                       |
| P2-6  | 根 `spell:check` 会扫进两个子模块全部文本，且未接入 CI/precommit                                                            | `cspell.json` ignorePaths 缺 `integrations/**`、`products/**` |
| P2-7  | `.npmrc` `shamefully-hoist=true` 削弱依赖隔离（死依赖因此不易暴露）                                                         | `.npmrc`                                                      |
| P2-8  | `apps/backend/package.json` 缺 `engines.node`（根/frontend/docs-site 均有），且重复声明 `packageManager`                    | backend package.json                                          |
| P2-9  | 本地残渣：`tmp/`（已忽略）、`scripts/sql/` 空目录、`logs/`、`.vitest-report.json`(184KB)                                    | 各处                                                          |
| P2-10 | README CI/CD 小节过时（说"deploy-\*.yml 各应用独立部署"，实际只有 backend 的 deploy.yml；缺 ai-pr-review/auto-pr 等工作流） | `README.md:208`                                               |
| P2-11 | AGENTS.md"详细文档"表缺 `14-domain-deployment.md`                                                                           | `AGENTS.md:195-210`                                           |
| P2-12 | 根 `tsconfig.json` 实际只被 appserver-mcp extends（名为仓库根配置实为 mcp 专属基座，语义易误解）                            | `tsconfig.json`                                               |
| P2-13 | `deployment/nginx` 缺前端 SPA 示例；前端/docs 部署无任何 CI 自动化                                                          | `deployment/`                                                 |

---

## 四、建议修复路线图

按"低风险高收益先行、结构重构殿后"排序；每阶段附验证命令。

### 阶段 0：状态与安全速修（小改动，立即收益）

1. **P0-1** 提交 remote-agent 子模块 gitlink。
2. **P1-1** prod seed 改为 env 强制读取/随机密码。
3. **P1-2** ai-provider 的 9 处 console.log 换 logger + 脱敏。
4. **P1-3** refundQuota 吞错改为 logger.error + 补偿落库。
5. **P2-1** 删 `.gitignore` 的 `pnpm-lock.yaml` 行。

- 验证：`pnpm --filter @appserver/backend type-check` + 相关单测；`git status` 干净。

### 阶段 1：依赖大扫除 + 死代码（纯删除，风险低）

1. 后端：移除 `crypto-js`、`helmet`（或接入）、`tsx`、`tsc-alias`、`depcheck`、`@types/ioredis`、`body-parser`、`@types/multer` → 移入 devDependencies/删除。
2. 前端：移除 `@tanstack/vue-query` + 删 `src/config/vueQuery.ts`、`heatmap.js`、`github-markdown-css`、`nvm`。
3. 清理已确认无外部引用的死目录/死脚本：`src/routes/`、`src/events/`、一次性迁移脚本；`CD:check:*` 需先核对 EdgeOne 等仓外构建平台配置。

- 验证：`pnpm run check:backend` + `pnpm run check:frontend`。

### 阶段 2：文档校正（消除对人与 Agent 的误导）

1. 重写 AGENTS.md / CLAUDE.md 结构树；统计数字改模糊描述。
2. 补 `docs/development` 三处矛盾数字；README CI/CD 小节更新。
3. 处理 P1-16（跟踪或去链）、P1-17（补 nginx spa 示例）、P1-18（shared 测试接入）。
4. CI 补 packages job 与根工程化文件路径过滤（P2-2/2-3/2-5）。

### 阶段 3：数据库索引补齐

1. 按 `tmp/check-fk-index.mjs` 输出为 14 个 FK 补 `@@index`（低频字段豁免）。
2. `pnpm --filter @appserver/backend exec prisma migrate dev --name add-fk-indexes`（迁移必须走该命令生成）。

- 验证：受影响 API 测试 + 复跑验证脚本归零。

### 阶段 4：结构重构（收益最大、工作量最大，需在对话中确定拆分方案）

1. 后端：relay-proxy.service（5,321 行）按职责拆模块；developer-project.repository 神文件拆分；store→service 反向依赖上提。
2. 前端：relay 巨型 composable 群拆分（套用 `appserver-vue-view-splitting` 技能）；`request.ts` 抽出 MyAxios；AsideMenu 拆分；content-safety/support 补 service 层。
3. 同步补测试（拆一块测一块）。

---

## 五、待讨论决策点（供后续对话）

| #   | 决策                                             | 选项/说明                                                         |
| --- | ------------------------------------------------ | ----------------------------------------------------------------- |
| D-1 | remote-agent gitlink 何时提交（P0-1）            | 立即提交 / 与其他改动一起提交                                     |
| D-2 | relay-proxy.service 拆分粒度                     | 按协议适配/流式/故障转移/计费四模块，或先抽 controller 辅助层过渡 |
| D-3 | BalanceScriptDialogV1/V2 取舍                    | V1 是否还有真实用户依赖，可否直接退役                             |
| D-4 | emoji 假语言包（5,207 行）去留                   | 保留完整 / 降级为部分覆盖 + fallback                              |
| D-5 | 是否引入路由级权限（meta.permission + 守卫校验） | 当前靠组件级 + 后端兜底；引入是行为变更，需评估深链体验           |
| D-6 | tsoa 7.0.0-alpha.0 是否升级 stable               | 评估 alpha 与 stable 的 breaking 差异                             |
| D-7 | helmet 接入还是删除                              | 接入属安全增强（可能影响 CSP/上传），删除属依赖瘦身               |
| D-8 | 路由级权限、seed 弱口令等涉及行为变更的项        | 修复前需确认运维流程（seed 是否已在生产跑过）                     |

---

## 六、本次排查执行的验证记录

| 验证项         | 命令                                                                                                                                   | 结果                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 全仓库类型检查 | `pnpm run type-check`                                                                                                                  | ✅ 5 个 workspace 项目全部通过          |
| 子模块状态     | `git ls-tree HEAD integrations/`、`git submodule status`                                                                               | ❌ 证实 P0-1（remote-agent 无 gitlink） |
| 关键文件行数   | `wc -l`（relay-proxy 5,321 / request.ts 1,046 / AsideMenu 3,011 / useRelayTokenManagement 2,983 / developer-project.repository 1,973） | ✅ 全部核实                             |
| 统计数字       | find/grep/awk（controllers 65、services 80、models 120、Permission 196、CustomCode 48）                                                | ✅ 全部核实                             |
| 安全敏感点     | grep（seed.prod 弱口令、ai-provider console.log、helmet/crypto-js 零引用）                                                             | ✅ 全部核实                             |
| FK 索引覆盖    | `node tmp/check-fk-index.mjs`（初报 52 处系误报，修正为 **14** 处）                                                                    | ✅ 已修正并入库脚本                     |
| 死依赖         | grep 引用扫描（vue-query/heatmap.js/github-markdown-css/nvm/tsx/helmet/crypto-js）                                                     | ✅ 全部核实 0 引用                      |

**未执行的高成本检查**（按仓库测试选择工作流约定，本轮为只读排查不改动代码，故未执行）：全量测试、全量构建、precommit、OpenAPI 重新生成。进入修复阶段后按第四节各阶段的范围要求执行。

---

## 附录 A：关键统计（核实值）

| 维度           | 数值                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| 后端手写 TS    | 约 9.4 万行 / 481 文件（Controller 65、Service 80、Repository 54）     |
| 后端测试       | 162 文件（unit 132 / integration 20 / database 8 / contract 2）        |
| Prisma         | 120 model / 2,971 行单文件 / 52 迁移 / 304 @@index / 0 enum            |
| 前端非生成代码 | views 86,518 行（relay 域 31,154）/ locales 16,349 / components 13,400 |
| 前端测试       | 88 文件（dom + node 双环境，带 taxonomy 校验）                         |
| 共享包         | Permission 196 / CustomCode 48 / NotificationEvent 28                  |
| 类型检查       | 5/5 workspace 项目通过                                                 |
| 代码卫生       | 后端+前端 0 TODO / 0 @ts-ignore / 4 eslint-disable                     |

## 附录 B：数据来源说明

- 三路深度探查（后端 / 前端 / 拓扑）由并行只读代理完成，输出均给出路径级证据。
- 报告中所有 P0/P1 关键结论（结构树、行数、安全点、死依赖、FK 索引、统计数字）经主会话人工复核；**其中 1 处代理误报已修正**（外键缺索引 52 → 14，原统计未按 MySQL 复合索引前缀规则折算）。
- 验证脚本保留于 `tmp/check-fk-index.mjs`（tmp/ 已被 .gitignore 忽略，仅本地存在）。
