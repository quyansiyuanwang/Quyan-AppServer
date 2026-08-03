# 技能编写知识

## 目录约束

- 仓库技能位于 `.agents/skills/<技能名>/`。
- 目录仅允许 `SKILL.md`，以及确有领域事实需要延迟加载时的 `KNOWLEDGE.md`。
- 禁止保留 `agents/openai.yaml`、README、脚本、模板、示例、资源目录或初始化器占位内容。
- `name` 与目录名必须完全相同，且仅使用小写字母、数字和连字符。

## 中文规则

- 面向 Agent 的标题、说明、流程、知识和报错指引使用中文。
- 不翻译代码标识符、命令、文件路径、API 名称、标准名或用户实际可见的英文产品术语，例如 `SKILL.md`、`pnpm run test`、`Conventional Commit`。
- 不保留模板中的待补充占位符、英文示例段落或泛化的资源说明。

## 内容分层

- `SKILL.md`：触发条件、最小工作流、必读证据、边界和验证。
- `KNOWLEDGE.md`：目录职责、具体命令、非显而易见的项目约束、常见误判与交叉技能映射。
- 原始规则仍由 `AGENTS.md`、`CLAUDE.md`、`SECURITY.md` 和 `docs/development/` 维护；技能引用它们，不复制整篇内容。

## 交叉使用

- 后端实现：`appserver-backend-development`。
- 前端实现：`appserver-frontend-development`。
- 共享契约与 OpenAPI：`appserver-contracts`。
- 测试与 CI：`appserver-testing-ci`。
- 认证、权限和敏感数据：`appserver-security`。
- 本地暂存、验证和提交：`appserver-git-workflow`。
- GitHub PR 元数据：`appserver-pr-workflow`。

新增技能后，根 `AGENTS.md` 和 MCP `repo_context` 应能发现它；如果 Git 影响面需要给出更精确的建议，也更新 MCP 的技能分类。
