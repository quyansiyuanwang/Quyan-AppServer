## 仓库约定

- 标题使用 Conventional Commit，例如 `feat(balance): ...`。
- 正文按提交时间倒序：`- <subject> (<short-sha>)`。
- `staging -> master` 等提升 PR 保留所需已合并功能 PR 行及其底层提交。
- 标签反映 `frontend`、`backend`、`api`、`feature`、`bug` 等实际影响；不要因为功能包含测试就添加 `test`。

## 安全命令

```bash
gh pr view <number> --repo <owner>/<repo> --json number,title,body,baseRefName,labels,commits,files,statusCheckRollup
gh pr diff <number> --repo <owner>/<repo> --color=never
gh pr list --repo <owner>/<repo> --state merged --base <base-branch> --limit 15 --json number,title,body,labels,mergedAt,url
gh pr edit <number> --repo <owner>/<repo> --title "<title>" --body "<body>"
gh pr view <number> --repo <owner>/<repo> --json title,body,labels,url
```

必须显式给出仓库与 PR 标识，不得根据无关分支状态猜测目标。
