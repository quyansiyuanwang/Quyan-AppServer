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

## 路由 (`src/router/`)

- `routes.ts` — 扁平路由数组 (~16KB)，包含所有页面路由及其权限元数据
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
