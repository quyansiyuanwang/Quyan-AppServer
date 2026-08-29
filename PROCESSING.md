# 审计问题处理台账

> 来源：`PROJECT_AUDIT.md`（2026-08-28）。本文件用于逐项复核、修复和验收；每项完成后更新状态、证据和验证命令。

## 状态定义

- `待修复`：已确认存在，尚未完成。
- `进行中`：正在实施或等待本阶段验证。
- `已完成`：代码、文档和规定的精确验证均通过。
- `延期`：已确认存在，但根据当前决策暂不改变。
- `更正`：原报告路径或结论与当前代码不符，已重新定位或取消。

## 决策记录

| 决策                   | 当前结论                                         |
| ---------------------- | ------------------------------------------------ |
| 修复范围               | P0/P1/P2 全部纳入台账，按阶段处理                |
| `remote-agent` gitlink | P0-1 暂延期，不修改索引                          |
| 生产 seed 密码         | 随机生成，写入部署指定的一次性安全文件；不写日志 |
| 退款失败               | 结构化日志 + 持久化可重试补偿任务                |
| `helmet`/`tsoa`        | 接入 helmet；tsoa alpha 只做兼容性评估           |
| 结构重构               | 先建立职责边界和测试，再分批迁移                 |
| 项目级文档             | 强制纳入 Git 跟踪                                |
| SPA 部署文档           | 新增独立 `appserver-spa.conf.example`            |
| shared 测试            | shared 独立 Vitest 入口和 CI job                 |

## 阶段 0：状态与安全速修

| 编号 | 级别 | 当前证据                                                                    | 目标                                                | 状态   | 验证                                                     |
| ---- | ---- | --------------------------------------------------------------------------- | --------------------------------------------------- | ------ | -------------------------------------------------------- |
| P0-1 | P0   | `.gitmodules` 注册 `integrations/remote-agent`，HEAD 无 gitlink，目录未跟踪 | 保留现状并等待单独的子模块版本决策                  | 延期   | `git ls-tree HEAD integrations/`; `git submodule status` |
| P1-1 | P1   | `apps/backend/prisma/seed.prod.ts` 固定 `admin123` 并打印密码               | 随机强密码写入受限一次性文件，seed 幂等且不记录凭据 | 已完成 | backend type-check；凭据路径不含密码日志                 |
| P1-2 | P1   | `ai-provider.service.ts` 多处 `console.log`，包含流式正文                   | 使用项目 logger，仅记录可审计元数据                 | 已完成 | AI Provider unit tests；日志扫描                         |
| P1-3 | P1   | `refundQuota(receipt).catch(() => {})` 静默吞错                             | 落库可重试补偿任务，幂等执行并结构化告警            | 已完成 | Prisma migration `20260828232408_add_developer_product_refund_retries`；相关 unit tests 通过 |
| P2-1 | P2   | `.gitignore` 忽略已跟踪 `pnpm-lock.yaml`                                    | 删除冲突条目                                        | 已完成 | `git diff --check`                                       |

## 阶段 1：依赖、测试和 CI

| 编号  | 当前结论与动作                                                                | 状态   |
| ----- | ----------------------------------------------------------------------------- | ------ |
| P1-7  | 接入 helmet；清理生产依赖；tsoa alpha 单独评估                                | 已完成 |
| P1-13 | 删除无引用 vue-query、heatmap、github-markdown-css、nvm；保留实际使用的 xterm | 已完成 |
| P1-18 | shared 增加 Vitest 入口并在 CI 独立执行；补 mcp lint/test                     | 已完成 |
| P2-2  | 修正为“应用检查会被 packages 变化触发，但 shared/mcp 缺少独立检查”            | 已完成 |
| P2-3  | quality-check 增加根级工程文件过滤器                                          | 已完成 |
| P2-4  | 删除未被引用的 `CD:check:*` 脚本及实现                                        | 已完成 |
| P2-5  | lint-staged 覆盖 `packages/**`                                                | 已完成 |
| P2-6  | cspell 排除 `integrations/**`、`products/**` 子模块文本                       | 已完成 |
| P2-7  | 评估后移除 `shamefully-hoist=true`                                            | 已完成 |
| P2-8  | backend 补 `engines.node`，清理重复 package 元数据                            | 已完成 |
| P2-9  | 仅清理被 Git 跟踪的残留，不动用户未跟踪目录                                   | 待修复 |

## 阶段 2：文档与部署

| 编号  | 当前结论与动作                                                                               | 状态   |
| ----- | -------------------------------------------------------------------------------------------- | ------ |
| P1-15 | 校正根文档和 development 文档的结构树、统计和相互矛盾描述                                    | 进行中 |
| P1-16 | 强制跟踪 backend/frontend 项目级 `AGENTS.md`、`CLAUDE.md`                                    | 已完成 |
| P1-17 | 新增 `deployment/nginx/appserver-spa.conf.example` 并修正文档链接                            | 已完成 |
| P2-10 | 更新 README 的实际 CI/CD 工作流说明                                                          | 待修复 |
| P2-11 | 在根文档索引补充 `14-domain-deployment.md`                                                   | 待修复 |
| P2-12 | 将仅供 mcp 使用的根 tsconfig 调整为明确的 mcp 专用配置                                       | 待修复 |
| P2-13 | 补齐 SPA Nginx 示例；前端/docs 自动部署作为外部凭据依赖记录                                  | 待修复 |
| P1-12 | 原报告路径不存在；按当前 `components/support` 和 `views/relay` 实际调用点重新核查 service 层 | 已完成 |

## 阶段 3：数据库与性能

| 编号 | 当前证据                             | 目标                               | 状态   | 验证                                         |
| ---- | ------------------------------------ | ---------------------------------- | ------ | -------------------------------------------- |
| P1-6 | 当前脚本报告 14 个无覆盖索引的外键列 | 补 `@@index`，通过 Prisma 生成迁移 | 已完成 | `node tmp/check-fk-index.mjs`：0 个缺失；迁移 `20260828232408_add_developer_product_refund_retries` 已应用 |

## 阶段 4：结构重构与测试

| 编号  | 当前证据                                                           | 目标                                                  | 状态   |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------ |
| P1-4  | relay-proxy 5,321 行，另有 3 个 2,000+ 行 service                  | 保留 facade，按协议、流式、故障转移、计费边界分批拆分 | 待修复 |
| P1-5  | repository 反向依赖 service；developer-project repository 1,973 行 | 副作用上提，repository 仅持久化                       | 待修复 |
| P1-8  | relay 巨型 service 测试覆盖不足                                    | 随每个边界迁移补直接单测和契约测试                    | 待修复 |
| P1-9  | relay 巨型 composable 群，最大 2,983 行                            | 按页面区域、抽屉、表格、批量操作拆分                  | 待修复 |
| P1-10 | `request.ts` 内嵌约 776 行 MyAxios                                 | 抽到 `src/utils/http/`，store 只保留响应式状态        | 待修复 |
| P1-11 | AsideMenu 3,011 行及多个超长模板                                   | 拆成职责明确的子组件，保持路由和权限行为              | 待修复 |
| P1-14 | relay 页面重复手写分页状态                                         | 接入现有 `usePagination`，保持服务端分页              | 待修复 |

## 已更正或延期的审计结论

- 路由已存在大量 `meta.permission`，后续只审计覆盖率和守卫行为，不按“完全缺失”处理。
- `xterm` 在远程终端页面仍被使用，不列入删除项。
- CI 的 packages 变化会触发应用检查；缺口是没有 shared/mcp 自身的独立入口。
- `content-safety/support` 使用当前实际目录重新定位后再决定 service 拆分范围。
- BalanceScriptDialog V1/V2、emoji 完整语言包、tsoa 升级先保留，待兼容性/使用情况审计。

## 阶段验收记录

| 阶段 | 完成日期   | 命令与结果                                                                     | 备注                                                      |
| ---- | ---------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 0    | 2026-08-29 | backend AI/product unit tests；backend/frontend type-check；`git diff --check` | P1-1/P1-2/P2-1 已完成；本地数据库已允许并完成 reset                  |
| 1    | 2026-08-29 | shared test 3/3；MCP test 11/11；shared/MCP lint；CI 配置审阅                  | 依赖清理与入口已完成，CI 需远端 workflow 验证             |
| 2    | 2026-08-29 | 文档结构/统计复核；SPA 示例存在；项目级文档已解除 ignore                       | P1-16/P1-17 已完成；P1-15 和 docs-site 专项校验待继续     |
| 3    | 2026-08-29 | `prisma migrate reset --force`；`db:migrate:dev -- add-developer-product-refund-retries`；`prisma migrate status`；`node tmp/check-fk-index.mjs`；backend type-check；退款/AI Provider unit tests | 数据库重置后重新应用 52 个迁移；迁移状态 up to date；索引缺失 0；相关测试通过 |
| 4    | -          | -                                                                              | 结构重构待后续按边界逐块实施                              |
