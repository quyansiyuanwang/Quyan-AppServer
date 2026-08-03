# Security Policy / 安全政策

## Reporting a vulnerability / 漏洞报告

Please do not disclose exploitable security issues in public GitHub issues, discussions, pull requests, or chat channels. Use this repository's GitHub **Private Vulnerability Reporting** channel from the Security tab.

请勿在公开 Issue、Discussion、Pull Request 或聊天频道披露可利用的安全问题。请通过仓库 Security 页面中的 GitHub **Private Vulnerability Reporting** 私密报告渠道提交。

Maintainers should enable Private Vulnerability Reporting before making the repository public. Reports should include affected versions or commits, reproduction steps, impact, and any proposed mitigation. We will acknowledge receipt, assess the report, coordinate a fix, and agree on disclosure timing before publishing technical details.

仓库公开前，维护者必须在 GitHub Security 设置中启用私密漏洞报告。报告应包含受影响版本或提交、复现步骤、影响范围及建议缓解措施。维护者会确认收到、评估影响、协调修复，并在公开技术细节前与报告者协商披露时间。

## Supported scope / 支持范围

Reports concerning the backend API, authentication and authorization, relay routing, billing, secrets handling, CI/CD, or the web applications are in scope. Third-party service outages, social engineering, and issues requiring access to production credentials are out of scope unless they demonstrate a defect in this repository.

支持范围包括后端 API、认证与授权、中转路由、计费、密钥处理、CI/CD 以及各个 Web 应用。第三方服务中断、社会工程攻击，以及必须先获得生产凭据才能复现的问题不在范围内；但如果这些问题能够证明是本仓库自身缺陷导致的，仍可提交报告。

## Before publishing / 开源前检查

- Scan the complete Git history with a secret scanner such as Gitleaks or TruffleHog, not only the current working tree.
- 使用 Gitleaks 或 TruffleHog 等 secret scanner 扫描完整 Git 历史，不能只扫描当前工作树。
- If a credential is found, revoke or rotate it at the provider first, then remove it from history. Deleting the current file alone is insufficient.
- 如果发现凭据，先在对应服务商处撤销或轮换，再从 Git 历史中清理；只删除当前文件并不足够。
- Confirm every `VITE_*` value is safe to ship to browsers. Frontend build variables are public by design.
- 确认每个 `VITE_*` 值都可以安全下发到浏览器；前端构建变量按设计就是公开值。
- Restrict reCAPTCHA and Turnstile site keys to approved domains and monitor their quotas.
- 将 reCAPTCHA 和 Turnstile site key 限制在批准的域名，并监控其配额。
- Review production URLs, internal hosts, server IPs, default accounts, deployment paths, database URLs, OAuth credentials, payment credentials, and relay upstream keys.
- 审查生产 URL、内网主机、服务器 IP、默认账号、部署路径、数据库 URL、OAuth 凭据、支付凭据和中转上游密钥。
- Enable GitHub Secret Scanning, Push Protection, Dependabot alerts, and Dependabot security updates.
- 启用 GitHub Secret Scanning、Push Protection、Dependabot alerts 和 Dependabot security updates。
- Keep CI secrets unavailable to untrusted fork pull requests and do not use production credentials in test workflows.
- 确保不受信任的 fork Pull Request 无法访问 CI secret，并且测试工作流不得使用生产凭据。
- Treat tracked test credentials as test-only. Never reuse test JWT, signing, database, Redis, OAuth, or relay values in production.
- 将仓库中记录的测试凭据视为仅限测试环境使用；不得在生产环境复用测试 JWT、签名密钥、数据库、Redis、OAuth 或中转配置值。
