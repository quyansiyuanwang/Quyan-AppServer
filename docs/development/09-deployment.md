# 09 — 构建与部署

## 构建流程

### 后端构建

```bash
# 标准构建
pnpm --filter @appserver/backend build

# 构建步骤：
# 1. type-check (tsc --noEmit)
# 2. clean (rimraf dist/)
# 3. build:info:inject (注入构建信息)
# 4. compile (esbuild)
# 5. copy:static (复制 JSON/HTML/CSS 到 dist/)
```

**构建工具：esbuild**
- 入口：`src/main.ts`
- 输出：`dist/index.cjs` (CommonJS)
- 原生模块标记为 external：Prisma client, Sharp
- 路径别名通过 `tsc-alias` 在构建时解析

**生产构建**：
```bash
pnpm --filter @appserver/backend build:prod
# NODE_ENV=production
```

### 前端构建

```bash
# 标准构建
pnpm --filter @appserver/frontend build

# 构建步骤：
# 1. type:generate (生成路由类型)
# 2. type-check (vue-tsc)
# 3. compile (vite build)
```

**构建工具：Rolldown-Vite**
- 目标：ES2018 (Chrome 63+)
- 压缩：Terser（生产环境移除 console/debugger）
- 代码分割：按 node_modules 自动分包
- Gzip 压缩：>10KB 的文件
- 混淆：javascript-obfuscator（生产环境）
- 分析报告：`stats.html`

**生产构建**：
```bash
pnpm --filter @appserver/frontend build:prod
```

### Monorepo 构建

```bash
# 构建所有项目
pnpm run build

# 完整构建（含 OpenAPI 生成）
pnpm run build:full
# = openapi:gen:all + build
```

## 运行

### 后端开发模式

```bash
pnpm run dev:backend
# nodemon 监听 src/ 和 prisma/schema.prisma
# 文件变更 → openapi:generate → bun src/main.ts
```

### 后端生产模式

```bash
# 直接运行
pnpm --filter @appserver/backend start:prod

# 或通过 PM2
pnpm --filter @appserver/backend pm2:start:prod
```

### 前端开发模式

```bash
pnpm run dev:frontend
# Vite dev server (port 5173)
# /api/* 请求代理到 localhost:10001
```

## PM2 部署

### 配置文件

`apps/backend/ecosystem.config.cjs`：

```javascript
module.exports = {
  apps: [{
    name: "backend",
    script: "./dist/index.cjs",
    interpreter: "bun",
    instances: 1,
    exec_mode: "cluster",
    wait_ready: true,
    listen_timeout: 8000,
    env: {
      NODE_ENV: "development"
    },
    env_production: {
      NODE_ENV: "production",
      ENV_FILE_PATH: "/home/service/Quyan-Backend/.env"
    }
  }]
};
```

### PM2 命令

```bash
# 启动
pnpm --filter @appserver/backend pm2:start          # 开发
pnpm --filter @appserver/backend pm2:start:prod     # 生产

# 监控
pnpm --filter @appserver/backend pm2:status          # 状态
pnpm --filter @appserver/backend pm2:logs            # 日志

# 管理
pnpm --filter @appserver/backend pm2:stop            # 停止
pnpm --filter @appserver/backend pm2:restart         # 重启
pnpm --filter @appserver/backend pm2:delete          # 删除

# 重建（清旧构建 + 生产构建 + 启动）
pnpm --filter @appserver/backend pm2:rebuild
# = pm2:delete + build:prod + pm2:start:prod
```

### 优雅关闭

服务监听 `SIGTERM`/`SIGINT`：
1. 关闭 HTTP 服务器（12 分钟强制超时）
2. 清理连接（Redis 等）
3. 在 PM2 集群模式下发送 `ready` 信号

### 服务超时配置

- `keepAliveTimeout`: 65 秒
- `headersTimeout`: 66 秒
- `requestTimeout`: 10 分钟

## 环境变量

### 后端 (`.env`)

```bash
# 服务器
PORT=10001

# 数据库
DATABASE_URL=mysql://user:password@localhost:3306/database

# JWT (>= 64 字符)
JWT_ACCESS_SECRET=<64+字符>
JWT_REFRESH_SECRET=<64+字符>
JWT_ACCESS_EXPIRES_IN=5        # 开发：5 秒
JWT_REFRESH_EXPIRES_IN=28800   # 开发：8 小时

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:5173

# 安全 (>= 64 字符，必须与 JWT 密钥不同)
REPLAY_SIGNING_MASTER_SECRET=<64+字符>
TWO_FACTOR_TRUSTED_DEVICE_SECRET=<64+字符>
```

### 前端 (`.env`)

```bash
VITE_BACKEND_URL=http://localhost:10001
VITE_RECAPTCHA_SITE_KEY=
VITE_TURNSTILE_SITE_KEY=
```

### 生产环境建议

```bash
# 生产环境调整
JWT_ACCESS_EXPIRES_IN=900        # 15 分钟
JWT_REFRESH_EXPIRES_IN=604800    # 7 天
NODE_ENV=production
```

## 预提交验证

```bash
cd AppServerMonorepo
pnpm run precommit
```

执行步骤：
1. `openapi:gen:all` — OpenAPI 生成流水线
2. `validate:permissions` — 权限一致性校验
3. `lint:check` — 所有项目 ESLint 检查
4. `format:check` — 所有项目 Prettier 检查
5. `type-check` — 所有项目 TypeScript 类型检查

## 后端脚本

| 脚本 | 用途 |
|------|------|
| `relay-token:backfill-used-quota` | 回填 relay token 已用配额（`--apply` 执行） |
| `trusted-device:cleanup-legacy` | 清理旧版信任设备记录 |
| `balance:cleanup-consumption-older-than-month` | 清理超过 1 个月的消费记录（`--apply` 执行） |
| `generate-operation-ids` | 生成操作 ID |

## 部署检查清单

- [ ] 所有环境变量已配置（特别是 3 个安全密钥 >= 64 字符）
- [ ] 数据库迁移已运行 (`pnpm run db:migrate`)
- [ ] Prisma client 已生成 (`pnpm run db:generate`)
- [ ] 生产构建成功 (`pnpm run build:full`)
- [ ] CORS 允许源已更新为生产域名
- [ ] JWT 过期时间已调整为生产值
- [ ] Redis 连接可访问
- [ ] PM2 配置正确（`ecosystem.config.cjs`）
