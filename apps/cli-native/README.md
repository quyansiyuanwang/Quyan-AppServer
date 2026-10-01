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
`Enter` to open the selection, or `1` through `7` to open a home action
directly. `?` or `h` shows this key guide.

All home actions are active. Browser login runs the OAuth flow, account loads
profile/balance/usage, JSON Endpoints reads the product instance, and
configuration shows safe runtime state. AI client configuration supports Claude
Code, Codex and pi: choose a client and model, preview with Enter, then confirm
with y to apply with backup. Secrets remain in the OS keychain. Use
`quyan launch --client <client>` to inject the selected Relay Token into the
child process environment. `quyan apply` without a client only lists adapters.

In AI Relay, r refreshes, Left/Right changes pages, Enter loads usage, c creates
and d deletes a token after confirmation. Press u then y to select a token for
local tools; the secret is never rendered. The equivalent explicit command is
`quyan relay token use <token-id>`. Use b/Esc to return, q to exit.

Browser login opens the identity site at `/oauth/authorize` (normally
`https://auth.qysyw.cn`) and exchanges the returned code through the API at
`/v1/oauth/token`. The API authorization endpoint is protected and is not a
browser page. The CLI uses the pre-registered loopback callback
`http://127.0.0.1:40016/callback`. While waiting for the callback the control
center shows a waiting state with the callback address and a cancel hint;
`Esc` or `q` aborts the login and returns to the menu. Success automatically
returns to the menu and updates credential status. The loopback response redirects
to the configured identity site's `/oauth/result` only after code exchange and
keychain storage finish. The redirect never includes code, state or tokens.

Client URLs derive from `relayBaseUrl`; models are explicit or preserved, never
guessed. Malformed configuration is rejected without overwriting. Codex uses
`config.toml` with a custom provider and `env_key`; pi uses `models.json`.
Environment-only `openai` and `anthropic` launch adapters support explicitly
compatible external harnesses: `quyan launch --client openai -- <program>`.
Unverified legacy editor configuration fields are no longer written.

See `apps/docs-site/src/content/en/quyan-cli.md` for the complete workflow and
configuration/backup boundaries.

Every invocation writes diagnostics to the platform data directory under
`Quyan/logs`. Add `--debug` to mirror detailed, redacted request lifecycle
information to stderr. Logs record only HTTP method, path, request ID, status
and duration; they never include tokens, Authorization headers, signing data,
request bodies or response bodies. With `--json`, stdout remains JSON only.

## Local router

The seventh home action is the local routing workspace: combine saved Relay
profiles, inspect protocol-specific model catalogs, bind aliases to profiles,
preview client configuration and hot-switch future requests. Writes require an
explicit confirmation; command-line automation uses `--yes`.

```bash
quyan router profile add --token-id <token-id> --yes
quyan router models
quyan router start --yes
quyan router apply --client codex --model <responses-model-id> --dry-run
quyan router apply --client codex --model <responses-model-id> --yes
quyan launch --router --client codex
quyan router status
quyan router stop --yes
```

The loopback-only Router defaults to `http://127.0.0.1:15721`. Relay secrets use
separate system-keychain entries; ordinary config files contain only metadata
and the public local compatibility placeholder. The `quyan-router` Codex/pi
provider is separate from the existing direct Relay provider. SSE is forwarded
without buffering the entire response, and profile failover never replays a
response after forwarding starts. Invalid edits retain the last valid snapshot.

Claude Desktop has its own 3P configLibrary adapter and an explicit model-to-role
mapping; initial takeover may require one restart. ChatGPT Desktop has no
verified configuration adapter and is not intercepted or patched. The Router is
not installed as an OS login service. See the bilingual `quyan-cli` docs-site
page for routing priorities, TUI keys, credential boundaries and compatibility.
