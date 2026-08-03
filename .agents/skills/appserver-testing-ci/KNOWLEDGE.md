## 隔离模型

- 所有后端测试命令会在 Vitest 前生成一次 Prisma Client。
- 单测不会创建数据库，也不连接 MySQL/Redis。
- 运行时项目按运行和 worker 派生 MySQL 数据库：`<base>__vitest_<run>_<worker>`。
- 每个 worker 使用独立 Redis logical DB。`TEST_DB_WORKERS` 与 `TEST_REDIS_DB_BASE` 不能超出 Redis 默认的 16 个 DB。
- 每个数据库测试文件先清空 worker 的 MySQL/Redis 状态；中断后运行 `pnpm --filter @appserver/backend run test:db:clean`。

## 项目与 CI

- `backend-unit`：Node 纯单测，文件并行。
- `backend-database`：持久化、集成与运行时 operation 测试。
- `backend-contract`：schema 契约；运行时 operation 使用 database project。
- 前端使用单一 scheduler 与 worker threads。Node 测试不初始化 jsdom，DOM 测试按文件启用。

后端 CI 分离 unit 与 runtime；runtime job 提供 MySQL/Redis。前端 CI 可缓存生成的 Swagger/client，但缓存未命中和契约变更时必须重新生成。

## 排障

- 缺少 Prisma client：运行后端 wrapper 或 `db:generate`。
- 数据库启动失败：检查专用 `_test` 基础 URL 与创建/删除数据库权限。
- taxonomy 失败：按真实环境移动或重命名测试。
- 前端 transform 过慢：保持 Node-only 测试在 DOM suite 之外，避免 process forks。
