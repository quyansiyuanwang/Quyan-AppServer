# Bun 部署与回滚指南

**版本**: v1
**日期**: 2026/5/9
**提交哈希**: 54b50123f3e8866f13613afe25b85746c9f22b7c

## 1. 概述

本文档用于说明 `NodeBackend` 从传统 Node 运行方式切换到 **Bun + PM2** 的部署方法、验证步骤、平滑切换方式与回滚方案。

当前部署目标：

- **构建产物**：`dist/index.cjs`
- **运行时**：`bun`
- **进程管理**：`pm2`
- **PM2 模式**：`cluster`

## 2. 部署前提

### 2.1 服务器要求

建议满足以下条件：

- Linux 服务器
- Bun 1.x+
- pnpm 10.x+
- PM2 已安装
- MySQL 可访问
- Redis 可访问（如当前环境依赖 Redis）

### 2.2 当前 PM2 配置要点

当前 `ecosystem.config.cjs` 关键配置如下：

- `script: "./dist/index.cjs"`
- `interpreter: "bun"`
- `instances: 2`
- `exec_mode: "cluster"`
- `wait_ready: true`
- `listen_timeout: 8000`

生产环境变量文件默认路径：

- `/home/service/Quyan-Backend/.env`

## 3. 部署前检查

### 3.1 确认 Bun 对 PM2 用户可见

必须以 **实际运行 PM2 的用户** 执行以下命令：

```bash
which bun
bun --version
pm2 report | grep -i bun
```

如果 `bun --version` 失败，说明当前 PATH 未正确暴露给 PM2 用户，不能继续切换。

### 3.2 确认生产环境变量

请确认 `/home/service/Quyan-Backend/.env` 存在，并至少包含：

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`

如果启用了 Redis / 2FA / WebAuthn / reCAPTCHA 等功能，也应同步检查对应变量完整性。

### 3.3 确认依赖与锁文件

建议部署前使用锁文件安装：

```bash
pnpm install --frozen-lockfile
```

建议在 **构建完成后** 再执行一次：

```bash
pnpm run deploy:preflight
```

因为该检查会验证 `dist/index.cjs` 是否存在。

`deploy:preflight` 会执行以下关键检查：

- 当前用户是否能执行 `bun --version`
- PM2 是否可用
- `ecosystem.config.cjs` 是否仍配置 `interpreter: "bun"`
- `dist/index.cjs` 是否存在
- 生产 `ENV_FILE_PATH` 是否存在且文件名为 `.env`
- 生产必需环境变量是否齐全

> 该脚本刻意使用 Node 启动，而不是直接用 Bun 启动。这样在 Bun 缺失时，能输出更明确的失败原因，而不是在进入脚本前就直接报命令不存在。

## 4. 推荐部署步骤

### 4.1 生成运行所需产物

```bash
pnpm run db:generate
pnpm run openapi:generate
pnpm run build:prod
pnpm run deploy:preflight
```

这一步会完成：

- Prisma Client 生成
- TSOA/OpenAPI 文件生成
- 构建信息注入
- esbuild 打包 `dist/index.cjs`

### 4.2 先手动验证 Bun 可运行构建产物

在交给 PM2 前，推荐先直接运行一次：

```bash
bun ./dist/index.cjs
```

应重点检查：

- 服务是否成功启动
- 是否正确读取生产环境 `.env`
- Prisma 是否成功初始化
- Redis 是否正常连接或按预期降级
- 是否能访问 `/docs`
- 是否出现原生依赖或运行时兼容错误

### 4.3 交给 PM2 托管

首次启动：

```bash
pnpm run pm2:start:prod
pnpm run pm2:status
```

如果已经有旧实例，优先使用平滑重载：

```bash
pm2 reload ecosystem.config.cjs --env production
pm2 status
pm2 logs backend --lines 200
```

### 4.4 一键发布脚本

Linux 服务器上可以直接执行：

```bash
pnpm run deploy:linux:prod
```

该脚本位于：

- `scripts/deploy-bun-pm2.sh`

默认流程：

1. `pnpm install --frozen-lockfile`
2. `pnpm run db:generate`
3. `pnpm run openapi:generate`
4. `pnpm run build:prod`
5. `pnpm run deploy:preflight`
6. 检测 `backend` 是否已存在，已存在则 `pm2 reload`，否则 `pm2 start`
7. 输出 `pm2 status`
8. 输出最近 PM2 日志

可选参数：

- `--no-install`：跳过依赖安装
- `--no-logs`：跳过末尾日志输出

## 5. 平滑切换建议

推荐采用以下顺序降低风险：

1. 在服务器上完成构建
2. 前台执行 `bun ./dist/index.cjs` 做一次冒烟验证
3. 使用 `pm2 reload` 替换旧实例
4. 观察日志、接口与数据库连接
5. 确认稳定后再结束观察窗口

如果是高峰期切换，建议提前：

- 保留上一版可回滚产物
- 保留旧 PM2 配置副本
- 记录当前 `pm2 status` 和环境变量路径

## 6. 上线后验证清单

切换完成后，建议至少验证以下功能：

### 6.1 进程状态

- PM2 实例状态为 `online`
- 没有持续重启
- 没有 `Interpreter bun is NOT AVAILABLE`
- 没有卡在 `launching`

### 6.2 核心接口

- 登录接口
- 刷新 Token 接口
- 受保护接口鉴权
- `/docs`
- 任意一个 Prisma 读接口

### 6.3 基础设施

- MySQL 连接正常
- Redis 正常或按预期降级
- 日志输出正常
- PM2 cluster 两个实例都能启动

### 6.4 重点风险项

重点关注以下 Bun 迁移敏感点：

- `process.send("ready")` 与 `wait_ready`
- Prisma Client 初始化
- `process.memoryUsage()` 与定时监控
- 构建脚本 `inject-build-info.mjs`
- Redis 熔断与恢复逻辑

## 7. 回滚方案

如果 Bun 运行时在服务器上出现兼容问题，建议按以下顺序回滚：

### 7.1 停止当前实例

```bash
pnpm run pm2:stop
```

### 7.2 切回上一版稳定产物

恢复：

- 上一版 `dist/`
- 上一版部署包
- 或上一版 Git tag / release

### 7.3 恢复旧运行方式

如需回退到 Node 运行时：

1. 修改 `ecosystem.config.cjs`
2. 将 `interpreter` 恢复为旧值
3. 确认脚本与启动命令同步恢复

### 7.4 重新启动并验证

```bash
pnpm run pm2:start:prod
pnpm run pm2:status
pnpm run pm2:logs
```

验证：

- 进程是否恢复稳定
- 核心接口是否恢复可用
- 数据库 / Redis 是否恢复正常

## 8. 当前本地验证边界

当前仓库已补充 Bun 迁移相关测试与配置验证，但如果开发机未安装 Bun，则仍无法本地直接验证：

- `bun ./src/main.ts`
- `bun ./dist/index.cjs`
- `pnpm run build:prod`

因此，最终上线前仍必须在 Linux 服务器完成一次真实 Bun 运行验证。

## 9. 建议的上线命令顺序

```bash
pnpm install --frozen-lockfile
pnpm run db:generate
pnpm run openapi:generate
pnpm run build:prod
bun ./dist/index.cjs
pnpm run deploy:preflight
pm2 reload ecosystem.config.cjs --env production
pm2 status
pm2 logs backend --lines 200
```

## 10. 相关文档

- [开发工作流文档](./05-development-workflow.md)
- [测试指南](./06-testing-guide.md)
- [根 README](../../README.md)
