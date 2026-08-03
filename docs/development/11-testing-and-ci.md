# 测试与 CI

本仓库按测试依赖和运行环境分层。优先运行能证明变更正确性的最小测试集合；控制器、DTO、Prisma schema、共享包和测试基础设施变更应按影响面扩大验证。

## 本地命令

```bash
# 根级命令同时启动 backend 与 frontend 测试
pnpm run test

# Backend
pnpm --filter @appserver/backend run test:unit
pnpm --filter @appserver/backend run test:database
pnpm --filter @appserver/backend run test:integration
pnpm --filter @appserver/backend run test:contract
pnpm --filter @appserver/backend run test:runtime
pnpm --filter @appserver/backend run test:db:clean

# Frontend
pnpm --filter @appserver/frontend run test:node
pnpm --filter @appserver/frontend run test:dom
pnpm --filter @appserver/frontend run test:taxonomy
```

`pnpm run test` 通过 pnpm 并行启动两个应用；应用内部的调度由 Vitest 管理。开发时不要因局部修改默认运行根级全量命令。

## 分类与并行边界

| 应用     | 目录与后缀                                   | 运行环境           | 隔离与并行                                                 |
| -------- | -------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Backend  | `tests/unit/**/*.unit.test.ts`               | Node               | 纯 mock/逻辑测试；Vitest 文件并行，不连接 MySQL 或 Redis。 |
| Backend  | `tests/database/**/*.db.test.ts`             | Node + MySQL       | Prisma 持久化测试；固定数据库 worker 数。                  |
| Backend  | `tests/integration/**/*.integration.test.ts` | Node + MySQL/Redis | HTTP、Redis 和流程集成测试；复用数据库 worker 隔离。       |
| Backend  | `tests/contract/**/*.contract.test.ts`       | Node 或运行时依赖  | schema 合约为 Node；operation 合约按需要进入数据库项目。   |
| Frontend | `tests/node/**/*.node.test.ts`               | Node               | 默认环境，不初始化 jsdom。                                 |
| Frontend | `tests/dom/**/*.dom.test.ts`                 | jsdom              | 文件首行必须是 `// @vitest-environment jsdom`。            |

后端使用 `backend-unit`、`backend-database` 和 `backend-contract` 三个 Vitest project。前端使用单一 Vitest 调度器和单一 Vite 转换图，以 `threads` pool 执行文件；DOM 文件按声明进入 jsdom，仍保持每文件隔离。通过测试的应用调试输出会静默，失败测试仍保留诊断输出。

## 后端数据库隔离

后端测试运行器会先执行一次 Prisma Client generation。这是模块导入的代码生成前置条件，**不会**连接 MySQL、创建数据库或执行 `db push`。

数据库、集成和运行时 operation contract 项目才会创建派生数据库。基础 `DATABASE_URL` 必须指向名称含 `test` 的专用库，测试账户还必须拥有同服务器的 `CREATE/DROP DATABASE` 权限。每次运行生成随机命名空间，并为每个 worker 创建：

```text
<base>__vitest_<run>_<worker>
```

worker 启动时接收独立 `DATABASE_URL` 和 Redis DB；每个数据库测试文件开始前清空该 worker 的 MySQL 表及已启用的 Redis DB。MySQL 清理由单次批量 SQL 完成，避免逐表往返造成并发 hook 超时。正常结束后删除派生数据库；中断后使用 `test:db:clean` 回收遗留库。

`TEST_DB_WORKERS` 控制数据库并发数，`TEST_REDIS_DB_BASE` 指定 Redis DB 起点，二者不得超出 Redis 16 个逻辑库。CI 固定 `TEST_DB_WORKERS=2` 并设 `TEST_REDIS_REQUIRED=true`；本地只有显式设定 `TEST_REDIS_CLEANUP=true` 才会连接并清理 Redis。

## GitHub Actions

后端与前端各自使用 paths filter：普通源码变更运行 related tests；OpenAPI、共享包、Vitest 配置、测试 runtime、锁文件等基础设施变更升级为完整相关项目测试。

- 后端 CI 分为纯单测 job 与运行时 job。运行时 job 提供 MySQL 和 Redis service，生成 OpenAPI/Prisma 前置，再运行数据库和 contract 项目。
- 前端 CI 缓存生成的 Swagger 与 `src/client`。缓存未命中时才生成 SDK；API 契约或生成代码变更会运行完整前端套件。
- CI 不共享本地开发数据库、Redis DB 或生产凭据。测试环境变量只能指向隔离的测试资源。

## 故障处理

- `Cannot find module '.prisma/client/default'`：使用仓库测试命令运行；运行器会先生成 Prisma Client。若单独执行 Vitest，先运行 `pnpm --filter @appserver/backend run db:generate`。
- 数据库测试中断：运行 `pnpm --filter @appserver/backend run test:db:clean`，不要手工删除未知数据库。
- Redis 不可用：本地未启用 Redis 清理时可继续运行不依赖 Redis 的数据库测试；CI 及显式 Redis 清理模式会快速失败。
- 分类校验失败：按文件真实依赖移动测试，保持目录与后缀约定；DOM 测试补充 jsdom 文件注释。
