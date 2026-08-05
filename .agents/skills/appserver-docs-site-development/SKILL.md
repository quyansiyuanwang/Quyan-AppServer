---
name: appserver-docs-site-development
description: 编写、更新或审查 AppServerMonorepo 的公开 docs-site 文档；当新增或改变用户可见页面、路由、功能流程、管理配置、权限条件、计费或业务语义时使用，并在实现中评估和同步文档站。
---

# 文档站开发

开始前先阅读 `docs/development/13-docs-site.md`，再读取受影响页面、接口或配置的实际实现。文档只描述已经实现、可由用户观察到的行为。

## 同步流程

1. 判断影响：新增用户可访问页面或导航、改变主要操作流程/限制/权限、调整用户可见配置、计费或业务结果时，必须更新 docs-site。纯内部重构、修复不改变用户行为的样式问题通常无需单独更新。
2. 选择文档边界：同一页面的新增能力更新既有 slug；独立且可导航的用户工作流新增 slug。不要为单一字段或按钮新建页面。
3. 同步 `apps/docs-site/src/content/zh-CN/<slug>.md` 与 `apps/docs-site/src/content/en/<slug>.md`，并在对应 `src/docs/modules/<domain>/` 创建或更新 `*.doc.ts` 元数据及该模块 `index.ts` 注册顺序。
4. 新增主站路由的文档时，更新 `apps/frontend/src/config/docs.ts`，使站内文档按钮跳转到正确 slug。术语会在多页重复或容易误解时，再更新 `apps/docs-site/src/docs/glossary/modules/`。
5. 保持两种语言的结构和语义等价：说明用途、前提/可用条件、关键操作、不可逆或费用等后果、状态/限制及相关页面。用用户语言描述，不复制内部类名、数据库表名或实现细节。

## 内容与边界

- 以前端实际页面、后端公开接口与配置为事实来源；涉及 API 契约时使用 `appserver-contracts`，涉及认证、权限或敏感操作时使用 `appserver-security`。
- 文档不得包含密钥、内部地址、用户数据、绕过权限的方法或未发布的行为。费用、配额、权限和默认值要注明由当前服务端配置或创建时快照决定。
- 新页面元数据使用 `defineDocsPage`，slug 与两个 Markdown 文件一致；设置真实 `updatedAt`，并给出可搜索的双语标题、摘要和 tags。
- 不手动修改生成客户端。文档站只维护 `apps/docs-site/`，主站路由映射仅在需要文档跳转时修改。

## 验证

文档或注册改动完成后运行：

```bash
pnpm exec prettier --write <changed-docs-files>
pnpm --filter @appserver/docs-site run type-check
pnpm --filter @appserver/docs-site exec eslint <changed-source-files>
git diff --check
```

只在用户要求发布级验证时运行 docs-site 全量构建。页面、路由或主站文档映射同时变化时，还需运行受影响主站的最小类型检查。
