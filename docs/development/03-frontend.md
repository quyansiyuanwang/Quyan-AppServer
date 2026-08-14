# 03 — 前端详解

## 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3 (Composition API, `<script setup>`) | UI 框架 |
| TypeScript 5.9 | 类型安全 |
| Vite (Rolldown) | 构建工具 (rolldown-vite 7.x) |
| Pinia 3.x | 状态管理 |
| Vue Router 4.x | 路由 (HTML5 history mode) |
| Element Plus 2.13 | UI 组件库 (auto-import) |
| Tailwind CSS 4.x | 样式工具 |
| TanStack Vue Query | 异步状态/缓存 |
| Axios | HTTP 客户端 |
| @hey-api/openapi-ts | API 客户端代码生成 |
| Vue-i18n | 国际化 (zh-CN, en, emoji) |
| Zod | 数据校验 |
| ECharts | 图表 |
| @vueuse/core | Composition 工具集 |

## 组件层次

```
App.vue
  RouterView
    IndexApp.vue
      TopLoadingProgress          # 页面顶部进度条
      OverLay                     # 浮动控制 (主题/语言/文档链接)
      WaterMark                   # 水印文字
      RouterView (带过渡动画)
        Auth 页面 (无布局)
          LoginOrRegisterView
          ForgotPasswordView
          AuthVerificationView    # 2FA 验证
          CaptchaVerificationView
          OAuthAuthorizeView

        overLay.vue (认证布局壳)
          HomeFrameLayout.vue
            ImpersonationBanner   # 模拟提示横幅
            el-aside > AsideMenu > NavMenuItems  # 侧边栏导航
            el-main > <RouterView />              # 页面内容
              40+ 个认证页面...

        404View (catch-all)

      FloatingWorkspaceManager    # 浮动 iframe 工作区
      AprilFoolsController        # 彩蛋 (lazy-loaded)
```

## 目录结构 (`src/`)

| 目录 | 用途 | 是否可编辑 |
|------|------|-----------|
| `client/` | 自动生成的 OpenAPI 客户端 | **不可编辑** |
| `stores/` | Pinia stores (11 个) | 可编辑 |
| `service/` | 业务逻辑层 (30+ 个) | 可编辑 |
| `views/` | 页面组件 (按功能组织, 40+) | 可编辑 |
| `layouts/` | 布局组件 | 可编辑 |
| `components/` | 可复用组件 (25+) | 可编辑 |
| `locales/` | i18n 翻译文件 (3 种语言) | 可编辑 |
| `utils/` | 工具函数 | 可编辑 |
| `types/` | TypeScript 类型 | 可编辑 |
| `constants/` | 常量定义 | 可编辑 |
| `config/` | 应用配置 | 可编辑 |
| `schemas/` | Zod 校验 schema | 可编辑 |
| `events/` | 事件总线注册 | 可编辑 |
| `router/` | Vue Router 配置 | 可编辑 |
| `plugins/modules/` | 站点/功能插件契约、宿主与轻量功能清单 | 可编辑 |
| `plugins/sites/` | 按精确域名异步加载的站点插件入口 | 可编辑 |

## 数据流

```
View 组件
  → src/service/ (业务逻辑, 单例)
    → src/client/ (自动生成的 typed SDK)
      → stores/request.ts (Axios + JWT 拦截器)
        → Backend API (localhost:10001)
```

### API 层 (`stores/request.ts`)

核心 Axios 实例，管理所有 HTTP 请求：

- **JWT Token 管理**: access token 存储在 localStorage (`Authentication-AccessToken`)，refresh token 存储为 (`Authentication-RefreshToken`)
- **自动刷新**: 在 token 过期前 3 秒自动刷新，使用单 Promise 模式防止并发刷新
- **请求拦截器**: 自动注入 `Authorization: Bearer <token>` 头
- **响应拦截器**: 处理 401 → 触发 token 刷新 + 请求重试
- **进度条**: 所有请求自动关联顶部进度条动画
- **自定义代码处理**: 监听后端 `CustomCode`，触发事件总线（如 token 过期、权限变更）

### Service 层 (`src/service/`)

30+ 个 Service 文件，单例模式，封装 API 调用和业务逻辑：

| Service | 职责 |
|---------|------|
| `authorizationService.ts` | 登录、注册、登出、token 管理、会话启动（最大 19KB） |
| `userService.ts` | 用户 CRUD、资料更新 |
| `permissionService.ts` | 用户/组权限查询与分配 |
| `relayTokenService.ts` | 中转 token CRUD、批量操作、用量统计 |
| `chatService.ts` | 对话 CRUD、SSE 流式消息 |
| `systemService.ts` | 系统日志、统计、在线监控 |
| `impersonationService.ts` | 用户模拟会话 |
| `heartbeatService.ts` | 在线心跳（localStorage leader election） |
| `twoFactorService.ts` | 双因素认证门面（代理 3 个子服务） |
| `captchaDialogService.ts` | CAPTCHA 对话框/信任流程 |
| `ramService.ts` | RAM 子账户管理 |

### Pinia Stores (11 个)

| Store | 用途 |
|-------|------|
| `request.ts` | Axios 实例、JWT、拦截器（核心 store, ~35KB） |
| `permissionStore.ts` | 权限缓存、`hasPermission()` 等本地检查方法 |
| `chatStore.ts` | 对话列表、当前对话、消息流 |
| `userInfoStore.ts` | 用户资料（id, username, email, groupId） |
| `floatingWorkspaceStore.ts` | 浮动 iframe 工作区状态 |
| `topLoadingProgressStore.ts` | 顶部进度条任务管理 |
| `waterMarkTextStore.ts` | 水印文字状态 |
| `impersonationStore.ts` | 模拟会话 |
| `i18nStore.ts` | 语言切换 |
| `themeToggleStore.ts` | 暗色/亮色主题 |
| `isDesktopStore.ts` | 响应式断点检测 (768px) |

### 事件总线 (`stores/globalInstance.ts`)

6 个事件总线实例，实现跨组件通信：

| 事件总线 | 事件类型 | 用途 |
|----------|---------|------|
| `authEventBus` | TOKEN_REFRESHED, USER_LOGGED_OUT, etc. | 认证生命周期 |
| `webEventBus` | HTTP 状态码 (401, 403, etc.) | HTTP 错误处理 |
| `customCodeBus` | CustomCode 枚举值 | 后端业务错误码 |
| `i18nEventBus` | LOCALE_CHANGED | 语言变更 |
| `windowEventBus` | RESIZE | 窗口大小 |
| `globalEventBus` | FORBIDDEN, UNAUTHORIZED | 全局事件 |

事件注册在 `src/events/index.ts` 的 `registerAllEvents()` 中集中管理。

## 站点与功能模块

前端启动遵循“内核 → 站点插件 → 功能页面”的加载顺序：

1. `site-registry` 根据浏览器的精确 hostname 解析唯一站点；未知 hostname 不会推算为有效站点。
2. `AppRuntime` 初始化会话、Pinia、i18n、请求层和 Router 后，通过 `ModuleHost` 动态导入当前站点插件。
3. 站点插件延迟导入站点根组件与当前站点路由。页面组件继续使用 Vue Router 的异步 `import()`，因此其服务、局部 Store、图表和编辑器仅在进入页面时加载。
4. 功能清单只包含 route name/path 等元数据，是侧栏、全局搜索和路由可用性判断的共同来源；不得在清单中导入 Vue 页面、Service 或 Store。

新增站点时必须同时注册精确域名、`plugins/sites/<site-id>/site.ts` 和相应功能清单。新增页面必须保持异步组件加载，并注册为所属站点功能；禁止从 `main.ts`、`AppRuntime` 或通用布局静态导入页面模块。站点/功能运行时提供 `activate` 和 `dispose` 钩子，长连接、定时器和临时订阅必须在 `dispose` 中释放。

兼容迁移期间，既有 `routes.ts` 仍是路由记录适配器，但它仅由已选中的站点插件异步导入。构建阶段会拒绝将 `plugins/sites/` 或 `app-roots/domains/` 静态纳入入口图。

## 路由 (`src/router/`)

- `routes.ts` — 既有路由记录适配器，仅由当前站点插件按需导入
- `index.ts` — 路由实例 + 全局守卫

## 表格与列表分页

所有可能持续增长的表格、记录列表和资源列表都必须提供分页或等价的分段加载。优先使用服务端分页：组件保存当前页、每页条数和总数，翻页或调整每页条数时重新请求后端，并在创建、删除、取消等改变列表数据的操作后刷新当前页（必要时回到第一页）。只有数据规模有明确上限且不会增长的静态列表，才可以不分页；不能依赖浏览器一次性加载全部记录后再本地切片来代替服务端分页。

**路由守卫流程**：
1. CAPTCHA 预检（对 auth 页面）
2. 公开页面白名单（登录、注册、忘记密码、OAuth 授权）
3. 认证验证（`AuthorizationService.bootstrapSession()`）
4. 游客访问检查（`meta.allowGuest`）
5. 权限检查（`meta.permission`, `meta.anyPermissions`）
6. 失败时发出 FORBIDDEN/UNAUTHORIZED 事件

## i18n (`src/locales/`)

- 3 种语言：`zh-CN` (默认), `en` (懒加载), `emoji` (趣味模式，懒加载)
- 类型安全的翻译键（`I18nENAvailableKeys` 确保所有语言文件键结构一致）
- 辅助函数：`i18ns.t()`, `i18ns.tref()`, `i18ns.tf()`, `i18ns.tc()`
- 新增用户可见文案或后端 `messageKey` 时，同步维护 `zh-CN`、`en`、`emoji`；前端不能把未本地化的后端英文错误当作正式文案。

## Relay 混池编辑

- 保存、候选类型和删除控件必须按服务端 `channelTopologyMode` 分支：legacy 普通混池提交并编辑 `poolMembers`；strict 普通混池通过 `pooled-member.pooledParentId` 绑定物理成员；自动代理池始终提交逻辑 `pooled` 成员。
- 物理成员的管理列表展示其逻辑父混池，不把它当作逻辑混池显示零成员。可增长的父混池选项需分页读取；管理列表为空、分页异常或请求失败时，回退到完整渠道详情接口，并清理旧选项、展示加载/空/失败状态。

## 构建配置

- **打包器**: Rolldown (vite 7.x, 比 Rollup 更快)
- **最小化**: Terser (生产环境移除 console/debugger)
- **目标**: ES2018 (Chrome 63+, Firefox 58+, Safari 11.1+)
- **代码分割**: 按 node_modules 自动分包
- **压缩**: Gzip (>10KB 的文件)
- **混淆**: javascript-obfuscator (生产环境)
- **分析**: `stats.html` 构建产物分析

## 路径别名

`@` → `./src` (在 vite.config.ts 和 tsconfig 中配置)
