# 15 — Quyan CLI

## 定位

Quyan CLI 的正式实现是 `apps/cli-native` 中的 Rust + Ratatui 原生程序，提供账户状态、AI Relay 管理、凭证管理、配置适配和 JSON Endpoints 产品访问。它不依赖 Node.js 运行时。

无子命令执行 `quyan` 时打开 Ratatui 状态页：显示共享的 QuYan 字符画、版本、服务地址、语言、配置路径、凭证配置状态与最近事件。它不会显示任何凭证值；按 `q` 或 `Esc` 退出。配置或系统密钥链不可用时，状态页显示错误并使用安全默认值，以便用户仍能找到诊断信息。

## 目录边界

| 目录                       | 职责                                       |
| -------------------------- | ------------------------------------------ |
| `apps/cli-native/src/`     | Rust CLI、领域 service、配置和 Ratatui TUI |
| `apps/cli-native/build.rs` | 从 Swagger 生成 Rust typed client          |
| `apps/cli-native/target/`  | Cargo 构建与生成输出，不提交               |

## API 与凭证

| 用途           | 凭证                                           | 默认地址                                          |
| -------------- | ---------------------------------------------- | ------------------------------------------------- |
| 账户管理       | OAuth access/refresh token 或 `ak_` Access Key | `https://api.qysyw.cn`                            |
| AI Relay       | `rlt_` Relay Token                             | `https://ai.qysyw.cn`                             |
| JSON Endpoints | `dpk_` Product API Key                         | `https://api.qysyw.cn/v1/products/json-endpoints` |

三类凭证必须隔离保存和使用。refresh token、Access Key、Relay Token、Product Key 只写入系统密钥链；普通配置文件仅保存非敏感元数据。

## 日志与调试

每次 CLI 启动都会将诊断日志写入平台数据目录的 `Quyan/logs/`。默认仅保存必要的生命周期事件；`--debug` 将 HTTP 方法、路径、请求 ID、状态码、耗时及 OAuth、二维码和重放保护阶段同步输出到 stderr。日志和错误输出必须脱敏，禁止记录 access/refresh token、`ak_`、`rlt_`、`dpk_`、Authorization、签名数据、请求体或响应体。

`--json` 的 stdout 只能输出机器可解析的 JSON，不得混入字符画、进度或日志；诊断仍写入日志文件，错误仅写 stderr。

## OpenAPI 生成

根脚本先生成后端 TSOA Swagger。Rust CLI 的 `build.rs` 使用 Progenitor 从该 Swagger 生成 typed client，生成代码写入 Cargo `OUT_DIR`，不手工修改、不提交。生成 client 只负责 HTTP 类型和 endpoint，认证、重放签名、2FA 和凭证选择仍由 Rust service 负责。

```bash
pnpm run openapi:gen
cargo check --manifest-path apps/cli-native/Cargo.toml
```

## 验证

```bash
pnpm run check:cli:native
cargo test --manifest-path apps/cli-native/Cargo.toml
```

CLI 领域的代理规则位于
[`appserver-cli-development`](../../.agents/skills/appserver-cli-development/SKILL.md)。项目 MCP 的
`repo_context(domain: "cli")` 会返回该技能和 CLI 文档；`run_check` 提供
`cli-type-check`、`cli-test` 与 `cli-format` 三个无发布副作用的精确 profile。

## 打包与发布

CLI 只发布不依赖 Node.js 的 Rust 原生可执行文件。发布工作流使用 `ubuntu-latest` 和 `cargo-zigbuild` 交叉编译，避免依赖 `macos-13` runner 队列。支持的目标为 `windows-x64`、`linux-x64`、`linux-arm64`、`macos-x64` 和 `macos-arm64`。

```bash
pnpm run package:cli:native -- linux-x64
pnpm run pack:check:cli:native
```

制品位于 `apps/cli-native/dist/release/`，文件名包含 CLI 版本，每个制品都有对应的 `.sha256` 文件。Rust release 使用 size 优化、LTO、strip 和 panic abort；CI 将 12MB 作为硬限制，并报告 8MB 优化目标。Linux x64 在 CI 中执行 `--version` smoke test，其他平台进行文件、版本和 checksum 校验；Windows/macOS 原生运行验证通过手动 workflow 执行。

Rust CLI 版本以 `apps/cli-native/Cargo.toml` 为准，GitHub 标签使用 `quyan-v<version>`。Release workflow 只创建 GitHub Release 并上传五个平台制品与 checksum。macOS 制品暂未进行代码签名和 notarization。

涉及后端 Controller、DTO、schema 或共享契约时，额外执行 `pnpm run openapi:gen:all` 及受影响的后端/前端检查。
