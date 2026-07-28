# GitHub PR 管理流程

本文记录仓库中使用 GitHub CLI 处理已有 PR 标题、正文和标签的标准流程。

## 读取与判断

先读取 PR 元数据和完整差异，确认目标分支、提交序列、影响应用、检查状态以及现有标签：

```bash
gh pr view <number> --repo <owner>/<repo> --json number,title,body,baseRefName,labels,commits,files,statusCheckRollup
gh pr diff <number> --repo <owner>/<repo> --color=never
```

再按 PR 的目标分支读取近期已合并 PR，而不是只参考任意近期 PR：

```bash
gh pr list --repo <owner>/<repo> --state merged --base <base-branch> --limit 15 --json number,title,body,labels,mergedAt,url
```

## 元数据风格

- 标题使用 Conventional Commit，范围应描述该 PR 的主要业务域。
- 正文按提交时间倒序列出：`- <commit subject> (<short sha>)`。
- `staging -> master` 的提升 PR 同时保留已合并功能 PR 的 `(#number)` 合并提交和其底层提交，保持发布历史可追溯。
- 标签只表示实际影响面和改动性质。附带测试不单独构成 `test` 标签；测试为主要内容时才添加。

## 编辑与核验

使用 `gh pr edit` 写入标题、正文和标签，然后必须回读核验：

```bash
gh pr edit <number> --repo <owner>/<repo> --title "<title>" --body "<body>" --add-label frontend
gh pr view <number> --repo <owner>/<repo> --json title,body,labels,url
```

自动 PR 元数据或自动标签工作流失败时，可以手动完成上述元数据职责并报告失败检查；不得将该操作视为 CI 通过，也不得在没有用户明确授权时合并 PR。

## 已记录案例：#127 与 #128

2026-07-28 处理 #127 和 #128 时，两者的主要改动均为余额历史表展示渠道倍率，因此统一采用标题 `feat(balance): add channel multiplier column to transaction history table`，标签为 `frontend`、`feature`、`bug`。

- #127 正文按倒序记录前端修复提交 `011f0b4` 与功能提交 `d7bf869`。
- #128 为 `staging -> master` 提升 PR，正文先保留合并提交 `feat(balance): add channel multiplier column to transaction history table (#127) (631495a)`，再保留 #127 的两个底层提交。
- 自动元数据/标签检查未通过或被跳过时，已通过 `gh pr edit` 手动补全并用 `gh pr view` 回读核验；该操作不代表 CI 通过，两个 PR 均未合并。
