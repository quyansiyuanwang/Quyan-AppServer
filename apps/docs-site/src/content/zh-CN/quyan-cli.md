# Quyan CLI

Quyan CLI 是 Rust + Ratatui 原生终端客户端，不需要 Node.js。可从 GitHub Releases 下载 Windows、Linux 或 macOS 制品，每个制品附带 SHA-256 校验文件。

```bash
quyan --version
quyan login --browser
quyan relay token list
quyan product json-endpoints get
```

`sk-ak-` 用于账户 API（兼容旧 `ak_`），`sk-rlt-` 用于 AI Relay（兼容旧 `rlt_`），`sk-dpk-` 用于 JSON Endpoints 产品（兼容旧 `dpk_`）。凭证通过 stdin 或交互流程导入，并存储在操作系统密钥链中。

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

## 本地模型路由：多配置档与热切换

需要在不重启 agent 的情况下切换令牌或模型路由时，使用本地 Router，而不是上面的直连 Relay 适配。Router 只转发到已保存的 Quyan Relay 配置档，不保存第三方供应商 API Key；真实渠道组合、计费、额度、模型限制与协议转换仍由 Relay 令牌决定。

```bash
quyan login --browser
quyan router profile add --token-id <令牌ID> --name 主力 --priority 0 --yes
quyan router profile add --token-id <备用令牌ID> --name 备用 --priority 10 --yes
quyan router models
quyan router start --yes

# Codex 使用 Responses，不能将 Chat Completions 的模型列表直接视为兼容。
quyan router route set --protocol openai-responses --model coding \
  --profile <配置档ID> --upstream-model <可用模型ID> --priority 0 --yes
quyan router apply --client codex --model coding --dry-run
quyan router apply --client codex --model coding --yes
quyan launch --router --client codex --model coding
```

默认固定入口是 `http://127.0.0.1:15721`。每个配置档的 Relay 凭证独立保存在系统密钥链；`router.json` 只保存 ID、模型目录、优先级和地址等非敏感信息。首次接管客户端可能需要重新加载一次配置；接入本地入口后，有效的路由或配置档变更作用于**下一次请求**，不重启 agent 或 Router。已经开始的流式请求继续使用原配置档。

### 模型与配置档选择

- `quyan router profile list` 查看已保存配置档。使用 `profile set <ID> --priority <数字>` 或 `--enabled false` 调整顺序或禁用配置档，写操作附加 `--yes`。
- `quyan router models --refresh --yes` 通过账户 API 刷新模型目录。Chat Completions、Responses、Anthropic、Gemini 的能力分别维护，不通过模型名称猜协议。
- `route set` 将模型或别名绑定到配置档；末尾 `*` 支持前缀规则；`--upstream-model` 把稳定的客户端别名映射到实际模型。
- 路由优先级按协议与请求模型划分。同一优先级设置不同配置档会替换该位置：`0` 可用作主力，不同优先级可以保留明确的备用路由；数字越小越优先。
- 精确规则优先于前缀，其后按模型能力与配置档优先级自动选择。不支持的模型明确报错，不发送给任意供应商。固定物理渠道需要使用只绑定该渠道的 Relay 令牌，本地 Router 不自创渠道请求头。

### 客户端接入

```bash
quyan router apply --client claude-code --model <Anthropic协议模型ID> --yes
quyan router apply --client pi --model <可用模型ID> --yes
quyan router apply --client claude-desktop --model <Anthropic协议模型ID> --yes
quyan router status
quyan router stop --yes
```

Claude Code、Codex、pi 的配置保留无关字段，原子替换前创建不覆盖旧备份的新备份。本地 Router 配置只写入公开的 loopback 兼容占位值，不写真实 Relay 凭证。Codex 使用该本地占位值作为 `experimental_bearer_token`，避免从桌面直接启动时因没有继承环境变量而无法请求；其 provider 明确使用 Responses/SSE，不使用 WebSocket。`quyan launch --router` 也会向子进程提供 `QUYAN_PROXY_API_KEY`。支持对应环境变量的其他工具可用 `quyan launch --router --client openai -- <程序>` 或 `anthropic` 适配器。

Claude Desktop 与 Claude Code 分开处理。Quyan 只管理 `Claude-3p/configLibrary` 下自己的第三方配置档，不改官方登录文件或 MCP 设置。可用 `CLAUDE_DESKTOP_CONFIG_DIR` 覆盖 `Claude-3p` 目录。必须明确选择模型，该模型会映射到稳定本地角色 `claude-sonnet-quyan`；以后修改此角色的路由即可切换模型，不改 Desktop 配置档。首次接入或入口变化后需重启 Claude Desktop 一次，仅支持识别该 3P 配置格式的版本，不注入或修改 GUI 进程。Quyan 当前没有经过验证的 ChatGPT Desktop 配置适配器，会明确拒绝修改，不安装根证书，不拦截官方登录流量。

### 控制中心与安全边界

主页第七项进入本地路由工作区。用 `Tab` / `Shift-Tab` 切换配置档、Relay 令牌、模型、路由、客户端和状态页面。配置档页按 `a` 选择已有令牌，空格切换启用状态，`+` / `-` 改优先级，`d` 删除。模型页按 `p` 选协议、`t` 选兼容配置档、Enter 预览绑定、`a` 创建别名、空格选定客户端配置所用模型。所有写操作先预览，`y` 确认，`n` / Esc 取消。`s` 启动 Router，`x` 停止，`f` 刷新模型目录，`r` 刷新面板。状态显示活跃请求、最近模型路由、HTTP 结果、失败转移和按模型/协议区分的健康状态，不记录提示词或响应正文。

非交互写操作必须附加 `--yes`；只读命令支持 `--json`。监听仅限 loopback，拒绝浏览器来源和 DNS rebinding Host。兼容占位值不是秘密，也不能防御本机其他进程；启停与重载另用系统密钥链中的随机控制凭证，并核验进程身份，不按任意 PID 强制杀进程。携带 Relay 凭证的请求不跟随上游重定向。

`408`、`429`、`500`、`502`、`503`、`504` 和连接失败可在响应头发给客户端前切换到其他匹配配置档；开始转发后不重放中断流。重复失败会暂时降低对应路由的选择顺序，健康状态按配置档、协议和模型区分。无效配置或新的密钥链项不可用时保留上一份有效快照。客户端超时/重试与上游不透明的会话 ID 仍由客户端和供应商负责，不保证在不同供应商之间迁移这些 ID。

使用 `quyan config set routerListenPort <端口>` 或 `routerListenAddress <loopback-IP>` 调整监听入口，然后停止/启动 Router 并更新客户端地址。前台诊断可用 `quyan router serve --debug`。Router 不安装系统登录服务：登录系统后需自行启动，并在客户端使用本地入口时保持运行。

### Stack 模型 ID

使用 `quyan router stack enable --yes` 发布稳定的配置档模型 ID。OpenAI/Responses 使用 `qys-<配置档key>/<model>`，Anthropic 使用 `qys-claude-<配置档key>--<model>`，Gemini 使用 `qys-gemini-<配置档key>--<model>`。Stack ID 会精确绑定对应配置档；配置档不可用时直接失败，不静默回落到其他配置档。普通模型 ID 仍使用自动路由和故障转移。

### 服务端组合令牌

Profile 也可引用组合令牌。通过令牌管理页设置有序成员、嵌套及高级配置，服务端负责路径选择和单次结算；本地 Router 不复制成员密钥，也不增加另一套组合协议。成员变更影响后续请求，不需重启 Agent；目录变更后运行 `quyan router models --refresh`。各层计量不代表重复扣款，详见 `relay-token-management`。
