# AppServer Frontend

`frontend` 是 `AppServer` 的管理前端，基于 Vue 3 + TypeScript + Element Plus，负责认证、权限、系统配置、业务管理与可视化页面。

## 技术栈

- Vue 3 + Composition API
- TypeScript
- Vite（`rolldown-vite`）
- Element Plus
- Pinia
- Vue Router
- Vue I18n
- Axios
- `@hey-api/openapi-ts`
- Vitest

## 环境要求

- `Node.js` `^20.19.0 || >=22.12.0`
- `pnpm@10.33.0`
- 本地生成 API 客户端时，后端需运行在 `http://localhost:10001`

## 快速开始

```bash
pnpm install
pnpm run dev
```

默认地址：`http://localhost:5173`

## 常用命令

### 开发与构建

```bash
pnpm run dev
pnpm run prod
pnpm run preview
pnpm run build
pnpm run build:prod
pnpm run build-only
pnpm run build-only:prod
pnpm run build:full:prod
```

### 类型与格式校验

```bash
pnpm run type-check
pnpm run type:generate
pnpm run lint
pnpm run format
pnpm run lint-format-check
pnpm run check:all
```

### OpenAPI 与客户端生成

```bash
pnpm run openapi:sync
pnpm run openapi:generate
pnpm run openapi:sync-generate
pnpm run client:generate
pnpm run validate:permissions   # 从根目录运行，验证前后端权限一致性
```

### 测试

```bash
pnpm run test
pnpm run test:coverage
```

## 环境变量

参考 `frontend/.env.example`：

```env
VITE_BACKEND_URL=
VITE_AI_PROXY_URL=/relay/proxy
VITE_RECAPTCHA_SITE_KEY=
VITE_TURNSTILE_SITE_KEY=
```

## 目录结构

```text
frontend/
  src/
    client/         # OpenAPI 自动生成客户端，禁止手改
    service/        # 业务服务层
    stores/         # Pinia store 与请求封装
    views/          # 页面视图
    router/         # 路由定义
    locales/        # i18n 语言包
    components/     # 通用组件
    layouts/        # 页面布局
    schemas/        # Zod 校验
    utils/          # 通用工具
  docs/             # 项目补充文档
  scripts/          # 生成脚本
  tests/            # 前端测试
```

## 架构约定

- API 调用链路：`view -> service -> client -> request store -> backend`
- `src/client/` 完全由 OpenAPI 生成，不直接修改
- Token 刷新逻辑集中在 `src/stores/request.ts`
- 权限检查集中在 `src/stores/permissionStore.ts`
- 路由类型由 `pnpm run type:generate` 自动生成

## 开发提示

- 后端 controller / DTO 改动后，先在仓库根目录执行 `pnpm run openapi:sync-generate`
- `frontend/swagger.json` 可能落后于后端生成结果，使用 `openapi:sync` 同步
- 提交前建议执行 `pnpm run precommit`

## 相关文档

- `frontend/AGENTS.md`
- `frontend/CLAUDE.md`
- `frontend/docs/`
