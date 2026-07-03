# 系统架构文档

**文档版本**: v1
**提交哈希**: 4efda63200abdfb556fbabc2832edb8dffc2d444
**文档日期**: 2026/2/10

## 概述

本项目是一个基于 Vue 3 + TypeScript 的现代化前端应用，采用 Vite 构建工具，使用 Pinia 进行状态管理，Element Plus 作为 UI 组件库。项目具有完整的认证授权系统、权限管理系统、国际化支持和事件驱动架构。

## 技术栈

### 核心框架

- **Vue 3.5.22** - 使用 Composition API
- **TypeScript 5.9** - 类型安全
- **Vite (rolldown-vite)** - 构建工具和开发服务器
- **Pinia 3.0** - 状态管理
- **Vue Router 4.6** - 路由管理（Hash 模式）

### UI 和样式

- **Element Plus 2.11** - UI 组件库（自动导入）
- **Sass 1.95** - CSS 预处理器
- **CSS Variables** - 主题系统（支持暗色模式）

### 网络和 API

- **Axios 1.13** - HTTP 客户端
- **@hey-api/openapi-ts 0.88** - OpenAPI 客户端生成器
- **JWT** - 身份认证令牌

### 工具库

- **Vue-i18n 11.2** - 国际化（支持 en, zh-CN）
- **Zod 4.3** - 数据验证
- **crypto-js 4.2** - 加密工具
- **@vueuse/core 11.0** - Vue 组合式工具集

## 项目结构

```
frontend/
├── src/
│   ├── assets/              # 静态资源（CSS、图片）
│   ├── client/              # 自动生成的 OpenAPI 客户端（禁止手动编辑）
│   ├── components/          # 可复用组件
│   │   ├── icons/           # 图标组件
│   │   └── permission/      # 权限相关组件
│   ├── config/              # 应用配置（进度条等）
│   ├── constant/            # 常量定义
│   │   ├── custom-code.ts   # 自定义响应码
│   │   ├── events.ts        # 事件类型定义
│   │   ├── request.ts       # 请求配置
│   │   └── storagekey.ts    # LocalStorage 键名
│   ├── events/              # 事件总线注册
│   ├── layouts/             # 布局组件
│   │   ├── HomeFrameLayout.vue  # 主框架布局
│   │   └── overLay.vue      # 受保护路由包装器
│   ├── locales/             # 国际化翻译文件
│   │   ├── en.ts            # 英文
│   │   ├── zh-CN.ts         # 简体中文
│   │   └── index.ts         # i18n 配置
│   ├── router/              # 路由配置
│   ├── schemas/             # Zod 验证模式
│   ├── service/             # 业务逻辑服务层
│   │   ├── authorizationService.ts  # 认证服务
│   │   ├── permissionService.ts     # 权限服务
│   │   └── userService.ts           # 用户服务
│   ├── stores/              # Pinia 状态管理
│   │   ├── globalInstance.ts        # 事件总线实例
│   │   ├── permissionStore.ts       # 权限状态
│   │   ├── request.ts               # HTTP 客户端
│   │   ├── userInfoStore.ts         # 用户信息
│   │   └── ...                      # 其他 stores
│   ├── types/               # TypeScript 类型定义
│   ├── utils/               # 工具函数
│   │   ├── EventBus.ts      # 事件总线实现
│   │   ├── notification.ts  # 通知系统
│   │   └── ...              # 其他工具
│   ├── views/               # 页面组件
│   │   ├── auth/            # 认证页面
│   │   ├── common/          # 通用页面（404等）
│   │   ├── debug/           # 调试页面
│   │   ├── home/            # 主页
│   │   └── settings/        # 设置页面
│   ├── App.vue              # 根组件
│   ├── IndexApp.vue         # 索引包装组件
│   └── main.ts              # 应用入口
├── scripts/                  # 构建脚本
│   ├── generate-api-constants.js    # 生成 API 常量
│   └── generate-api-types-map.js    # 生成 API 类型映射
├── docs/                    # 项目文档
├── dist/                    # 构建输出
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TypeScript 配置
├── package.json             # 项目依赖
├── .env.sample              # 环境变量示例
└── CLAUDE.md                # AI 助手指南
```

## 应用启动流程

### 1. 入口文件 (main.ts)

```typescript
// 1. 导入样式
import '@/assets/main.css'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

// 2. 创建 Vue 应用实例
const app = createApp(App)
const pinia = createPinia()

// 3. 注册插件
app.use(pinia) // 状态管理
app.use(router) // 路由
app.use(i18n) // 国际化

// 4. 全局配置
configureAll() // 配置进度条等
registerAllEvents() // 注册事件监听器

// 5. 挂载应用
app.mount('#app')
```

### 2. 组件层级结构

```
App.vue (RouterView)
  ↓
IndexApp.vue (页面过渡 + 顶部进度条 + 覆盖层 + 水印)
  ↓
  ├─ LoginOrRegisterView.vue (公开路由)
  └─ overLay.vue (受保护路由包装器)
      ↓
      HomeFrameLayout.vue (侧边栏 + 主内容区)
        ↓
        [页面内容: HomeDefault / PermissionManagement / SettingsView / DebugView]
```

### 3. 路由配置

**路由模式**: Hash History (`createWebHashHistory`)

**路由结构**:

```typescript
/ (root)
  ├─ '' → 重定向到 /home 或 /login（根据 token 存在性）
  ├─ /login → LoginOrRegisterView.vue (公开)
  └─ / (overLay.vue - 受保护)
      ├─ /home → HomeDefault.vue
      ├─ /permission → PermissionManagement.vue
      ├─ /settings → SettingsView.vue
      └─ /debug → DebugView.vue
```

**全局路由守卫**:

- 检查 localStorage 中的 access_token 或 refresh_token
- 访问登录页直接放行
- 无 token 且非登录页 → 重定向到登录页
- 其他情况正常导航

### 3.1 侧边栏与功能总览结构

- 主导航定义在 `src/layouts/NavMenuItems.vue`，属于静态、权限控制的菜单结构。
- 外层交互容器在 `src/layouts/AsideMenu.vue`，负责桌面侧边栏、移动端抽屉、功能总览抽屉。
- “固定页面”不是独立路由配置源，而是 `AsideMenu.vue` 基于可访问路由派生出的本地 UI 状态。
- 固定页顺序保存在浏览器 `localStorage`（键名：`appserver.sidebar.pinnedRoutes`），并在权限加载完成后同步清理无权限或失效路由。
- 功能总览抽屉与桌面/移动端固定页列表共享同一份 `pinnedRouteNames` 状态，因此固定、取消固定、拖拽排序会即时同步到三个入口。
- 删除固定页需要二次确认；拖拽排序基于 `sortablejs` 实现，仅改变本地固定页展示顺序，不影响 `src/router/routes.ts` 中的真实路由定义。

## 核心架构模式

### 1. API 层架构

**OpenAPI 驱动的开发流程**:

```
后端 OpenAPI 规范
  ↓ (http://localhost:10001/docs/openapi.json)
pnpm run openapi:generate
  ↓
@hey-api/openapi-ts 生成客户端
  ↓
src/client/ (自动生成的类型和函数)
  ├─ types.gen.ts          # TypeScript 类型
  ├─ api-endpoints.gen.ts  # API 端点元数据
  └─ api-types-map.gen.ts  # 请求/响应类型映射
  ↓
scripts/generate-api-constants.js
scripts/generate-api-types-map.js
  ↓
完整的类型安全 API 客户端
```

**使用示例**:

```typescript
import { API_ENDPOINTS } from '@/client/api-endpoints.gen'
import type { LoginApiType } from '@/client/api-types-map.gen'

const request = useRequestStore().getAxios()
const result = await request.post<LoginApiType>(API_ENDPOINTS.Login.url, { username, password })
```

### 2. 服务层模式

**单例模式服务**:

所有服务类使用单例模式，确保全局共享状态：

```typescript
export class AuthorizationService {
  private static instance: AuthorizationService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new AuthorizationService()
    }
    return this.instance
  }

  // 业务方法...
}

export const authorizationService = AuthorizationService.getInstance()
```

**服务职责**:

- `authorizationService` - 登录、登出、token 刷新、token 验证
- `permissionService` - 用户/组权限的 CRUD 操作
- `userService` - 用户信息获取

**服务与 Store 的关系**:

- 服务层负责与 API 通信（调用 `src/client/`）
- Store 负责状态管理和响应式数据
- 服务层调用 Store 的方法更新状态

### 3. 状态管理架构

**Pinia Stores 组织**:

| Store                        | 职责                                         |
| ---------------------------- | -------------------------------------------- |
| `request.ts`                 | HTTP 客户端管理、token 刷新逻辑              |
| `globalInstance.ts`          | 事件总线实例（webEventBus, authEventBus 等） |
| `permissionStore.ts`         | 权限状态管理、本地权限检查                   |
| `userInfoStore.ts`           | 用户信息存储和持久化                         |
| `themeToggleStore.ts`        | 主题切换（暗色/亮色模式）                    |
| `topLoadingProgressStore.ts` | 顶部进度条状态                               |
| `waterMarkTextStore.ts`      | 水印文本管理                                 |
| `i18nStore.ts`               | 国际化状态                                   |
| `isDesktopStore.ts`          | 设备类型检测                                 |

### 4. 事件驱动架构

**事件总线系统** (`stores/globalInstance.ts`):

```typescript
// 类型安全的事件总线
export const webEventBus = new EventBus<
  keyof typeof HttpStatusCode,
  (arg0: AxiosResponse | AxiosError) => any
>()

export const authEventBus = new EventBus<AUTH_EVENTS, (arg0: any) => any>()
export const customCodeBus = new EventBus<keyof typeof CustomCode, ...>()
export const i18nEventBus = new EventBus<I18N_EVENTS, ...>()
export const windowEventBus = new EventBus<WINDOW_EVENTS, ...>()
export const globalEventBus = new EventBus<GLOBAL_EVENTS, ...>()
```

**事件类型**:

1. **认证事件** (`authEventBus`):
   - `REQUEST_REFRESH_TOKEN` - 请求刷新 token
   - `ACCESS_TOKEN_REFRESHED` - token 刷新成功
   - `ACCESS_TOKEN_REFRESH_FAILED` - token 刷新失败
   - `USER_LOGGED_OUT` - 用户登出

2. **HTTP 状态事件** (`webEventBus`):
   - `Unauthorized` (401) - 未授权
   - `Forbidden` (403) - 禁止访问
   - 其他 HTTP 状态码

3. **自定义代码事件** (`customCodeBus`):
   - `TOKEN_EXPIRED_DUE_TO_UPDATE` - token 因权限变更而过期
   - 其他自定义业务代码

4. **国际化事件** (`i18nEventBus`):
   - 语言切换事件

5. **窗口事件** (`windowEventBus`):
   - 窗口大小变化、设备类型检测

**事件注册** (`events/index.ts`):

所有事件监听器在应用启动时通过 `registerAllEvents()` 注册，包括：

- Token 刷新处理
- 登出重定向
- 权限变更处理
- 错误通知

### 5. 请求包装器模式

**进度条集成**:

所有 HTTP 请求自动包装进度条追踪：

```typescript
// config/index.ts
export const configureAll = () => {
  const topLoadingProgressStore = useTopLoadingProgressStore()

  MyAxios.setDefaultOptions({
    requestWrapper: (promise) => topLoadingProgressStore.wrapRequest(promise),
  })
}
```

**效果**:

- 请求开始 → 进度条显示
- 请求完成 → 进度条隐藏
- 基于任务的进度动画

## 构建和开发配置

### Vite 配置 (vite.config.ts)

**开发服务器**:

```typescript
server: {
  host: true,
  allowedHosts: true,
  proxy: {
    '/api': {
      target: 'http://localhost:10001',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, '')
    }
  }
}
```

**构建优化**:

- **压缩**: Terser（移除 console 和 debugger）
- **目标**: ES2018（更广泛的浏览器兼容性）
- **代码分割**: 按 node_modules 自动分割 vendor 代码
- **Gzip 压缩**: 文件 > 10KB 自动压缩
- **块大小警告**: 500KB 阈值

**插件**:

- `@vitejs/plugin-vue` - Vue 3 支持
- `vite-plugin-vue-devtools` - Vue DevTools
- `unplugin-auto-import` - 自动导入 Element Plus
- `unplugin-vue-components` - 自动注册组件
- `vite-plugin-compression` - Gzip 压缩
- `rollup-plugin-visualizer` - 构建分析

### 自动导入配置

**Element Plus 组件自动导入**:

```typescript
AutoImport({
  resolvers: [ElementPlusResolver()],
})
Components({
  resolvers: [ElementPlusResolver()],
})
```

**生成的类型文件**:

- `components.d.ts` - 自动注册的组件类型
- `auto-imports.d.ts` - 自动导入的函数类型

### 路径别名

```typescript
resolve: {
  alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url))
  }
}
```

在代码中使用 `@/` 引用 `src/` 目录。

## 环境变量

**配置文件**: `.env` (参考 `.env.sample`)

```bash
VITE_BACKEND_URL=http://localhost:10001
```

**使用方式**:

```typescript
import.meta.env.VITE_BACKEND_URL
```

## 开发工具链

### Node.js 版本要求

```json
"engines": {
  "node": "^20.19.0 || >=22.12.0"
}
```

### 代码质量工具

- **ESLint 9.37** - 代码检查（Vue + TypeScript 配置）
- **Prettier 3.6** - 代码格式化
- **vue-tsc 3.1** - Vue 类型检查

### 构建工具

- **Vite (rolldown-vite)** - 使用 Rolldown 作为打包器
- **Terser 5.44** - JavaScript 压缩
- **Babel** - 代码转译（用于更好的兼容性）

## 性能优化策略

### 1. 代码分割

- 路由级别懒加载（`() => import()`）
- Vendor 代码自动分割
- 按需加载 Element Plus 组件

### 2. 资源优化

- Gzip 压缩（> 10KB 文件）
- 图片资源优化
- CSS 按需加载

### 3. 运行时优化

- Vue 3 Composition API（更好的 tree-shaking）
- Pinia（轻量级状态管理）
- 事件总线（解耦组件通信）

### 4. 构建优化

- Terser 压缩（移除 console 和 debugger）
- ES2018 目标（平衡性能和兼容性）
- Rolldown 打包器（更快的构建速度）

## 安全考虑

### 1. 认证安全

- JWT token 存储在 localStorage
- Access token 自动刷新（3秒缓冲期）
- Refresh token 失败自动登出

### 2. 权限控制

- 路由级别权限检查
- 组件级别权限控制
- API 级别权限验证

### 3. XSS 防护

- Vue 3 自动转义
- CSP 策略（可配置）

### 4. CSRF 防护

- JWT token（无需 CSRF token）
- SameSite cookie 策略

## 浏览器兼容性

**目标浏览器**: ES2018+ 支持的现代浏览器

- Chrome/Edge 63+
- Firefox 58+
- Safari 11.1+

**推荐开发环境**:

- Chrome/Edge + Vue.js devtools
- 启用 Custom Object Formatter

## 总结

本项目采用现代化的前端架构，具有以下特点：

1. **类型安全**: 全栈 TypeScript + OpenAPI 生成的类型
2. **模块化**: 清晰的分层架构（View → Store → Service → API）
3. **响应式**: Pinia + Vue 3 Composition API
4. **事件驱动**: 解耦的事件总线系统
5. **国际化**: 完整的 i18n 支持
6. **权限管理**: 细粒度的权限控制系统
7. **开发体验**: 自动导入、热更新、类型提示
8. **生产优化**: 代码分割、压缩、缓存策略
