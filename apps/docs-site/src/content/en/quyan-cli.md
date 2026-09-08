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

When `quyan login --browser` runs, the CLI opens the system OAuth consent page. The `quyan-cli` system client uses `http://127.0.0.1:40016/callback`; the consent page presents the requested scopes as a permission tree.

Scope names, categories, and descriptions follow the selected locale. When an OAuth client is created or edited, only permissions the current operator can grant are selectable. High-risk permissions such as create, update, delete, token, key, or security operations show a warning, but the warning does not automatically block approval. Revoked permissions are shown as unavailable and the request must be denied.

The `quyan-cli` scope set is controlled by its system client configuration. The CLI should request the smallest set of permissions it actually needs; do not add unknown scopes manually to the authorization URL.
