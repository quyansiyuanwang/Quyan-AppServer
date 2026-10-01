# Quyan CLI

Quyan CLI is a native Rust + Ratatui terminal client with no Node.js runtime requirement. Download Windows, Linux, or macOS artifacts from GitHub Releases; each artifact includes a SHA-256 checksum file.

```bash
quyan --version
quyan login --browser
quyan relay token list
quyan product json-endpoints get
```

`ak_` credentials are for account APIs, `rlt_` for AI Relay, and `dpk_` for the JSON Endpoints product. Credentials are imported through stdin or interactive flows and stored in the operating system keychain.

## Browser OAuth login

When `quyan login --browser` runs, the CLI opens the system OAuth consent page. The `quyan-cli` system client uses `http://127.0.0.1:40016/callback`; the consent page presents the requested scopes in a wrapping list.

Scope names, categories, and descriptions follow the selected locale. When an OAuth client is created or edited, only permissions the current operator can grant are selectable. High-risk permissions such as create, update, delete, token, key, or security operations show a warning, but the warning does not automatically block approval. Revoked permissions are shown as unavailable and the request must be denied.

The `quyan-cli` scope set is controlled by its system client configuration. The CLI should request the smallest set of permissions it actually needs; do not add unknown scopes manually to the authorization URL.

After approval, the CLI exchanges the code and saves credentials to the system keychain before redirecting to the identity site's result page. No authorization code or token is sent to that page: it only displays the result reported by the CLI. Close the tab and return to the terminal. The TUI automatically returns to its menu after success and retains errors on failure. If the loopback callback is unavailable, ensure the CLI is still waiting and start a new login rather than reusing an old authorization URL.

## Configure local AI tools

1. Select an existing Token in **AI Relay**, press `u`, check its name and press `y` to store it as the local Relay credential. Use `Left`/`Right` for server-side pagination. Alternatively, run `quyan relay token use <token-id>` explicitly.
2. Open **Configure AI clients**, select Claude Code, Codex or pi with `Tab` or the arrow keys, type a model ID and press `Enter` to preview. Check the target path, URL and model; press `y` to write with backup or `n` to cancel. pi requires a model; other tools can keep their existing model. Use a model from your actual Relay catalog, not a guessed default.
3. Run `quyan launch --client <client>`. The credential is loaded from the system keychain and injected only into the child process environment, never into ordinary configuration files or command-line arguments.

```bash
# Without a client, only list adapters; do not modify files
quyan apply
quyan relay token use <token-id>
quyan apply --client claude-code --dry-run
quyan apply --client claude-code
quyan launch --client claude-code

quyan apply --client codex --model <model-id> --dry-run
quyan apply --client codex --model <model-id>
quyan launch --client codex

quyan apply --client pi --model <model-id>
quyan launch --client pi --model <model-id>
```

URLs come from Quyan's `relayBaseUrl`; change it with `quyan config set relayBaseUrl <https-url>`. OpenAI-compatible tools use `/v1`; Claude Code uses the service root. Install each tool yourself. Quyan does not install tools or change your system environment variables.

| Tool        | Configuration target                                      | Credential handling                                     |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Claude Code | `~/.claude/settings.json`, honoring `CLAUDE_CONFIG_DIR`   | `ANTHROPIC_AUTH_TOKEN` injected at launch               |
| Codex       | `~/.codex/config.toml`, honoring `CODEX_HOME`             | Custom provider `env_key` reference, injected at launch |
| pi          | `~/.pi/agent/models.json`, honoring `PI_CODING_AGENT_DIR` | Provider environment reference, injected at launch      |

Merges preserve unrelated fields, other providers and existing pi models; Codex TOML comments are preserved. Unreadable or malformed existing configuration is rejected, never treated as empty. Unique `.bak` files are created by default without overwriting earlier backups. Backups may contain pre-existing secrets and must be protected accordingly. To restore, close the tool and replace its config with the backup reported by Quyan.

### Other harnesses and tools

For tools that explicitly support the corresponding environment variables, use an environment-only adapter without modifying a private configuration format:

```bash
quyan launch --client openai -- <program> <arguments>
quyan launch --client anthropic -- <program> <arguments>
```

These provide `OPENAI_API_KEY` / `OPENAI_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`. They do not promise compatibility with every project called a harness: verify the tool's documented protocol and configuration precedence. Existing tool configuration, login state or supplied arguments may override the environment. `launch` hands over the terminal and cannot be combined with `--json`.

The old unverified Cursor, Windsurf, Cline, Continue and Aider fields are no longer written automatically. Their official formats must be verified before adding dedicated adapters; invalid fields must not be reported as successful configuration.

## Local model router: profiles, routing and hot switching

Use this workflow instead of the direct Relay adapter when an agent must keep a
stable endpoint while you switch tokens or model routes. The Router only forwards
to saved Quyan Relay profiles; it does not store third-party supplier API keys.
Your existing Relay token still owns its channel combination, billing, quota,
model restrictions and protocol translations.

```bash
quyan login --browser
quyan router profile add --token-id <token-id> --name Primary --priority 0 --yes
quyan router profile add --token-id <backup-token-id> --name Backup --priority 10 --yes
quyan router models
quyan router start --yes

# Native Codex uses Responses, not Chat Completions.
quyan router route set --protocol openai-responses --model coding \
  --profile <profile-id> --upstream-model <available-model-id> --priority 0 --yes
quyan router apply --client codex --model coding --dry-run
quyan router apply --client codex --model coding --yes
quyan launch --router --client codex --model coding
```

The endpoint defaults to `http://127.0.0.1:15721`. A profile's Relay credential is
stored separately in the OS keychain; `router.json` contains only IDs, model
catalogs, priorities and endpoint metadata. The first client takeover may require
its configuration to be reloaded once. After it connects to the local endpoint,
valid route/profile changes affect the **next request** without restarting the
agent or Router. In-flight streams finish on their original profile.

### Choosing models and profiles

- `quyan router profile list` lists saved profiles. Use `profile set <id>
--priority <number>` or `--enabled false`, with `--yes`, to change ordering or
  disable a profile.
- `quyan router models --refresh --yes` refreshes saved catalogs through the
  account API. Chat Completions, Responses, Anthropic and Gemini capabilities are
  kept separate; model names do not imply protocol compatibility.
- `route set` binds a model/alias to a profile. A trailing `*` supports prefix
  matching. `--upstream-model` maps a stable client-facing alias to a real model.
- Route priority is scoped to its protocol/model. Setting a different profile at
  the same priority replaces that slot: priority `0` is the primary, and a
  different priority can retain an explicit backup. Smaller numbers are preferred.
- Exact rules win over prefixes, then compatible catalog entries use profile
  priority. Unavailable models are rejected rather than sent to an arbitrary
  supplier. A physical-channel pin requires a Relay token bound to that channel;
  the local Router never invents a channel-selection header.

### Client setup

```bash
quyan router apply --client claude-code --model <anthropic-model-id> --yes
quyan router apply --client pi --model <available-model-id> --yes
quyan router apply --client claude-desktop --model <anthropic-model-id> --yes
quyan router status
quyan router stop --yes
```

Claude Code, Codex and pi files retain unrelated settings and receive unique
backups before replacement. Router-mode files contain only the public loopback
compatibility placeholder, never a real Relay credential. In particular, Codex
uses the local placeholder as `experimental_bearer_token` so it can be started
outside a shell without inheriting an environment variable. Its provider explicitly
uses Responses/SSE, not WebSockets. `quyan launch --router` also supplies
`QUYAN_PROXY_API_KEY` to launched children. For environment-compatible harnesses,
use `quyan launch --router --client openai -- <program>` or the `anthropic` adapter.

Claude Desktop is separate from Claude Code. Quyan manages its own profile under
`Claude-3p/configLibrary`, not official login files or MCP settings. Use
`CLAUDE_DESKTOP_CONFIG_DIR` to override the `Claude-3p` directory. An explicit
model is mapped to the stable local role `claude-sonnet-quyan`; later you can
change that role's Router route without rewriting the desktop profile. Restart
Claude Desktop once after initial takeover or an endpoint change. Only builds
that recognize the 3P profile are supported; no GUI process is injected or patched.
ChatGPT Desktop currently has no verified configuration adapter in Quyan: the CLI
refuses to modify it and does not install certificates or intercept official login
traffic.

### Control center and safety

The seventh home action opens the routing workspace. `Tab` / `Shift-Tab` move
between Profiles, Relay Tokens, Models, Routes, Clients and Status. In Profiles,
`a` adds an existing token, Space toggles enablement, `+` / `-` changes priority
and `d` removes it. On Models, `p` selects the protocol, `t` selects a compatible
profile, Enter previews a binding, `a` creates an alias and Space selects a model
for client setup. Every write first shows a preview: `y` confirms, `n` / Esc
cancels. `s` starts the Router, `x` stops it, `f` refreshes catalogs and `r`
refreshes the panel. Status updates include active requests, recent model routes,
HTTP outcomes, failovers and per-model/protocol health; no prompts or response
content are recorded.

Non-interactive writes require `--yes`. Read-only commands support `--json`.
Only loopback listeners are accepted; browsers and DNS-rebinding Host values are
rejected. The compatibility key is not a secret and is not protection from other
processes on the same computer. Start/stop/reload control uses a separate random
keychain credential and validates process identity instead of killing an arbitrary
PID. The Router never follows upstream redirects with Relay credentials.

Retryable `408`, `429`, `500`, `502`, `503`, `504` and connection failures can move
to another matching profile before response headers are sent. After forwarding
starts, an interrupted stream is not replayed. Repeated failures temporarily
reduce a route's preference; health is scoped to profile, protocol and model.
Invalid configuration or a missing new keychain entry leaves the last valid
snapshot running. Client timeout/retry behavior and opaque upstream conversation
IDs remain the client's/provider's responsibility; they are not portable across
unrelated suppliers.

Use `quyan config set routerListenPort <port>` or `routerListenAddress <loopback-ip>`
to change the listener, then stop/start the Router and update client endpoints.
For foreground diagnostics use `quyan router serve --debug`. Router startup does
not install an OS login service: start it after logging in, and keep it running
while clients use the local endpoint.

### Stack model IDs

Enable `quyan router stack enable --yes` to publish stable profile-scoped model IDs. OpenAI/Responses models use `qys-<profile-key>/<model>`, Anthropic uses `qys-claude-<profile-key>--<model>`, and Gemini uses `qys-gemini-<profile-key>--<model>`. A Stack ID is pinned to its Profile and never silently falls back to another Profile. Plain model IDs continue to use automatic routing and failover.
