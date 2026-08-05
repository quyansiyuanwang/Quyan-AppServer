---
name: appserver-frontend-development
description: 实现或审查 AppServerMonorepo Vue 前端改动。涉及页面、组件、Pinia Store、Service、Composable、路由、Element Plus、i18n、浏览器状态或前端测试时使用；适用于 UI 缺陷、前端 API 集成、权限页面和响应式行为。
---

# 前端开发

编辑前端前，优先使用 MCP `repo_context` 与 `git_impact` 获取摘要；需要原文证据时再读取 `AGENTS.md`、`apps/frontend/AGENTS.md`、`apps/frontend/CLAUDE.md` 和 [KNOWLEDGE.md](KNOWLEDGE.md)。

## 工作流

1. 编辑前定位所属 View/Component、Service/Store、路由、locale key 与相邻测试。
2. 保持 `View/Component -> Service 或 Pinia Store -> generated client -> stores/request.ts -> backend` 数据流。
3. 禁止编辑 `apps/frontend/src/client/`；通过 OpenAPI 重新生成。
4. 业务逻辑放在 `src/service/`，共享响应式状态放在 Pinia Store；路由访问同时由路由元数据和权限检查控制。
5. 复用 request store 的 JWT 注入、刷新、进度、重放请求头与 custom-code/event-bus 处理。
6. 同步维护 `zh-CN`、`en`、`emoji` 的 locale key。
7. 沿用 Element Plus 与现有响应式模式；客户端检查不能掩盖服务端的授权失败。
8. 后端契约变更时执行 `pnpm run openapi:gen:all`，再执行最小相关 Node/DOM 测试和 `pnpm --filter @appserver/frontend run type-check`。
9. 所有可能持续增长的表格、记录列表和资源列表必须使用服务端分页或等价的分段加载；维护页码、每页条数和总数，翻页/改页大小重新请求，并在增删改后刷新列表。仅有明确上限的静态列表可免除分页。
10. Relay 混池编辑按服务端 `channelTopologyMode` 构建候选与保存载荷：legacy 普通混池保留 `poolMembers` 并允许移除成员；strict 普通混池以 `pooled-member` 和 `pooledParentId` 批量绑定；自动代理池只保存逻辑 `pooled` 成员。父混池选项使用分页读取，管理接口为空或失败时回退完整详情接口，并重置旧选项和可见加载/空/失败状态。

## 边界

- 不得新增绕过 `stores/request.ts` 的第二套 HTTP/认证客户端或浏览器直连调用。
- 不得通过管理 DTO 或浏览器过滤推断敏感 Relay 拓扑。
- 不得把一次性拉取全部记录后在浏览器本地切片当作可增长列表的分页实现。
- 生成 API/shared 权限变更使用 `appserver-contracts`；测试环境选择使用 `appserver-testing-ci`。
