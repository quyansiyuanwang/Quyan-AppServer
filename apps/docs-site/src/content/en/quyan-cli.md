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
