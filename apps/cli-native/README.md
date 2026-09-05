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

Running `quyan` without a subcommand opens the Ratatui control center. It
shows the shared QuYan ASCII banner, a keyboard-navigable list of account,
Relay, client configuration, JSON Endpoints and diagnostic workflows, and the
exact command for the selected action. Use `Up`/`Down` or `j`/`k` to select,
`Enter` to open the selection, or `1` through `6` to open a home action
directly. `?` or `h` shows this key guide.

All home actions are active. Browser login runs the OAuth flow, account loads
profile/balance/usage, JSON Endpoints reads the product instance, and
configuration shows safe runtime state. AI client configuration is intentionally
a `dry-run`; use the explicit `quyan apply` command to write local client
files. The `AI Relay` item loads Relay Tokens; press `r` to refresh, `Enter`
to load selected-token usage, `c` to create the default Quyan CLI token, and
`d` then `y` to confirm deletion. `b` or `Esc` returns to the control center;
`q` exits. The TUI never displays token values.

Browser login opens the identity site at `/oauth/authorize` (normally
`https://auth.qysyw.cn`) and exchanges the returned code through the API at
`/v1/oauth/token`. The API authorization endpoint is protected and is not a
browser page. The CLI uses the pre-registered loopback callback
`http://127.0.0.1:40016/callback`.

Every invocation writes diagnostics to the platform data directory under
`Quyan/logs`. Add `--debug` to mirror detailed, redacted request lifecycle
information to stderr. Logs record only HTTP method, path, request ID, status
and duration; they never include tokens, Authorization headers, signing data,
request bodies or response bodies. With `--json`, stdout remains JSON only.
