# 开发工作流文档

**文档版本**: v1
**提交哈希**: 4efda63200abdfb556fbabc2832edb8dffc2d444
**文档日期**: 2026/2/10

## 前置要求

### 环境要求

- **Node.js**: `^20.19.0 || >=22.12.0`
- **npm**: 跟随 Node.js 版本
- **IDE**: VS Code + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) 扩展
- **浏览器**: Chromium 系列 + [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)

### 环境配置

1. 复制环境变量文件:

```bash
cp .env.sample .env
```

2. 编辑 `.env` 文件:

```bash
VITE_BACKEND_URL=/api
VITE_AI_PROXY_URL=/api/relay/proxy
```

3. 安装依赖:

```bash
pnpm install
```

## 常用命令

### 开发

```bash
pnpm run dev              # 启动开发服务器（Vite + HMR）
pnpm run preview          # 预览生产构建
```

### 构建

```bash
pnpm run build            # 类型检查 + 生产构建
pnpm run build-only       # 仅生产构建（跳过类型检查）
pnpm run build:full       # 重新生成 API 客户端 + 构建
```

### 代码质量

```bash
pnpm run type-check       # TypeScript 类型检查（vue-tsc）
pnpm run lint             # ESLint 检查并自动修复
pnpm run format           # Prettier 格式化
pnpm run lint-format-check # 完整验证（lint + format + type-check）
```

### API 客户端生成

```bash
pnpm run openapi:generate  # 完整生成流程:
                          #   1. openapi-ts 生成客户端
                          #   2. generate-api-constants.js
                          #   3. generate-api-types-map.js
                          #   4. lint-format-check

pnpm run client:generate   # 仅运行常量和类型映射生成脚本
```

### 预提交

```bash
pnpm run precommit        # 完整预提交流程:
                          #   1. openapi:generate
                          #   2. lint-format-check
```

## 开发服务器

### API 代理

开发服务器自动代理 API 请求到后端:

```
浏览器 → http://localhost:5173/api/users
  ↓ (Vite 代理)
后端 → http://localhost:10001/users
```

**代理配置** (`vite.config.ts`):

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

### 自动导入

Element Plus 组件和 Vue API 会自动导入，无需手动 import:

```vue
<template>
  <!-- Element Plus 组件可直接使用 -->
  <el-button type="primary">按钮</el-button>
  <el-input v-model="value" />
</template>

<script setup lang="ts">
// Vue API 自动导入（ref, computed, watch 等）
const value = ref('')
const doubled = computed(() => value.value + value.value)
</script>
```

**生成的类型文件**:

- `components.d.ts` - 组件类型声明
- `auto-imports.d.ts` - API 函数类型声明

## 代码规范

### Prettier 配置

```json
{
  "$schema": "https://json.schemastore.org/prettierrc",
  "semi": false,
  "singleQuote": true,
  "printWidth": 100
}
```

**关键规则**:

- 不使用分号
- 使用单引号
- 行宽 100 字符

### ESLint 配置

- Vue + TypeScript 规则集
- 自动修复支持
- 支持缓存 (`--cache`)

### TypeScript 配置

- **严格模式**: 启用
- **路径别名**: `@` → `./src`
- **目标**: ESNext
- **模块解析**: Bundler

## 构建配置

### 构建优化

| 优化项     | 说明        | 配置                                       |
| ---------- | ----------- | ------------------------------------------ |
| 代码压缩   | Terser      | 移除 console 和 debugger                   |
| 代码分割   | Vendor 分割 | 按 node_modules 包拆分                     |
| Gzip 压缩  | > 10KB 文件 | `.gz` 后缀                                 |
| 目标浏览器 | ES2018      | 支持 Chrome 63+, Firefox 58+, Safari 11.1+ |
| Babel 转译 | 兼容性      | `.js`, `.ts`, `.jsx`, `.tsx`               |
| 构建分析   | 可视化      | `rollup-plugin-visualizer`                 |

### 代码分割策略

**1. 路由级别懒加载**:

```typescript
// 路由配置中使用动态导入
component: () => import('@/views/home/HomeDefault.vue')
```

**2. Vendor 代码分割**:

```typescript
// vite.config.ts
manualChunks(id) {
  if (id.includes('node_modules')) {
    return id.toString().split('node_modules/')[1].split('/')[0].toString()
  }
}
```

每个 node_modules 包会被拆分为独立的 chunk。

### 构建分析

构建完成后会生成 `stats.html` 文件，可视化展示包大小:

```bash
pnpm run build
# 查看 stats.html
```

## 项目脚本 (scripts/)

### generate-api-constants.js

从 OpenAPI 生成的客户端中提取 API 端点元数据:

```
输入: src/client/ (openapi-ts 生成的代码)
输出: src/client/api-endpoints.gen.ts
```

**生成内容**:

- API 端点 URL 常量
- 动态 URL 构建函数
- HTTP 方法信息

### generate-api-types-map.js

从 OpenAPI 生成的客户端中提取请求/响应类型映射:

```
输入: src/client/ (openapi-ts 生成的代码)
输出: src/client/api-types-map.gen.ts
```

**生成内容**:

- 请求体类型 (body)
- 查询参数类型 (query)
- 响应数据类型 (response)

## 开发流程

### 路由更新检查清单

当你新增、删除、重命名或调整前端路由时，至少检查以下位置是否需要同步：

- `src/router/routes.ts`：路由定义、懒加载组件、meta 信息。
- `src/layouts/NavMenuItems.vue`：桌面/移动端主导航入口与权限控制显示。
- `src/layouts/AsideMenu.vue`：固定页面、右键菜单、功能总览抽屉、移动端抽屉中的入口是否需要同步。
- `src/locales/en.ts` 与 `src/locales/zh-CN.ts`：导航标题、说明文案、搜索关键字相关翻译。
- 权限常量与判定：确认 `Permission` 使用是否与目标页面一致，避免菜单显示与页面访问条件不一致。
- `src/types/route-types.gen.ts` 的消费点：如路由名称发生变化，检查所有 `RouteName` 使用处是否同步。
- 若调整会影响文档入口，确认 `resolveDocsUrl(...)` 关联页面是否仍然正确。

如果路由定义本身有改动，还应继续执行：

- `pnpm run type-check`
- 如涉及路由类型生成流程，再执行 `pnpm run type:generate`

### 1. 新功能开发

```bash
# 1. 确保后端运行
# 2. 启动开发服务器
pnpm run dev

# 3. 如果后端 API 有变更，重新生成客户端
pnpm run openapi:generate

# 4. 开发完成后，运行完整检查
pnpm run lint-format-check
```

### 2. 提交代码

```bash
# 1. 运行预提交检查
pnpm run precommit

# 2. 确认所有检查通过后提交
git add .
git commit -m "feat: your feature description"
```

### 3. 生产构建

```bash
# 完整构建（推荐）
pnpm run build:full

# 或分步构建
pnpm run openapi:generate
pnpm run build
```

## 故障排查

### 类型检查失败

```bash
# 清除缓存并重新检查
rm -rf node_modules/.cache
pnpm run type-check
```

### API 客户端生成失败

```bash
# 确认后端运行
curl http://localhost:10001/docs/openapi.json

# 重新生成
pnpm run openapi:generate
```

### 开发服务器代理问题

- 确认后端运行在 `localhost:10001`
- 检查 `.env` 中的 `VITE_BACKEND_URL` 配置
- 检查浏览器控制台网络请求
