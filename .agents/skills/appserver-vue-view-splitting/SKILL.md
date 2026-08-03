---
name: appserver-vue-view-splitting
description: 拆分 AppServerMonorepo 中体积过大或职责混杂的 Vue 3 View。需要将页面模板、抽屉、对话框、Tab、响应式状态或样式重组为相邻组件与 composable，且保持路由、i18n、权限和既有行为时使用。
---

# Vue View 拆分

## 工作流

1. 先读取目标 View、相邻已拆分页面、对应 Service、路由和测试；优先使用项目 MCP 的 `repo_context` 与 `git_impact` 获取摘要。
2. 按稳定的页面职责拆分概览、表单 Tab、详情抽屉和独立对话框。路由入口只负责创建状态、`provide` context、组合组件与导入页面样式。
3. 当多个局部组件共享大量响应式状态和操作时，建立 `context.ts` 与 `use<Feature>Management.ts`。composable 是状态、watch、生命周期和业务编排的唯一所有者；组件通过 `inject` 获取状态，避免大规模 props/emit 转发。
4. 将仅供页面使用的样式移到相邻的具名 SCSS 文件，保留现有 class、响应式断点和 Element Plus 选择器；不要将页面样式提升为全局通用样式。
5. 保持 Service -> generated client -> request store 数据流，禁止编辑 `src/client/`；保留原有 i18n key、权限判断、浏览器存储键和异步取消/轮询语义。

## 边界

- 不为一次性展示块创建 context；少量数据流优先使用明确 props/emit。
- 不借重构修改 API、路由、权限或文案。涉及这些契约时使用 `appserver-contracts`；涉及认证或敏感数据时使用 `appserver-security`。
- 新增或调整测试时使用 `appserver-testing-ci`，按 Node/DOM 真实依赖选择精确文件。

## 验证

- 为提取出的高风险 composable 或组件补充最小回归测试，并运行精确 Vitest 文件和前端 `type-check`。
- 检查没有循环依赖、遗留模板变量、未使用导入或重复状态所有者；执行 `git diff --check`。
