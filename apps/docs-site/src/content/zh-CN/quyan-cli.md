# Quyan CLI

Quyan CLI 用于在终端查看账户、管理 Relay Token、配置本地 AI 工具和访问 JSON 端点产品。不需要 Node.js；账户凭据、Relay Token 和产品 Key 分别使用，保存在操作系统密钥链中。

## 安装与首次检查

1. 从 [Quyan 项目 Releases](https://github.com/quyansiyuanwang/Quyan-AppServer/releases) 选择 CLI 发布（标签形如 `quyan-v<version>`）。下载与你的系统、架构匹配的可执行文件及同名 `.sha256` 文件。支持 Windows x64、Linux x64/ARM64、macOS Intel/Apple Silicon；这些制品是可执行文件，无需解压。
2. 保留原文件名完成 SHA-256 校验。Windows 可用 `Get-FileHash -Algorithm SHA256 -LiteralPath '<下载文件路径>'`，与校验文件第一列比较；Linux 使用 `sha256sum -c <校验文件>`，macOS 使用 `shasum -a 256 -c <校验文件>`。不一致时重新下载，勿运行该文件。
3. 校验后将文件重命名为 `quyan.exe`（Windows）或 `quyan`（Linux/macOS），放入自己的可执行文件目录并加入 `PATH`。Linux/macOS 还需执行 `chmod +x ./quyan`。Windows 在当前目录可先用 `.\quyan.exe --help`，Linux/macOS 用 `./quyan --help`。
4. 运行以下只读检查，确认版本、实际支持的命令和当前服务地址。

```bash
quyan --version
quyan --help
quyan config get
```

本文的客户端配置与启动流程适用于提供对应 `apply`、`launch` 命令的构建。下载的制品可能早于这些功能；先检查 `quyan launch --help`。若提示命令不存在，需更换为包含该功能的 CLI 发布，或先使用网页控制台完成管理，不要将参数报错当成登录失败。

macOS 制品尚未提供代码签名与公证；遇到系统拦截时先核对下载来源、架构与校验值，再按组织的软件安装规则处理。

## 选择服务与凭据

首次使用时用 `quyan config get` 检查地址。默认连接 Quyan 的 API、认证站和 AI 中转。使用其他部署时，应在登录或导入凭据前分别设置三个地址：

```bash
quyan config set apiBaseUrl <api-url>
quyan config set authBaseUrl <auth-url>
quyan config set relayBaseUrl <relay-url>
```

将示例中的尖括号内容替换为真实值。地址应使用 HTTPS；仅回环开发地址允许 HTTP。地址不能包含用户名、密码、查询参数或片段。三个地址应属于同一个可信部署。

| 任务                             | 所需凭据                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| 账户资料、余额、Relay Token 管理 | 浏览器 OAuth 登录或账户 `sk-ak-` AccessKey（兼容旧 `ak_`） |
| 启动本地 AI 工具发起中转请求     | `sk-rlt-` Relay Token（兼容旧 `rlt_`）                     |
| 读取、更新 JSON 端点实例         | 对应实例的 `sk-dpk-` 产品 API Key（兼容旧 `dpk_`）         |

通过 `quyan credential import --stdin` 导入一个 Key：从可信标准输入来源提供完整值并结束输入；交互终端通常以 Linux/macOS 的 `Ctrl+D` 或 Windows 的 `Ctrl+Z` 后回车结束。该命令读到输入结束才保存，不是按一次回车就完成；一次不要输入多个 Key，也不要把 Key 放在命令参数、公开脚本或工单中。导入成功只表示已本地保存，尚未验证服务端权限。

导入某类 Key 会替换该类本地凭据。正常读取密钥链时其他类别保留；浏览器重新登录也保留已导入的三类 Key。账户 API 优先使用已保存的 OAuth access token，因此导入 AccessKey 不会自动切换账户身份。需要改用另一账户或部署时，先按下文清理本地状态，再配置地址和导入新凭据。

普通配置位于平台配置目录的 `quyan/config.json`，可用 `QUYAN_CONFIG_DIR` 更改目录。**密钥链中的凭据为当前操作系统用户共享的一份记录，不按配置目录或服务地址隔离。** 修改地址不会清除旧凭据；更换配置目录也不能实现账户隔离。

## 浏览器 OAuth 登录

```bash
quyan login --browser
quyan account
quyan relay token list
```

`quyan relay token list` 只返回第一页，最多 50 条；需要查找更多令牌时，请使用 TUI 的 AI 中转页面翻页。

执行 `quyan login --browser` 时，CLI 会打开系统 OAuth 授权页。系统客户端 `quyan-cli` 使用回调地址 `http://127.0.0.1:40016/callback`，等待回调最多 5 分钟。浏览器必须能访问运行 CLI 的机器上的该回环地址；在远程 SSH、容器中运行时，不要把另一台机器的 `127.0.0.1` 当成本机。端口被占用、流程取消或超时后，应重新发起登录。

授权页会显示本次请求的权限；高风险权限会有警告，已撤销的权限不可用。只在确认客户端、账户和权限范围后批准。

当前 CLI 浏览器登录会请求固定的 scope：用户资料、余额读取，以及 Relay Token 读取、创建、修改、删除、渠道读取和用量读取；不能通过命令行选择其中的子集。授权页会展示实际请求的权限，请在批准前确认这些权限符合需要。客户端配置和账户授权仍可能限制可授予的权限；如需更窄的授权，请联系管理员，不要手工修改授权地址。

完成批准后，CLI 会先交换令牌并保存到系统密钥链，再跳转到认证站点的授权结果页。结果页不接收授权码或令牌，仅展示 CLI 返回的结果；可关闭标签页并返回终端。TUI 登录成功后自动返回菜单；失败会保留错误供排查。若浏览器无法访问本地回调，请确认 CLI 仍在等待，并从 CLI 重新发起登录，不要重复使用旧授权链接。

`quyan status` 的已认证状态只表示本地存在账户凭据，不检查其是否过期或已被撤销。使用 `quyan account` 核对实际服务器访问；该命令同时读取资料、余额和用量，任一权限不足也会失败。当前账户请求不会自动使用 refresh token 刷新或在 OAuth 失败后改用 AccessKey；凭据过期时重新登录。

## 使用交互控制台

不带子命令执行 `quyan` 打开客户控制台。主页按 `1`–`7` 直接进入登录、账户、AI 中转、AI 客户端、JSON Endpoints、诊断和本地路由。方向键或 `j`/`k` 选择，`Enter` 打开，`Esc` 返回，`q` 退出。字符画和完整快捷键收在 `?` 帮助中；服务地址、配置路径和日志位于诊断页。

宽终端并排显示列表与详情；窄终端按 `Enter` 打开详情、`Esc` 回到列表。长内容支持方向键、`PageUp`/`PageDown`、`Home`/`End` 滚动。账户页独立加载资料、余额和用量，单项失败不影响其余结果。

AI 中转页中，`/` 按名称或 ID 搜索全部令牌。搜索通过现有分页接口逐页读取，会显示进度；中途失败保留已读结果并标记“不完整”。未进入搜索时，`Left`/`Right` 翻页；`r` 刷新，`Enter` 查看用量，`c` 输入名称创建，`e` 重命名，`d` 删除，`u` 选作本地凭据。写操作均先显示目标，按 `y` 确认，`n` 或 `Esc` 取消。删除不可撤回；选用令牌不改变其服务端渠道、额度或权限。

输入名称或搜索词时，`q`、`j`、`k` 等字符正常作为文字输入。已确认的写操作在后台执行，不能重复提交；退出会等待操作完成。明确的命令行创建、删除等命令仍直接提交，超时后先核对结果再重试。

默认命令输出使用简洁字段或表格，`--json` 保留机器可读 JSON；单独运行 `quyan --json` 返回本地状态。`--lang zh-CN` / `--lang en-US` 临时覆盖已保存语言，`--no-color` 或 `NO_COLOR` 关闭颜色。重定向输出时使用子命令或 `--json`，不会打开 TUI。

## 为本地 AI 工具配置中转

1. 在 TUI 的「AI 中转」中选择已有 Token，按 `u`，核对名称后按 `y`，将其保存为本地工具使用的 Relay 凭证。也可执行 `quyan relay token use <token-id>`。令牌须启用、未过期，账户须能读取详情及明文；启用 IAM 强制授权时，仅有列表或详情读取权限并不足够，还需该令牌的 `quyan:relay:RevealToken`。如只能查看元数据，向管理员申请所需范围授权，或从有权限的来源安全导入 Relay Token。
2. 打开「AI 客户端」，用 `Tab` / `Shift+Tab` 切换字段，左右键选择 Claude Code、Codex 或 pi，以及直连或 Router。按 `m` 选择并搜索协议兼容的模型，或按 `i` 手动输入。按 `a` 预览目标路径、地址和模型，`y` 写入并备份，`n` / `Esc` 取消。若配置文件或 Router 配置在预览后变化，需要重新预览。
3. 按 `l` 启动客户端，或执行 `quyan launch --client <client>`。工具退出后回到原 TUI。直连凭据仅注入子进程环境；Router 使用本地兼容占位值。直接导入的 Relay Token 不带令牌 ID，模型目录不可用时可手动输入，或在 AI 中转页重新选用令牌。

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

`--dry-run` 只预览路径与配置变更，不写文件，也不检查上游模型是否可用。不带该选项的 `apply --client ...` 会立即写入，不再询问确认；只有修改已有文件时才生成备份，内容未变化或新建文件时不会生成。`--no-backup` 会关闭备份，请确认后再用。写入配置本身不需要 Relay Token；实际启动和调用仍需要它。

`launch` 仅向本次子进程注入凭据，不改变父终端的环境。使用 `apply` 后直接运行工具，不会自动从 Quyan 密钥链取出凭据。Claude Code 使用 Anthropic 协议，Codex 使用 Responses，pi 使用 Chat Completions；应确认令牌的渠道及转换规则支持所选协议和模型。请求仍按服务端规则计费。

### 其他 harness / 工具

对明确支持对应环境变量的工具，可以使用不修改其私有配置文件的通用适配器：

```bash
quyan launch --client openai -- <program> <arguments>
quyan launch --client anthropic -- <program> <arguments>
```

前者提供 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，后者提供 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`。这不代表任意名为 harness 的项目都兼容：请核对目标工具的文档与协议。工具原有配置、登录方式或传入参数可能覆盖环境配置。`launch` 会把终端交给工具，不能与 `--json` 同用。

内置文件适配器仅支持上表三种工具。使用 Cursor、Windsurf、Cline、Continue、Aider 等其他工具时，先查其文档，按实际支持的协议与配置方式接入。

## 本地模型路由

主页第 `7` 项管理本机 Router，不修改平台渠道。配置档保存你有权读取并选用的 Relay Token，支持各协议的模型目录、模型绑定、别名、优先级和 Stack 模型。实际渠道选择和计费继续由服务端处理。

```bash
quyan router profile add --token-id <token-id> --yes
quyan router models
quyan router start --yes
quyan router apply --client codex --model <responses-model-id> --dry-run
quyan router apply --client codex --model <responses-model-id> --yes
quyan launch --router --client codex --model <responses-model-id>
quyan router status
quyan router stop --yes
```

默认入口是 `http://127.0.0.1:15721`，仅监听本机回环地址。Router 是独立进程，退出 TUI 不会停止它，也不会自动开机启动。停止会中断使用它的工具；更改监听地址需要停止后重新启动。配置或凭据无效时保留上一个有效运行快照。

TUI 用 `Tab` / `Shift+Tab` 切换配置档、令牌、模型、路由、客户端和状态页，`/` 筛选当前列表，`s` 启动，`x` 停止，`f` 刷新模型目录。配置档页 `a` 添加、空格启停、`+`/`-` 调整优先级、`d` 移除；令牌页 `Enter` 添加配置档，左右键翻页。模型页 `p` 切协议、`t` 切目标、`Enter` 绑定、`a` 创建别名、空格选作客户端模型。客户端页 `Enter` 转到统一的配置表单。所有写操作需确认。

pi 的 Router 配置按所选模型确定协议，并同步该协议的可用模型。跨协议切换模型时先重新预览并保存配置，再启动；其他 provider 不受影响。

`quyan router stack enable --yes` 开启按配置档限定的模型 ID，`disable --yes` 关闭，`status` 查看状态；TUI 对应快捷键为 `v`。带配置档前缀的模型固定使用对应配置档，不回落到其他配置档；普通模型继续使用兼容配置档的自动路由。

本轮支持 Claude Code、Codex、pi；没有桌面客户端接管入口。每个配置档的真实令牌独立存于系统密钥链，`router.json` 和工具配置不保存真实令牌。移除配置档会移除其本地凭据和关联路由，不删除服务端 Token。`logout` / `config reset` 不清除 Router 配置档；切换部署前应单独停止并移除不再使用的配置档。

## 访问 JSON 端点产品

浏览器登录不会提供产品 Key。先在 [开发者产品]({{DOCS_BASE_URL}}/zh-CN/developer-products-overview)中为目标实例创建产品 API Key，通过标准输入导入，再执行：

```bash
quyan product json-endpoints get
quyan product json-endpoints usage
quyan product json-endpoints update --file ./content.json
quyan product json-endpoints clear
```

读取、更新、清空和用量分别受产品 Key 的权限控制，目标实例由 Key 决定。`update` 读取一个完整合法 JSON 值并替换实例内容，不是合并补丁；`clear` 清空内容，不删除产品实例。这些写命令立即提交，无本地备份或额外确认；修改前先自行保存需要保留的数据。

## 退出、重置与故障处理

`quyan logout` 与 `quyan config reset` 都会清除本地密钥链中保存的账户、Relay 和产品凭据，并移除当前配置文件；后续使用默认地址。切换部署时，应先退出，再重新设置三个地址、登录和导入凭据。它们不会在服务端撤销已签发的 Key 或 OAuth 授权，也不会恢复 AI 工具配置、删除其备份或清除日志；需要撤销时到对应网页管理。

| 现象                             | 处理方法                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| 找不到 `quyan` 或 AI 工具        | 检查文件架构、可执行权限和 `PATH`；Quyan 不负责安装 AI 工具。                    |
| 密钥链不可用或保存失败           | 检查操作系统密钥链是否已解锁及当前用户会话；不要只依据浏览器批准就判定登录成功。 |
| 本地显示有凭据但账户请求失败     | 核对地址和账户，检查过期、撤销及所需权限，必要时重新登录。                       |
| 能列出 Token，但无法选择用于工具 | 检查启用状态、有效期、详情与明文权限。                                           |
| 配置写入成功但调用失败           | 核对所启动工具、模型、协议、额度和 IP 白名单；写入成功不是连通性测试。           |
| 写请求超时或返回权限、2FA 错误   | 先核对服务端状态；按网页流程完成所需操作，不要反复提交相同写请求。               |

`quyan config set locale en-US` 或 `zh-CN` 设置保存的语言。需要诊断时可加 `--debug`，默认错误只显示简短原因，`--debug` 错误输出会提示日志位置；分享前检查输出中是否含个人信息、产品内容或旧配置中的敏感值。

## 相关页面

- [开发者产品]({{DOCS_BASE_URL}}/zh-CN/developer-products-overview)
- [JSON 端点]({{DOCS_BASE_URL}}/zh-CN/developer-product-json-endpoint)
- [Relay Token 管理]({{DOCS_BASE_URL}}/zh-CN/relay-token-management)
