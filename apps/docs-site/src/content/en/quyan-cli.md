# Quyan CLI

Quyan CLI is a native Rust + Ratatui terminal client with no Node.js runtime requirement. Download Windows, Linux, or macOS artifacts from GitHub Releases; each artifact includes a SHA-256 checksum file.

```bash
quyan --version
quyan login --browser
quyan relay token list
quyan product json-endpoints get
```

`ak_` credentials are for account APIs, `rlt_` for AI Relay, and `dpk_` for the JSON Endpoints product. Credentials are imported through stdin or interactive flows and stored in the operating system keychain.
