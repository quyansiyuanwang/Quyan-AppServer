# Quyan CLI

Quyan CLI 是 Rust + Ratatui 原生终端客户端，不需要 Node.js。可从 GitHub Releases 下载 Windows、Linux 或 macOS 制品，每个制品附带 SHA-256 校验文件。

```bash
quyan --version
quyan login --browser
quyan relay token list
quyan product json-endpoints get
```

`ak_` 用于账户 API，`rlt_` 用于 AI Relay，`dpk_` 用于 JSON Endpoints 产品。凭证通过 stdin 或交互流程导入，并存储在操作系统密钥链中。

## 浏览器 OAuth 登录

执行 `quyan login --browser` 时，CLI 会打开系统 OAuth 授权页。系统客户端 `quyan-cli` 使用回调地址 `http://127.0.0.1:40016/callback`，授权页会按权限树显示本次申请的 scope。

授权页中的权限名称、分类和描述会随当前语言显示；创建或维护 OAuth 客户端时，只能选择当前操作者可以授予的权限。创建、修改、删除、密钥、令牌和安全设置等高风险权限会显示警告，但不会因为风险标记而自动阻断授权。已被撤销的权限会显示为不可用，必须拒绝本次请求。

`quyan-cli` 的 scope 以系统客户端配置为准。CLI 只应申请实际需要的最小权限；不要在授权地址中手工加入管理页面未选择的未知 scope。
