# Quyan CLI 事实

- crate：`apps/cli-native`，命令：`quyan`，版本源：`Cargo.toml`。
- 入口：`src/main.rs`/`src/cli.rs`；领域封装：`src/services/`；TUI：`src/tui.rs`；共享品牌：`src/branding.rs`。
- API 默认地址：`https://api.qysyw.cn`；AI Relay：`https://ai.qysyw.cn`。可用 `QUYAN_API_URL`、`QUYAN_RELAY_URL` 覆盖。
- OpenAPI 生成链：后端 TSOA Swagger -> `build.rs`/Progenitor -> Cargo `OUT_DIR`。源 Swagger 缺失时构建必须失败并提示先运行 `pnpm run openapi:gen`。
- 根脚本：`build:cli:native`、`check:cli:native`、`package:cli:native`、`pack:check:cli:native`、`release:cli:native`。
- 发布目标：`windows-x64`、`linux-x64`、`linux-arm64`、`macos-x64`、`macos-arm64`；制品名为 `quyan-v<version>-<target>`，旁边必须有 `.sha256`。
- 发布 CI 使用 `ubuntu-latest` + `cargo-zigbuild` 交叉编译；不依赖 `macos-13`，不默认使用 UPX、签名或 notarization。
