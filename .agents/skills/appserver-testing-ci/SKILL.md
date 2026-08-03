---
name: appserver-testing-ci
description: 为 AppServerMonorepo 选择、运行、排查和维护 Vitest 测试与 CI 检查。新增测试、修改测试配置、排查慢测或不稳定测试、选择 unit/database/integration/contract 或 Node/DOM 测试、调整隔离与并行时使用。
---

# 测试与 CI

修改或运行测试前，优先调用 MCP `git_impact` 和 `suggest_validation`；需要测试原文规则时再读取 `AGENTS.md`、`docs/development/11-testing-and-ci.md`、对应应用的 `tests/README.md` 与 [KNOWLEDGE.md](KNOWLEDGE.md)。

## 工作流

1. 按真实依赖而非模块名称分类：
   - 后端单测：`tests/unit/**/*.unit.test.ts`
   - 后端数据库测试：`tests/database/**/*.db.test.ts`
   - 后端集成测试：`tests/integration/**/*.integration.test.ts`
   - 后端契约测试：`tests/contract/**/*.contract.test.ts`
   - 前端 Node 测试：`tests/node/**/*.node.test.ts`
   - 前端 DOM 测试：`tests/dom/**/*.dom.test.ts`
2. 优先运行最小的精确文件/目录命令；局部修复不要默认执行裸 `pnpm test`、全量构建或 precommit。
3. 纯单测不得依赖 Prisma、MySQL、Redis、HTTP server 或浏览器全局对象；依赖变化时迁移测试。
4. 后端必须通过 `tests/scripts/run-vitest.mjs` 运行，并保留其独立数据库/Redis 运行时。
5. 区分断言失败与 setup、worker、cleanup、taxonomy、transform 失败；不得为了通过测试削弱隔离。
6. CI 保持单测 job 与 MySQL/Redis 运行时 job 的分层。

## 常用命令

```bash
pnpm --filter @appserver/backend run test:unit
pnpm --filter @appserver/backend run test:database
pnpm --filter @appserver/backend run test:integration
pnpm --filter @appserver/backend run test:contract
pnpm --filter @appserver/backend run test:runtime
pnpm --filter @appserver/backend run test:db:clean
pnpm --filter @appserver/frontend run test:node
pnpm --filter @appserver/frontend run test:dom
pnpm --filter @appserver/frontend run test:taxonomy
```

后端依赖关联选择使用 `test:related`；仅在明确需要全量验证时运行根 `pnpm run test`。
