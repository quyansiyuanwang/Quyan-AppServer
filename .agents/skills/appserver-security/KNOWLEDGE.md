## 认证与授权

- JWT access/refresh token 由 `src/util/auth/index.ts` 与 auth guard 处理。
- Relay API token 使用 `rlt_` 前缀，与网页 JWT session 不同。
- 最终权限等于组权限加额外权限减移除权限。
- `@Security(...)` 负责认证，`@CheckPermission(...)` 负责 RBAC。
- `@ReplayProtected`、CAPTCHA、2FA challenge 装饰器是接口级保护，不能替代授权。

## 敏感数据与政策

- 管理 DTO 只返回安全的 key 配置状态，不能返回上游 API key。
- 不得记录 Authorization header、原始 token、密码、签名 secret 或未脱敏上游 payload。
- 测试凭据仅限测试环境。`VITE_*` 变量会暴露给浏览器。
- `SECURITY.md` 要求私密漏洞报告、全历史 secret 扫描、先轮换后清理、CAPTCHA 域名限制、Secret Scanning、Push Protection 与 Dependabot。
