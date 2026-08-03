---
name: appserver-pr-workflow
description: 检查并安全更新 AppServerMonorepo GitHub Pull Request 的元数据、标题、正文、标签、提交与检查状态。审查 PR 上下文、对齐 PR 风格、准备发布提升 PR 元数据或仅编辑 PR 而不合并时使用。
---

# 拉取请求工作流

操作 GitHub PR 前，先读取 `AGENTS.md`、`docs/development/10-pr-management.md` 和 [KNOWLEDGE.md](KNOWLEDGE.md)。

本地暂存、验证和 commit message 使用 `appserver-git-workflow`；PR 标题、正文和标签不能替代单个本地提交的 Conventional Commit 规范。

## 工作流

1. 使用 `gh pr view` 与 `gh pr diff` 读取目标 PR 的元数据、完整 diff、提交、文件、目标分支、标签与检查。
2. 修改标题、正文或标签前，先读取同一目标分支近期已合并的 PR。
3. 标题使用与主要影响领域匹配的 Conventional Commit。
4. 正文按时间倒序列出提交，保留短 SHA 与需要的发布提升 PR 引用。
5. 标签只反映实际影响面；功能改动附带测试不自动添加 `test` 标签。
6. 仅为用户要求的元数据执行 `gh pr edit`，随后读取 `title`、`body`、`labels` 与 `url` 回验。
7. 单独报告失败/跳过的检查。没有用户明确授权不得合并。

## 安全边界

- 未读取现有正文/标签前不得覆盖。
- 元数据修改不代表 CI 已通过。
- PR 元数据工作不得修改代码、分支、release 或部署状态。
