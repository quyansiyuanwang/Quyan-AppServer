## 前端目录

- 生成 API client：`apps/frontend/src/client/`，禁止编辑
- Pinia Store：`apps/frontend/src/stores/`
- 业务 Service：`apps/frontend/src/service/`
- View/Component：`apps/frontend/src/views/`、`apps/frontend/src/components/`
- 路由与语言：`apps/frontend/src/router/`、`apps/frontend/src/locales/`
- 测试：`apps/frontend/tests/node/`、`apps/frontend/tests/dom/`

## 请求与状态

- `stores/request.ts` 负责 Axios、access/refresh token 存储、刷新去重、进度与响应事件。
- Service 封装 generated client 调用，通常使用单例。
- `permissionStore` 计算组权限加额外权限减移除权限。
- 各业务 Store 持有共享响应式状态；不要在无关组件中复制。
- 事件总线在 `src/events/index.ts` 集中注册。

## i18n 与测试环境

使用 `i18ns.t`、`tref`、`tf` 或 `tc`，并保持 locale key 结构一致。纯 Node 的工具/Service/Composable 放入 `tests/node/`；依赖浏览器的 Store、Vue 组件与 DOM Composable 放入 `tests/dom/`，并在文件开头声明 `// @vitest-environment jsdom`。
