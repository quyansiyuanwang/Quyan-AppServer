---
name: appserver-cli-development
description: 使用 Rust/Ratatui 开发或审查 Quyan 原生 CLI；涉及 apps/cli-native、Progenitor OpenAPI client、凭证隔离、TUI、跨平台打包或 CLI 发布时使用。
---

# Quyan CLI 开发

## 必读来源

- 先读 `apps/cli-native/README.md` 与 `docs/development/15-cli.md`。
- 涉及 Swagger、DTO、权限或 wire contract 时加入 `appserver-contracts`。
- 涉及 token、OAuth、keyring、重放保护或 2FA 时加入 `appserver-security`。
- 选择测试范围时使用 `appserver-testing-ci`；提交时使用 `appserver-git-workflow`。

## 工作流

1. 确认改动属于 `apps/cli-native/src/services/`、`core`（API/配置/凭证）、`tui` 或构建发布脚本，并复用现有服务边界。
2. 修改后端契约先运行 `pnpm run openapi:gen`。Rust `build.rs` 使用 `apps/backend/src/build/swagger.json` 生成 client 到 Cargo `OUT_DIR`；不得手动编辑或提交生成源码。
3. 生成 client 只负责类型、路径和请求结构。认证选择、凭证类型、响应 envelope、重放签名、重试、2FA 和业务错误映射必须留在手写 service/API 层。
4. 账户 OAuth/`ak_`、Relay `rlt_` 和 JSON 产品 `dpk_` 凭证必须隔离；敏感值只能进系统 keyring、stdin、交互输入或环境变量，不得写入普通配置、日志或制品。
5. 人类输出可显示共享 QuYan 字符画；`--json` 必须只输出机器可解析 JSON。TUI 使用 Ratatui/Crossterm，保持加载、错误、空状态和退出清理行为。
6. 先运行 `pnpm run check:cli:native` 和 `cargo test --manifest-path apps/cli-native/Cargo.toml`。发布相关改动再运行 `pnpm run package:cli:native`，核对制品命名、版本、checksum 和 12MB 限制。

## 边界

- 不恢复 Node/Ink CLI，不新增 Vue TUI，也不把 CLI 加入 pnpm workspace。
- 不把 API Key、Relay Token、Product Key 或本地配置打入二进制；不修改 `docs/tmp`。
- 不在 Rust 源码中复制共享权限或手写 OpenAPI DTO；跨应用契约以后端 TSOA 和 `packages/shared` 为准。
