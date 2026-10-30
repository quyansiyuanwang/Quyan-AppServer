# Quyan CLI

Quyan CLI lets you inspect your account, manage Relay tokens, configure local AI tools, and access JSON Endpoints from a terminal. It requires no Node.js runtime. Account credentials, Relay tokens, and product keys serve separate purposes and are stored in the operating system keychain.

## Install and check your CLI

1. Select a CLI release, tagged `quyan-v<version>`, from [Quyan project Releases](https://github.com/quyansiyuanwang/Quyan-AppServer/releases). Download the executable for your system and architecture, plus its matching `.sha256` file. Targets are Windows x64, Linux x64/ARM64, and macOS Intel/Apple Silicon. These are executable files, not archives.
2. Verify SHA-256 before renaming. On Windows, run `Get-FileHash -Algorithm SHA256 -LiteralPath '<downloaded-file-path>'` and compare with the first column of the checksum file. On Linux, use `sha256sum -c <checksum-file>`; on macOS, use `shasum -a 256 -c <checksum-file>`. Download again if the values differ; do not run that file.
3. Rename the verified file to `quyan.exe` on Windows or `quyan` on Linux/macOS. Put it in your executable directory and add that directory to `PATH`. On Linux/macOS, also run `chmod +x ./quyan`. For an initial check from the current directory, use `.\quyan.exe --help` on Windows or `./quyan --help` on Linux/macOS.
4. Run these read-only checks to confirm the version, available commands, and service addresses.

```bash
quyan --version
quyan --help
quyan config get
```

The client setup and launch workflows below require a build with the corresponding `apply` and `launch` commands. Downloaded artifacts may predate these features. Check `quyan launch --help` first. If the command is unavailable, use a CLI release that includes it or manage resources in the web console meanwhile. A missing command is not a login failure.

macOS artifacts are not yet code signed or notarized. If the system blocks execution, verify the source, architecture, and checksum before following your organization's software installation rules.

## Choose services and credentials

Inspect addresses with `quyan config get` first. Defaults connect to Quyan's API, authentication site, and AI Relay. For another deployment, set all three before signing in or importing credentials:

```bash
quyan config set apiBaseUrl <api-url>
quyan config set authBaseUrl <auth-url>
quyan config set relayBaseUrl <relay-url>
```

Replace angle-bracket placeholders with actual values. Use HTTPS; HTTP is allowed only for loopback development. URLs cannot include a username, password, query, or fragment. All three addresses should belong to the same trusted deployment.

| Task                                                 | Required credential                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Account profile, balance, and Relay token management | Browser OAuth login or an account `sk-ak-` AccessKey (legacy `ak_` accepted) |
| Launch local AI tools to make Relay requests         | `sk-rlt-` Relay token (legacy `rlt_` accepted)                               |
| Read or update a JSON Endpoints instance             | That instance's `sk-dpk-` product API key (legacy `dpk_` accepted)           |

Import one key with `quyan credential import --stdin`: supply its full value from a trusted standard input source, then end the input. Interactive terminals typically use `Ctrl+D` on Linux/macOS or `Ctrl+Z` followed by Enter on Windows. The command saves only after end of input, not after a single Enter. Do not supply multiple keys at once or put keys in command arguments, public scripts, or tickets. Successful import confirms local storage, not server authorization.

Importing replaces the local credential of that type. When the keychain is readable, other types are preserved; browser sign-in also preserves previously imported keys. Account APIs prefer a saved OAuth access token, so importing an AccessKey does not switch the account identity automatically. To change accounts or deployments, clear local state as described below, then configure addresses and import new credentials.

Ordinary configuration is in `quyan/config.json` under the platform configuration directory. `QUYAN_CONFIG_DIR` changes that directory. **Keychain credentials use one shared record for the current operating system user, without separation by configuration directory or service address.** Changing an address leaves old credentials in place; changing the configuration directory does not isolate accounts.

## Browser OAuth login

```bash
quyan login --browser
quyan account
quyan relay token list
```

`quyan relay token list` returns only the first page, up to 50 tokens. Use the TUI's AI Relay pagination to find more.

`quyan login --browser` opens the system OAuth consent page. The `quyan-cli` system client uses `http://127.0.0.1:40016/callback` and waits up to five minutes for the callback. The browser must reach that loopback address on the machine running the CLI. With remote SSH or containers, another machine's `127.0.0.1` is not the CLI host. Start a new login after a port conflict, cancellation, or timeout.

The consent page shows requested permissions, warns about high-risk permissions, and marks revoked permissions as unavailable. Approve only after checking the client, account, and scope.

Browser login requests fixed scopes: profile and balance read, plus Relay token read, create, update and delete, channel read, and usage read. The command line cannot select a subset. Review the actual permissions before approving. Client configuration and account authorization may limit what can be granted; contact an administrator if you need narrower authorization rather than editing the authorization URL.

After approval, the CLI exchanges the code and saves credentials to the system keychain before redirecting to the identity site's result page. No authorization code or token is sent to that page; it displays the result reported by the CLI. Close the tab and return to the terminal. The TUI returns to its menu on success and retains errors on failure. If the callback is unavailable, ensure the CLI is still waiting and start a new login instead of reusing an old authorization URL.

The authenticated state in `quyan status` only indicates locally stored account credentials; it does not check expiry or revocation. Use `quyan account` to check actual server access. That command reads profile, balance, and usage together, so insufficient permission for any part can also cause failure. Account requests currently do not refresh using a refresh token or fall back to AccessKey after OAuth failure. Sign in again when credentials expire.

## Use the interactive console

Run `quyan` without a subcommand to open the TUI. Select with `Up`/`Down` or `j`/`k`, open with `Enter`, show help with `?`/`h`, and return with `b`/`Esc`. On the home screen, `q` or `Esc` exits. Available workflows include browser login, account overview, AI Relay, AI client setup, JSON Endpoints, and configuration and diagnostics.

On the AI Relay page, `r` refreshes, `Left`/`Right` changes pages, and `Enter` loads the selected token's usage. Creating with `c`, deleting with `d`, and selecting a local token with `u` require checking the target and confirming with `y`. Deletion affects the server token; local selection does not change its channels, quota, or permissions. Explicit command-line create and delete commands submit directly without this confirmation screen. After a timeout, check the web console or list before retrying.

## Configure local AI tools

1. Select an existing token in **AI Relay**, press `u`, check its name, and press `y` to store the local Relay credential. Alternatively, run `quyan relay token use <token-id>`. The token must be enabled and unexpired; your account must be able to read both details and the secret. With IAM enforcement, listing or detail access alone is insufficient: you also need `quyan:relay:RevealToken` for that token. If only metadata is visible, request the necessary scoped authorization or securely import a Relay token from an authorized source.
2. Open **Configure AI clients**, select Claude Code, Codex, or pi with `Tab` or arrow keys, enter a model ID, and press `Enter` to preview. Check the path, URL, and model; press `y` to write with backup or `n` to cancel. pi requires a model; the others can retain their existing model. Use your actual Relay model catalog.
3. Run `quyan launch --client <client>`. The credential is loaded from the keychain and injected into the child environment, never added to ordinary configuration or command arguments.

```bash
# Without a client, list adapters without modifying files
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

URLs come from `relayBaseUrl`, set with `quyan config set relayBaseUrl <https-url>`. OpenAI-compatible tools use `/v1`; Claude Code uses the service root. Install tools yourself; Quyan does not install them or change system environment variables.

| Tool        | Configuration target                                      | Credential handling                                     |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Claude Code | `~/.claude/settings.json`, honoring `CLAUDE_CONFIG_DIR`   | `ANTHROPIC_AUTH_TOKEN` injected at launch               |
| Codex       | `~/.codex/config.toml`, honoring `CODEX_HOME`             | Custom provider `env_key` reference, injected at launch |
| pi          | `~/.pi/agent/models.json`, honoring `PI_CODING_AGENT_DIR` | Provider environment reference, injected at launch      |

Merges preserve unrelated fields, other providers, and existing pi models; Codex TOML comments are preserved. Unreadable or malformed configuration is rejected rather than treated as empty. Unique `.bak` files do not overwrite old backups. Backups can contain existing secrets and should be protected accordingly. To restore, close the tool and replace its configuration with the reported backup.

`--dry-run` previews paths and changes without writing or testing upstream models. `apply --client ...` without it writes immediately without another confirmation. Backups are created only when changing an existing file, not for unchanged or new files. `--no-backup` disables them. Writing configuration does not require a Relay token; launching and making requests do.

`launch` injects credentials only into that child, without changing the parent terminal's environment. Starting a tool directly after `apply` does not retrieve credentials from Quyan's keychain. Claude Code uses Anthropic, Codex uses Responses, and pi uses Chat Completions. Check that the token's channels and conversion rules support the chosen protocol and model. Requests remain subject to server billing rules.

### Other harnesses and tools

For tools that explicitly support these environment variables, use an environment-only adapter:

```bash
quyan launch --client openai -- <program> <arguments>
quyan launch --client anthropic -- <program> <arguments>
```

These provide `OPENAI_API_KEY` / `OPENAI_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`. Check the tool's protocol and configuration precedence. Existing configuration, login state, or supplied arguments can override the environment. `launch` hands over the terminal and cannot be combined with `--json`.

File adapters support only the three tools in the table. For Cursor, Windsurf, Cline, Continue, Aider, or other tools, follow their documentation and supported protocol and configuration format.

## Access JSON Endpoints

Browser login does not provide a product key. Create a key for the target instance in [Developer products]({{DOCS_BASE_URL}}/en/developer-products-overview), import it through stdin, then run:

```bash
quyan product json-endpoints get
quyan product json-endpoints usage
quyan product json-endpoints update --file ./content.json
quyan product json-endpoints clear
```

Reading, updating, clearing, and viewing usage require their respective product key permissions. The key determines the instance. `update` reads a complete valid JSON value and replaces the content, rather than applying a merge patch. `clear` clears content without deleting the product instance. Write commands submit immediately without a local backup or further confirmation; save needed data yourself before changing it.

## Sign out, reset, and troubleshoot

Both `quyan logout` and `quyan config reset` clear stored account, Relay, and product credentials from the local keychain and remove the current configuration file. Subsequent use falls back to default addresses. To change deployments, sign out first, then reset all three addresses, sign in, and import credentials. Neither command revokes server keys or OAuth grants, restores AI tool configuration, deletes its backups, or clears logs. Revoke credentials through their respective web management pages.

| Symptom                                                  | What to check                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `quyan` or the AI tool cannot be found                   | Check architecture, executable permissions, and `PATH`. Quyan does not install AI tools.                                             |
| Keychain unavailable or storage fails                    | Check the OS keychain is unlocked and accessible to the current user session. Browser approval alone does not prove login succeeded. |
| Credentials are shown locally but account requests fail  | Verify addresses, account, expiry, revocation, and permissions; sign in again if needed.                                             |
| Tokens are listed but cannot be selected for tools       | Check enabled status, expiry, detail access, and secret access.                                                                      |
| Configuration writes succeed but requests fail           | Check the launched tool, model, protocol, quota, and IP whitelist. Writing configuration is not a connectivity test.                 |
| A write times out or reports authorization or 2FA errors | Check server state first; complete the operation through the web workflow if needed instead of repeatedly submitting writes.         |

Use `quyan config set locale en-US` or `zh-CN` to set the saved language. Add `--debug` for diagnostics; error output reports the log location. Before sharing, check for personal information, product content, or sensitive values from old configurations.

## Related pages

- [Developer products]({{DOCS_BASE_URL}}/en/developer-products-overview)
- [JSON Endpoints]({{DOCS_BASE_URL}}/en/developer-product-json-endpoint)
- [Relay token management]({{DOCS_BASE_URL}}/en/relay-token-management)
