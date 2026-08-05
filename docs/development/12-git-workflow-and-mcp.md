# Git 交付与项目 MCP

## 本地交付

提交按英文 Conventional Commit 编写：

```text
type(scope): imperative lowercase subject
```

- 可用 type：`feat`、`fix`、`refactor`、`docs`、`test`、`ci`、`build`、`chore`、`style`、`perf`、`revert`。
- scope 可省略；存在时使用 lower-case kebab-case。
- subject 使用英文命令式短语，不以句号结尾；整个 header 最长 100 字符。技术缩写可以保留标准大小写，例如 `MCP`、`OpenAPI`。
- 一次提交只处理一个可独立说明的逻辑改动，不混入无关格式化、秘密、环境文件或生成噪音。

Husky 会在提交时运行：

- `.husky/pre-commit`：对暂存文件执行 `lint-staged`。
- `.husky/commit-msg`：通过 `commitlint` 校验提交信息。

```bash
git status --short
git diff --cached --stat
pnpm run commit -- -m "fix(relay): preserve pooled route identity"
```

根 `commit` 脚本会先运行完整 `precommit`，然后使用正常 Git hook 提交。紧急恢复可使用 Git 原生 `--no-verify`，但必须在交接或 PR 中记录原因及补做验证。

局部修复优先执行影响面对应的精确测试与类型检查。不要因为一个局部修复默认运行裸 `pnpm test`、全量 build 或 `pnpm run precommit`。

## 项目 MCP

`@appserver/mcp` 是本机 stdio MCP server，不启动 HTTP 服务、不保存状态、不提供任意 shell 或 Git 写入能力。

```bash
pnpm run mcp:serve
```

仓库根目录的 `.mcp.json` 提供通用 `mcpServers` 配置。支持该格式的客户端可直接导入；其他客户端应登记等价配置：

```json
{
  "command": "pnpm",
  "args": ["run", "mcp:serve"],
  "cwd": "<repository-root>",
  "env": {
    "APPSERVER_MCP_ROOT": "<repository-root>"
  }
}
```

### 工具

| 工具                   | 用途                                                    |
| ---------------------- | ------------------------------------------------------- |
| `repo_context`         | 返回紧凑的仓库、技能、文档与核心约束摘要                |
| `git_impact`           | 分析工作区、暂存区或 ref range 的文件、风险和建议 skill |
| `suggest_validation`   | 从影响面生成确定性的验证 profile，不执行命令            |
| `draft_commit_message` | 校验短英文摘要，生成 Conventional Commit 草稿           |
| `read_file`            | 按行读取受路径、大小和敏感文件规则限制的文本            |
| `run_check`            | 直接执行固定白名单验证 profile                          |

`run_check` 允许精确后端/前端测试、类型检查、taxonomy、`lint:check`、`format:check`、应用质量检查和 `openapi:gen:all`。数据库、集成、runtime 测试与 OpenAPI 也会按调用直接执行，但 MCP 永远拒绝任意命令、额外参数、`db push`、迁移、部署、依赖安装和 Git 写操作。

`read_file` 拒绝仓库外路径、symlink 逃逸、`.git`、`.env*`、私钥、认证文件、`node_modules`、构建产物、coverage 与二进制文件。所有工具的输出有固定大小上限，并在截断时标记，避免将大文件或完整 diff 送入上下文。

### Codex 接入

Codex 会自动读取仓库根目录的 `AGENTS.md`，并按当前工作目录继续读取更近的嵌套 `AGENTS.md`。`.agents/skills/` 保持仓库内的技能唯一来源；按任务需要显式使用 `appserver-backend-development`、`appserver-contracts`、`appserver-testing-ci` 等技能即可，不需要复制到用户目录。

仓库同时提供项目级 `.codex/config.toml`，将本地 MCP 注册为 `appserver`。在受信任的仓库目录启动 Codex 后，可用以下命令确认配置：

```bash
codex mcp list
```

Codex TUI 中可使用 `/mcp` 查看已连接的工具。若客户端尚未加载项目配置，也可以从仓库根目录执行备用注册命令：

```bash
codex mcp add appserver -- pnpm run mcp:serve
```

本地直接检查 MCP server 是否能启动：

```bash
pnpm run mcp:serve
```

## 与 Skills 协作

领域 skill 应优先调用 `repo_context`、`git_impact` 或 `suggest_validation`，只在摘要不足或需要证据时读取完整规范。提交工作使用 `appserver-git-workflow`；PR 标题、正文和标签使用 `appserver-pr-workflow`，两者不能互相替代。
