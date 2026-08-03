---
name: appserver-git-workflow
description: 规范 AppServerMonorepo 的本地 Git 交付流程。准备暂存、选择最小验证、编写英文 Conventional Commit、使用 commit hook、检查工作树或提交前交接时使用；Pull Request 元数据工作改用 appserver-pr-workflow。
---

# Git 交付流程

提交前优先调用项目 MCP：`git_impact`、`suggest_validation`、`draft_commit_message` 和必要的 `run_check`。摘要不足时，再读取 [KNOWLEDGE.md](KNOWLEDGE.md)、`AGENTS.md` 和精确的开发文档。

## 工作流

1. 检查工作树、当前分支、暂存区与未暂存区；一次提交只保留一个可独立说明的逻辑改动。
2. 不混入无关格式化、生成噪音、密钥、环境文件或其他任务的改动。无法安全拆分时，先向用户说明风险。
3. 使用 `git_impact` 判断 backend、frontend、shared、OpenAPI、Prisma、权限与测试影响面，再使用 `suggest_validation` 选择最小验证。
4. 局部改动不要默认运行裸 `pnpm test`、全量 build 或 `pnpm run precommit`；Controller/DTO/schema 等跨应用契约仍按既有规则生成 OpenAPI。
5. 提交信息使用英文 Conventional Commit：`type(scope): imperative subject`。`scope` 可省略，存在时必须为 lower-case kebab-case；subject 应简洁、命令式，技术缩写可保留标准大小写；header 最长 100 字符，不以句号结尾。
6. 仅使用 `feat`、`fix`、`refactor`、`docs`、`test`、`ci`、`build`、`chore`、`style`、`perf`、`revert`。让 `draft_commit_message` 先校验草稿。
7. 正常提交经过 Husky `commit-msg` hook 的 commitlint 校验。紧急使用 `git commit --no-verify` 时，必须在交接或后续 PR 说明绕过原因与补做计划。
8. 交付时报告暂存范围、提交信息、验证命令、结果和未执行的高成本检查。

## 边界

- 不用 MCP 执行 Git 写操作、迁移、部署、安装依赖或任意 shell 命令。
- PR 标题、正文和标签不替代本地 commit 规范；PR 元数据使用 `appserver-pr-workflow`。
- 认证、权限、密钥和敏感日志改动同时读取 `appserver-security`。
