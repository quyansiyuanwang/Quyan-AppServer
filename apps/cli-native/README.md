# Quyan Native CLI

`quyan` is the native Rust CLI for Quyan. It uses Ratatui for the TUI and does
not require Node.js at runtime. GitHub Releases provide Windows, Linux and
macOS binaries with SHA-256 checksum files.

The generated API client is produced by Progenitor from
`apps/backend/src/build/swagger.json` during `cargo build`; generated code is
written to Cargo's `OUT_DIR` and must not be edited.

```bash
pnpm run openapi:gen
pnpm run check:cli:native
pnpm run package:cli:native
```

Supported targets are `windows-x64`, `linux-x64`, `linux-arm64`, `macos-x64`
and `macos-arm64`. Credentials are separated by prefix: `ak_` for account
APIs, `rlt_` for AI Relay, and `dpk_` for JSON Endpoints. Secrets are stored in
the OS keychain.

Running `quyan` without a subcommand opens the Ratatui status screen. It shows
the shared QuYan ASCII banner, runtime endpoints, credential availability,
configuration path and recent startup events; press `q` or `Esc` to exit.
It never displays credential values.

Every invocation writes diagnostics to the platform data directory under
`Quyan/logs`. Add `--debug` to mirror detailed, redacted request lifecycle
information to stderr. Logs record only HTTP method, path, request ID, status
and duration; they never include tokens, Authorization headers, signing data,
request bodies or response bodies. With `--json`, stdout remains JSON only.
