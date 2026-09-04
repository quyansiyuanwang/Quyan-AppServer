# 13 - Docs Site 文档规范

`apps/docs-site/` 是 AppServer 的公开产品文档。它应与已发布的用户体验同步，而不是记录内部实现过程。

## 何时必须更新

出现以下任一变化时，在同一功能改动中评估并同步 docs-site：

- 新增、移除或显著调整用户可见页面、路由或导航入口。
- 新增或改变用户/管理员的主要操作流程、可见状态、限制、不可撤回结果或计费结果。
- 新增或改变会影响用户行为的配置项、权限前提、2FA 要求或功能开关。
- 改变公开 API、SDK 或产品用法。

纯视觉微调、内部重构、日志字段或不改变用户行为的缺陷修复通常不需要独立文档改动。无法确定时，优先更新既有页面的简短说明，或在交付说明中明确不更新的理由。

## 文档结构

每个公开页面使用同一 slug 的四个组成部分：

```text
apps/docs-site/src/content/zh-CN/<slug>.md
apps/docs-site/src/content/en/<slug>.md
apps/docs-site/src/docs/modules/<domain>/<slug>.doc.ts
apps/docs-site/src/docs/modules/<domain>/index.ts
```

- 两个 Markdown 文件必须同时存在，结构和行为说明保持等价。
- `*.doc.ts` 使用 `defineDocsPage` 注册 slug、分类、标题、摘要、tags、内容和真实的 `updatedAt`。
- 模块 `index.ts` 在稳定的展示顺序中注册页面；重复 slug 会在 registry 创建时失败。
- 主站新路由若需要文档按钮跳转，更新 `apps/frontend/src/config/docs.ts` 的 route-to-slug 映射。
- 新术语在多页重复出现、易混淆或与计费/权限相关时，更新 `src/docs/glossary/modules/` 的对应模块。

## 写作要求

文档以用户任务为中心，至少包含：

1. 页面或功能用途。
2. 可见内容、前提条件和可用范围。
3. 关键操作步骤及结果。
4. 费用、配额、权限、不可撤回、有效期、状态或其他重要限制。
5. 常见失败原因或注意事项，以及相关页面。

从实际前端、后端公开接口和当前配置语义取证。不要承诺未实现能力，不要复制数据库模型、内部服务名或源码细节。不得写入密钥、内部服务地址、真实用户数据、权限绕过方式或敏感运维信息。

对于服务端可动态调整的费用、配额和开关，说明它们以当前服务端配置为准；对于创建时固化的参数，明确说明其使用快照结算。

## 验证与交付

文档改动至少执行：

```bash
pnpm exec prettier --write <changed-docs-files>
pnpm --filter @quyan/docs-site run type-check
pnpm --filter @quyan/docs-site exec eslint <changed-source-files>
git diff --check
```

只在发布级验证或用户明确要求时运行 docs-site 全量构建。功能同时修改主站路由或 `config/docs.ts` 时，额外运行主站的最小类型检查。

对应执行流程见 `.agents/skills/appserver-docs-site-development/SKILL.md`。
