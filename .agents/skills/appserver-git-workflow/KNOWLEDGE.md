## 提交格式

```text
feat(relay): add catalog publication policy
fix(chat): preserve request-store token during streaming
docs: document local MCP workflow
test: isolate database worker cleanup
```

- subject 使用英文命令式短语；例如 `add`、`fix`、`preserve`、`document`。技术缩写可以保留标准大小写，例如 `MCP`、`OpenAPI`。
- scope 可省略；常见 scope 包含 `relay`、`chat`、`frontend`、`backend`、`billing`、`ci`。
- 不维护封闭 scope 列表。新增业务域可使用能解释改动的 kebab-case scope。
- `commitlint.config.js` 强制 Conventional Commit、非空 subject、100 字符 header、kebab-case scope 与无结尾句号。

## 提交钩子与命令

```bash
git status --short
git diff --cached --stat
pnpm exec commitlint --edit <commit-message-file>
pnpm run commit -- -m "fix(relay): preserve pooled route identity"
```

- `.husky/pre-commit` 对暂存文件执行 `lint-staged`。
- `.husky/commit-msg` 对提交消息执行 commitlint。
- 根 `pnpm run commit` 先运行完整 precommit，再使用正常 Git hook 提交；它不再传入 `--no-verify`。
- `git commit --no-verify` 只用于紧急恢复，且必须补充原因。

## 项目工具服务

项目 MCP 通过 `pnpm run mcp:serve` 启动。`.mcp.json` 提供通用 stdio 配置。可用工具是 `repo_context`、`git_impact`、`suggest_validation`、`draft_commit_message`、`read_file`、`run_check`；其中 `run_check` 只接受固定 validation profile。
