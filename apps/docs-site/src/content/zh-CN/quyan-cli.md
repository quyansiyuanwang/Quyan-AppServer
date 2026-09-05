# Quyan CLI

Quyan CLI 是 Rust + Ratatui 原生终端客户端，不需要 Node.js。可从 GitHub Releases 下载 Windows、Linux 或 macOS 制品，每个制品附带 SHA-256 校验文件。

```bash
quyan --version
quyan login --browser
quyan relay token list
quyan product json-endpoints get
```

`ak_` 用于账户 API，`rlt_` 用于 AI Relay，`dpk_` 用于 JSON Endpoints 产品。凭证通过 stdin 或交互流程导入，并存储在操作系统密钥链中。
