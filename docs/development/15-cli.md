# 15 — Quyan CLI

## 定位

Quyan CLI 的正式实现是 `apps/cli-native` 中的 Rust + Ratatui 原生程序，提供账户状态、AI Relay 管理、凭证管理、配置适配和 JSON Endpoints 产品访问。它不依赖 Node.js 运行时。

无子命令执行 `quyan` 时打开 Ratatui 控制台：显示共享的 QuYan 字符画、版本、服务地址、凭证配置状态与最近事件，并提供账户登录、AI Relay、客户端适配、JSON Endpoints、配置与诊断的可导航操作目录。主页菜单显式编号为 `1` 至 `6`，按对应数字可直接打开；也可以按 `Up`/`Down` 或 `j`/`k` 选择后按 `Enter`。右侧始终显示当前项的功能、凭证边界与快捷键，`?`/`h` 显示完整按键帮助，`q` 或 `Esc` 退出。

所有目录项在 TUI 内都有对应实际行为：浏览器登录启动 OAuth 流程，账户概览读取资料/余额/用量，JSON Endpoints 读取产品实例，配置与诊断显示脱敏运行状态。客户端适配在 TUI 中按工具预览并确认写入：Tab/方向键选择 Claude Code、Codex 或 pi，输入模型后 Enter 预览，y 确认并备份，n 取消；CLI 的 `quyan apply` 不带 client 只列出适配器。`quyan launch` 从系统密钥链读取 Relay Token，注入子进程环境，不在配置文件或命令行参数中保存 Token。AI Relay 支持服务端翻页（Left/Right）、刷新（r）、查询用量（Enter）、创建（c）与删除（d）；写操作需 y 确认。u 然后 y 将选中 Token 保存为本地工具凭证；b/Esc 返回控制台。Token 原文永不渲染、写入日志或进入事件缓冲区。配置或系统密钥链不可用时，状态页显示错误并使用安全默认值，以便用户仍能找到诊断信息。

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

## OAuth 回调与账户读取

浏览器登录成功后 TUI 自动回主菜单，更新凭证状态并记录无敏感信息的事件。loopback HTTP 入口校验路径、state、重复参数与请求大小；无关或错误 state 请求不消耗登录会话。只有交换 Token 与系统密钥链保存成功后，才向配置的认证域 `/oauth/result?status=success` 返回 303；失败使用非成功状态。跳转启用 no-store/no-referrer，不携带授权码、state 或凭证。结果页不参与认证和授权判定。

账户概览 GET 路径由 `build.rs` 根据现有 OpenAPI operationId 生成到 `OUT_DIR/account_routes.rs`；不再手写误用仅支持 PATCH 的 `me/profile`。既有 shared/OpenAPI 仍为契约事实源。

## 客户端适配边界

`features/integrations` 按工具维护配置键与文件格式，`files` 管理校验、备份与原子替换，`launch` 管理子进程凭证注入。地址来自运行时配置，模型由用户或已有工具配置决定。Codex 保留 TOML 注释与无关 provider；JSON 按所属字段合并，不用失败回退空配置。支持工具目录覆盖，不自动修改 Cursor/Windsurf/Cline 等未经核实的配置字段。通用 harness 仅承诺已明确支持的 OpenAI/Anthropic 环境变量；不承诺某个名称不明确的项目兼容。
