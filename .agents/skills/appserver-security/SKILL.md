---
name: appserver-security
description: 审查或实现 AppServerMonorepo 的认证、授权、权限、Token、密钥、敏感日志、CI 凭据和开源安全改动。处理安全缺陷、RBAC、环境变量、重放保护、2FA、凭据处理或漏洞报告时使用。
---

# 安全

修改安全敏感行为前，先读取 `SECURITY.md`、`AGENTS.md`、`docs/development/07-authentication.md` 与 [KNOWLEDGE.md](KNOWLEDGE.md)。

## 工作流

1. 编辑前识别信任边界、认证主体、权限、资源范围与失败响应。
2. 必须在服务端强制授权；路由/菜单检查只用于展示。
3. 复用既有 JWT、Relay token、请求上下文、RBAC、重放保护、CAPTCHA、2FA 与业务审计工具。
4. 不得在源码、fixture、日志、DTO、浏览器 bundle、Swagger 示例或错误消息中放入密钥。所有 `VITE_*` 值一律按公开值处理。
5. 保持最小权限原则；不得让已有宽泛权限隐式获得新的敏感能力。
6. 测试允许、拒绝、缺少上下文、重放、过期与敏感数据脱敏路径。
7. 漏洞只能通过 GitHub Private Vulnerability Reporting 报告，不能在公开 Issue 讨论可利用细节。

## 开源检查

扫描完整 Git 历史；泄漏凭据先轮换再清理历史；审查生产 host/默认账户；确认 fork PR 的 CI job 无法获取生产 secret。权限/类型契约使用 `appserver-contracts`，测试范围使用 `appserver-testing-ci`。
