# Security Policy / 安全政策

## Reporting a vulnerability / 漏洞报告

Please do not disclose exploitable security issues in public GitHub issues, discussions, pull requests, or chat channels. Use this repository's GitHub **Private Vulnerability Reporting** channel from the Security tab.

请勿在公开 Issue、Discussion、Pull Request 或聊天频道披露可利用的安全问题。请通过仓库 Security 页面中的 GitHub **Private Vulnerability Reporting** 私密报告渠道提交。

Maintainers should enable Private Vulnerability Reporting before making the repository public. Reports should include affected versions or commits, reproduction steps, impact, and any proposed mitigation. We will acknowledge receipt, assess the report, coordinate a fix, and agree on disclosure timing before publishing technical details.

仓库公开前，维护者必须在 GitHub Security 设置中启用私密漏洞报告。报告应包含受影响版本或提交、复现步骤、影响范围及建议缓解措施。维护者会确认收到、评估影响、协调修复，并在公开技术细节前与报告者协商披露时间。

## Supported scope / 支持范围

Reports concerning the backend API, authentication and authorization, relay routing, billing, secrets handling, CI/CD, or the web applications are in scope. Third-party service outages, social engineering, and issues requiring access to production credentials are out of scope unless they demonstrate a defect in this repository.

## Before publishing / 开源前检查

- Scan the complete Git history with a secret scanner such as Gitleaks or TruffleHog, not only the current working tree.
- If a credential is found, revoke or rotate it at the provider first, then remove it from history. Deleting the current file alone is insufficient.
- Confirm every `VITE_*` value is safe to ship to browsers. Frontend build variables are public by design.
- Restrict reCAPTCHA and Turnstile site keys to approved domains and monitor their quotas.
- Review production URLs, internal hosts, server IPs, default accounts, deployment paths, database URLs, OAuth credentials, payment credentials, and relay upstream keys.
- Enable GitHub Secret Scanning, Push Protection, Dependabot alerts, and Dependabot security updates.
- Keep CI secrets unavailable to untrusted fork pull requests and do not use production credentials in test workflows.
- Treat tracked test credentials as test-only. Never reuse test JWT, signing, database, Redis, OAuth, or relay values in production.
