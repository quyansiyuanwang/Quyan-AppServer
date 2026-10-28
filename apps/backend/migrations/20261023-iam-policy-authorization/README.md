# IAM policy / authorization data migration — 20261023

这是独立的一次性业务数据迁移，不是 Prisma SQL migration，也不在常规构建或部署工作流中运行。

- `run.ts`：命令入口，读取现有环境配置、安全输出报告、失败非零退出。
- `migration.ts`：全范围只读预检 → 按账户回填 → 完整性验证的编排。
- `bundle.mjs`：显式打包无源码环境使用的 runner；输出到后端忽略目录 `.tmp/migrations/20261023-iam-policy-authorization/runner.cjs`。
- 数据访问、权限映射和幂等回填复用现有 Repository / Service；不复制授权规则。

命令：`pnpm --filter @quyan/backend run migration:iam -- --all-accounts`（默认只读），明确 `--apply` 才写入；也可选择 `--account-owner-id <id>`。`iam:migrate` 是兼容别名。独立打包使用 `pnpm --filter @quyan/backend run migration:iam:bundle`。

执行前必须验证备份、暂停所有写入并完成标准 Prisma 结构迁移。预检、漂移、回填或验证失败时保留维护窗口，修复后按相同范围重跑。迁移按记录提交，不承诺全库原子性，不操作 PM2、授权模式或密钥，不写入 Prisma 迁移记录。

完整操作步骤、无源码部署及恢复注意事项见[已有部署文档](../../../../docs/development/09-deployment.md#首次启用-iam独立的一次性数据迁移)。开发过程记录不属于本目录。
