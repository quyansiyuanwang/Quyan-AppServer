---
name: appserver-skill-authoring
description: 为 AppServerMonorepo 创建、修改、审查或精简 .agents/skills 下的仓库技能时使用。适用于新增领域技能、将技能说明改为中文、补充知识边界、消除重复规则、修复技能目录或 frontmatter 校验失败，以及为现有开发流程编排可复用 Agent 工作流。
---

# 技能编写

开始前优先调用项目 MCP 的 `repo_context`（`domain: skills`）和 `git_impact`；只有摘要不足时才读取 [KNOWLEDGE.md](KNOWLEDGE.md)、`AGENTS.md`、目标应用文档及相邻技能。

## 工作流

1. 先判断现有技能能否覆盖请求。只有出现稳定、可复用且与现有技能职责不同的工作流时才新增技能；不为一次性任务、单一文件说明或可由现有技能自然完成的工作额外建目录。
2. 新建技能时使用 `skill-creator` 的 `init_skill.py` 初始化到 `.agents/skills/`；随后删除初始化器生成的 `agents/openai.yaml`、示例和无关资源。每个仓库技能目录最终只能保留 `SKILL.md` 与按需存在的 `KNOWLEDGE.md`。
3. `SKILL.md` 的 frontmatter 中 `name` 必须与目录名一致，只使用小写字母、数字和连字符；`description` 用中文准确写出能力和触发条件。正文使用中文，保留代码、命令、路径、协议名和产品名称的原始拼写。
4. `SKILL.md` 只保留执行顺序、必读来源、关键边界、交叉技能和验证要求。稳定但不显而易见的领域事实放入 `KNOWLEDGE.md`；不要复制整份 `AGENTS.md`、开发文档或其他技能。
5. 明确事实来源优先级：`AGENTS.md`、`CLAUDE.md`、应用级指引和 `docs/development/` 是事实来源，skill 只能引用和提炼，不能与其冲突。涉及安全、契约、测试、Git 或 PR 时链接到对应领域 skill。
6. 新增或调整技能后，同步更新根 `AGENTS.md` 的技能索引，以及项目 MCP 的技能清单、领域过滤或 Git 影响面规则（确有影响时）。不把产品实现规则写进不相关的通用技能。
7. 交付前检查没有遗留待补充占位符、英文说明段落、失效路径、重复大段规则或未声明的资源目录；验证 frontmatter、目录边界、Markdown 格式和 `git diff --check`。

## 边界

- 不在 skill 中写真实密钥、生产地址、私有部署信息或可执行的危险默认命令。
- 不将“先读全部文档”作为默认步骤；优先 MCP 摘要，再按需读取精确来源，避免无效上下文消耗。
- 不用 skill 替代产品代码、测试、CI 或安全政策本身；规则变更必须回到各自事实来源完成。
