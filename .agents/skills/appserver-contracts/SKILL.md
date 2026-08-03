---
name: appserver-contracts
description: 维护 AppServerMonorepo 的共享类型、权限、错误码、DTO、TSOA/OpenAPI 契约、生成 client 与跨应用兼容性。修改 packages/shared、API schema、权限、生成 SDK 行为或前后端 wire contract 时使用。
---

# 共享契约

编辑共享类型或 API 契约前，先读取 `AGENTS.md`、`docs/development/04-shared-package.md`、`docs/development/08-openapi-pipeline.md` 和 [KNOWLEDGE.md](KNOWLEDGE.md)。

## 工作流

1. 修改看似重复的常量或类型前，先找到唯一规范源。
2. 共享 Permission、错误码、状态和协议类型放在 `packages/shared/src/`；应用侧只 re-export，不重新定义。
3. 接口变更更新 TSOA Controller/DTO，并执行 `pnpm run openapi:gen:all`。
4. 禁止手动编辑 `apps/frontend/src/client/` 或生成的 Swagger/client 文件。
5. 新增权限时，同步枚举、权限元数据、种子定义、路由/菜单 guard、翻译与权限校验脚本。
6. 保持响应包装与既有 wire 字段兼容；需要兼容旧 client 时，新响应字段应为 optional。
7. 执行契约测试、受影响应用测试与两端类型检查。

## 边界

- 不得在应用内复制共享权限或协议逻辑。
- 前端可见性检查不能替代服务端授权。
- 实现细节使用 `appserver-backend-development`、`appserver-frontend-development`；验证范围使用 `appserver-testing-ci`。
