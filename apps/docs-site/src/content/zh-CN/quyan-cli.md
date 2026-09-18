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

执行 `quyan login --browser` 时，CLI 会打开系统 OAuth 授权页。系统客户端 `quyan-cli` 使用回调地址 `http://127.0.0.1:40016/callback`，授权页会以可换行列表显示本次申请的 scope。

授权页中的权限名称、分类和描述会随当前语言显示；创建或维护 OAuth 客户端时，只能选择当前操作者可以授予的权限。创建、修改、删除、密钥、令牌和安全设置等高风险权限会显示警告，但不会因为风险标记而自动阻断授权。已被撤销的权限会显示为不可用，必须拒绝本次请求。

`quyan-cli` 的 scope 以系统客户端配置为准。CLI 只应申请实际需要的最小权限；不要在授权地址中手工加入管理页面未选择的未知 scope。

完成批准后，CLI 会先交换令牌并保存到系统密钥链，再跳转到认证站点的授权结果页。结果页不接收授权码或令牌，仅展示 CLI 返回的结果；可关闭标签页并返回终端。TUI 登录成功后自动返回菜单；失败会保留错误供排查。若浏览器无法访问本地回调，请确认 CLI 仍在等待，并从 CLI 重新发起登录，不要重复使用旧授权链接。

## 为本地 AI 工具配置中转

1. 在 TUI 的「AI 中转」中选择已有 Token，按 `u`，核对名称后按 `y`，将其保存为本地工具使用的 Relay 凭证。`Left`/`Right` 翻页；不会只显示最前面的 Token。也可显式执行 `quyan relay token use <token-id>`。
2. 打开「配置 AI 客户端」，用 `Tab` 或方向键选择 Claude Code、Codex 或 pi，输入模型 ID，然后按 `Enter` 预览。确认目标路径、服务地址和模型后按 `y` 写入并备份；`n` 取消。pi 必须指定模型，其他工具可保留已有模型。模型以中转实际可用列表为准，不预设模型名称。
3. 使用 `quyan launch --client <client>` 启动工具。凭证从系统密钥链读取，仅注入启动的子进程环境，不写入普通配置或命令行参数。

```bash
# 无 client 参数时只列出支持的适配器，不修改文件
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

地址读取 Quyan 的 `relayBaseUrl` 配置；可用 `quyan config set relayBaseUrl <https-url>` 修改。OpenAI 兼容工具使用 `/v1`，Claude Code 使用服务根地址。工具必须自行安装；Quyan 不安装工具，也不覆盖用户的系统环境变量。

| 工具        | 配置目标                                              | 凭证方式                                      |
| ----------- | ----------------------------------------------------- | --------------------------------------------- |
| Claude Code | `~/.claude/settings.json`，支持 `CLAUDE_CONFIG_DIR`   | 启动时注入 `ANTHROPIC_AUTH_TOKEN`             |
| Codex       | `~/.codex/config.toml`，支持 `CODEX_HOME`             | 自定义 provider 的 `env_key` 引用，启动时注入 |
| pi          | `~/.pi/agent/models.json`，支持 `PI_CODING_AGENT_DIR` | provider 的环境变量引用，启动时注入           |

配置按工具合并：保留无关字段、其他 provider 和 pi 已有模型；Codex TOML 保留注释。无法解析或读取既有配置时会拒绝写入，不能把损坏文件当作空配置。默认生成不覆盖旧备份的 `.bak` 文件；备份可能包含文件原有的敏感内容，应按凭证文件保护。若要恢复，关闭相关工具后，用报告中的备份替换对应配置文件。

### 其他 harness / 工具

对明确支持对应环境变量的工具，可以使用不修改其私有配置文件的通用适配器：

```bash
quyan launch --client openai -- <program> <arguments>
quyan launch --client anthropic -- <program> <arguments>
```

前者提供 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，后者提供 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`。这不代表任意名为 harness 的项目都兼容：请核对目标工具的文档与协议。工具原有配置、登录方式或传入参数可能覆盖环境配置。`launch` 会把终端交给工具，不能与 `--json` 同用。

旧配置器对 Cursor、Windsurf、Cline、Continue、Aider 的未经核实字段不再自动写入。需要这些工具时先核实官方配置格式；不得用错误字段报告“配置成功”。
