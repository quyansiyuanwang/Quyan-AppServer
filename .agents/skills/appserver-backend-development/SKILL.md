---
name: appserver-backend-development
description: 实现或审查 AppServerMonorepo 后端改动。涉及 Express、TSOA Controller、DTO、Service、Repository、Prisma、Relay 路由、认证、授权、中间件或后端测试时使用；适用于后端缺陷修复、新接口、数据库变更和服务层重构。
---

# 后端开发

修改后端前，优先使用 MCP `repo_context` 与 `git_impact` 获取摘要；需要原文证据时再读取 `AGENTS.md`、`apps/backend/CLAUDE.md` 和 [KNOWLEDGE.md](KNOWLEDGE.md)。涉及架构、数据库、认证或 OpenAPI 时，再读取对应 `docs/development/` 文档。

## 工作流

1. 编辑前定位现有 Controller、Service、Repository、schema 与相邻测试。
2. 保持 `Controller -> Service -> Repository -> Prisma` 分层。路由使用 TSOA 装饰器定义；不创建手写路由注册，也不编辑 `src/build`。
3. 复用单例 `getInstance()` 的 Service/Repository、既有错误类、权限装饰器、日志、重放保护和 2FA 守卫。
4. 保持 Relay 模型/能力身份与池路由在同一根到叶路径上关联；不得重新组合来自不同路径的能力集合。
5. Relay 混池同时存在 legacy 成员表与 strict 父子关系时，先形成唯一的有效成员投影，再用于 DTO、列表计数和路由；按成员 ID 去重，strict 配置覆盖冲突的 legacy 配置。
6. 用户可见的业务校验错误使用后端 locale `messageKey`，并为 `zh-CN` 和 `en` 添加回归断言；不得直接暴露未本地化的源码错误。
7. Prisma schema 改动必须生成迁移；禁止手写、复制或编辑 migration SQL。
8. Controller、DTO、schema 或安全契约变更后执行 `pnpm run openapi:gen:all`，再执行精确测试和 `pnpm --filter @quyan/backend run type-check`。
9. 交付时列出已执行的检查与刻意未执行的高成本检查。

## 边界

- 不得在 DTO、日志、测试或导出中暴露 API key、token secret 或敏感上游配置。
- 不得绕过权限检查、请求上下文、重放保护、事务边界或既有计费/路由流程。
- shared/OpenAPI 变更使用 `appserver-contracts`；认证/密钥变更使用 `appserver-security`；测试选择使用 `appserver-testing-ci`。
