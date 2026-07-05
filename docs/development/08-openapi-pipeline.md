# 08 — OpenAPI 生成流水线

## 流水线概览

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Backend (tsoa spec-and-routes)                  │
│   src/api/controllers/ → tsoa → src/build/              │
│     ├── swagger.json      (OpenAPI 3.0 spec)            │
│     ├── routes.ts          (Express route registration) │
│     └── route-paths.ts     (路由路径常量)                │
├─────────────────────────────────────────────────────────┤
│ Step 2: Sync (scripts/sync-swagger-to-frontend.mjs)     │
│   apps/backend/src/build/swagger.json                   │
│     → apps/frontend/swagger.json                        │
├─────────────────────────────────────────────────────────┤
│ Step 3: Frontend (openapi-ts + post-processing)         │
│   swagger.json → @hey-api/openapi-ts → src/client/      │
│     ├── *.gen.ts           (typed SDK services)         │
│     ├── types.gen.ts       (TypeScript types)           │
│     ├── api-endpoints.gen.ts    (endpoint list)         │
│     └── api-types-map.gen.ts    (type mappings)         │
│   post-processing scripts:                              │
│     ├── generate-api-constants.js                       │
│     ├── generate-api-types-map.js                       │
│     └── generate-replay-protected-endpoints.js          │
└─────────────────────────────────────────────────────────┘
```

## 命令速查

```bash
cd AppServerMonorepo

# 仅后端生成 (swagger.json + routes.ts)
pnpm run openapi:gen

# 同步 swagger.json 到前端 + 生成前端客户端
pnpm run openapi:sync

# 完整流水线 (后端生成 + 同步 + 前端客户端)
pnpm run openapi:gen:all

# 针对单个项目
pnpm --filter @appserver/backend openapi:generate
pnpm --filter @appserver/frontend openapi:generate
```

## Step 1: 后端 TSOA 生成

### 触发方式

- **手动**: `pnpm run openapi:gen`
- **自动**: 后端 dev 模式下每次文件变更时自动运行（nodemon 配置）
- **构建前**: `prebuild` hook 自动执行

### TSOA 配置 (`tsoa.json`)

```json
{
  "entryFile": "src/app.ts",
  "controllerPathGlobs": ["src/api/controllers/**/*.ts"],
  "spec": {
    "outputDirectory": "src/build",
    "specVersion": 3,
    "securityDefinitions": {
      "jwt": { "type": "apiKey", "name": "Authorization", "in": "header" },
      "relay-token": { "type": "apiKey", "name": "Authorization", "in": "header" },
      "local-or-jwt": { "type": "apiKey", "name": "Authorization", "in": "header" }
    }
  },
  "routes": {
    "routesDir": "src/build",
    "authenticationModule": "./src/middleware/auth/auth_guard.ts"
  }
}
```

### 生成产物

| 文件 | 用途 |
|------|------|
| `src/build/swagger.json` | OpenAPI 3.0 规范文件 |
| `src/build/routes.ts` | Express 路由注册代码 |
| `src/build/route-paths.ts` | 路由路径常量（供脚本使用） |

### 附加处理

`tsoa:spec-and-routes` 脚本还会运行：
- `scripts/add-replay-protection-markers.js` — 标记 `@ReplayProtected` 端点
- `scripts/generate-route-paths.ts` — 生成路由路径常量

## Step 2: Swagger 同步

`scripts/sync-swagger-to-frontend.mjs`：
1. 检查 `apps/backend/src/build/swagger.json` 是否存在
2. 复制到 `apps/frontend/swagger.json`
3. 如果源文件不存在则报错

## Step 3: 前端客户端生成

### openapi-ts 配置 (`openapi-ts.config.ts`)

- **输入**: 本地 `./swagger.json` 或自动回退到 `http://localhost:10001/docs/openapi.json`
- **输出**: `./src/client/`
- **HTTP 客户端**: `@hey-api/client-axios`（与 `stores/request.ts` 中的 Axios 实例集成）
- **操作 ID 风格**: camelCase

### 后处理脚本

`pnpm run client:generate` 顺序运行：

1. **generate-api-constants.js** — 从生成的 SDK 中提取 API 端点常量
2. **generate-api-types-map.js** — 生成请求/响应类型映射表
3. **generate-replay-protected-endpoints.js** — 从后端 spec 中提取 `@ReplayProtected` 端点列表

### 生成的客户端使用

```typescript
// src/service/userService.ts
import { createUserControllerApi } from '@/client/user-controller.gen';
import { useRequestStore } from '@/stores/request';

const getApi = () => createUserControllerApi(useRequestStore().getAxios());

export class UserService {
  async getUsers() {
    const { data } = await getApi().getUsers();
    return data;
  }
}
```

### 重要提示

- `src/client/` 目录被 ESLint 忽略，**绝对不要手动编辑**
- `src/client/` 不被 git 跟踪（通过 `.gitignore`），需要在构建时生成
- 修改后端 Controller 或 DTO 后，必须运行 `pnpm run openapi:gen:all` 才能让前端获取最新类型

## 权限一致性校验

`scripts/validate-frontend-permissions.mjs` 在 `precommit` 时运行，验证：

1. 前端 `src/constant/permission.ts` 从 `@appserver/shared` re-export（非本地定义）
2. 后端 `src/constant/permission.ts` 从 `@appserver/shared` re-export（非本地定义）
3. 前端 `PERMISSION_META` 对象覆盖了所有 `Permission` 枚举成员，没有多余或缺失

此脚本确保前后端的权限定义始终一致。
