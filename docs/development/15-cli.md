# 15 — Quyan CLI

## 定位

Quyan CLI 的正式实现是 `apps/cli-native` 中的 Rust + Ratatui 原生程序，提供账户状态、AI Relay 管理、凭证管理、配置适配和 JSON Endpoints 产品访问。它不依赖 Node.js 运行时。

无子命令执行 `quyan` 时打开 Ratatui 控制台：显示共享的 QuYan 字符画、版本、服务地址、凭证配置状态与最近事件，并提供账户登录、AI Relay、客户端适配、JSON Endpoints、配置与诊断的可导航操作目录。主页菜单显式编号为 `1` 至 `7`，按对应数字可直接打开；也可以按 `Up`/`Down` 或 `j`/`k` 选择后按 `Enter`。右侧始终显示当前项的功能、凭证边界与快捷键，`?`/`h` 显示完整按键帮助，`q` 或 `Esc` 退出。

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

## 本地模型 Router

`src/router` 提供按协议/模型选 Relay Profile 的常驻 loopback 代理。它不访问第三方供应商密钥、不新增后端路由契约、不修改 OpenAPI。令牌内部的物理渠道、计费和协议转换继续由 Relay 服务端管理；需要固定物理渠道时使用只绑定该渠道的令牌。

- `router.json` 只保存非敏感配置；每个 Profile 使用独立的 `quyan-router-profile` 系统密钥链项。进程控制使用独立随机凭证，不公开在 PID 文件中。
- `router start/stop/status/reload` 管理独立进程；Windows 后台启动不创建可见控制台。目录级进程锁与实例 ID 防止重复启动、误杀或控制无关进程。
- 每个请求加载新的有效配置快照；无效 JSON、地址变更或新凭证不可用时保留旧快照。变更监听地址需要显式 stop/start，模型或路由变更不重启进程。
- 支持 Chat Completions、Responses、Anthropic、Gemini 和 SSE。Responses 能力从已授权渠道目录推导，不能从 `openai` 模型列表或模型名猜测。跨协议调用复用令牌的服务端转换规则，不在 Rust 中复制业务转换实现。
- `quyan-router` 是本地客户端 provider，与旧 `quyan` 直连 provider 隔离。本地配置允许公开的兼容占位值，禁止写真实 Relay 凭证；浏览器来源被拒绝，不声称能防御同用户进程。
- TUI 第七项提供可操作的配置档、令牌、模型、路由、客户端与状态页面。账户读取、写操作在后台执行并显示等待状态；所有写操作先预览确认，敏感正文不会进入面板。
- Claude Desktop 使用自己的第三方 configLibrary 配置档，首次接管可能需要重启；ChatGPT Desktop 无经过验证的配置适配器，不做系统代理/MITM 接管。

Rust 代理测试使用本地 mock upstream 与内存凭证 fixture，不访问真实 Relay、用户 keychain 或 agent 文件。命令级生命周期 smoke test 应使用独立 `QUYAN_CONFIG_DIR` 和空 Profile；服务启动生成的短期控制 keychain 项必须在结束时清理。

### Stack 模型（ccswitch 风格）

本地 Router 支持可选的 Stack 模式：

```bash
quyan router stack enable --yes
quyan router stack status
quyan router stack disable --yes
```

开启后，模型目录会为每个已启用 Relay Profile 发布稳定的配置档模型 ID：OpenAI/Responses 使用 `qys-<profile-key>/<model>`，Anthropic 使用 `qys-claude-<profile-key>--<model>`，Gemini 使用 `qys-gemini-<profile-key>--<model>`。请求这些带 `qys-` 前缀的模型时，Router 只允许对应 Profile 处理；配置档不存在、已禁用或模型目录不再包含该模型时直接失败，不回落到其他 Profile，避免意外使用错误渠道或额度。普通不带前缀的模型仍使用自动路由和故障转移。

## 服务端组合令牌兼容

组合令牌沿用现有 Profile 添加、keyring 与模型刷新流程，本地不保存成员密钥或展开服务端成员图。
`available-models` 新增可选 `responses` 数组：存在该数组时，所有协议目录已经过服务端路径和转换校验，
CLI 直接使用，不再次套用令牌转换规则，也不从 Chat Completions 推断 Responses。旧服务端缺少该字段时
保留原有 routing-catalog 兼容路径。组合成员与排序变化影响后续请求；目录变化可手动刷新缓存。
