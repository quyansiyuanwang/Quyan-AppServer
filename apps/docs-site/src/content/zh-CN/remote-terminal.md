# 远程终端

此页面用于连接并操作已注册的远程设备终端。

## 页面用途

- 查看当前账号绑定的设备列表及在线状态。
- 选择设备和 Shell 类型后发起终端会话。
- 在同一界面管理多个终端标签页。
- 浏览远程设备的目录结构。

## 你会看到什么

### 设备列表

左侧栏显示当前用户绑定、且套餐仍有效的设备；启用 IAM 强制授权后，只列出获准查看的设备。每张卡片显示：

- 主机名、平台与架构（如 `linux/amd64`）。
- 在线 / 离线状态标签。
- 最后上线时间。

### 配额面板

- **终端配额**：当前活跃会话数 / 总终端上限。
- **设备配额**：当前活跃设备数 / 总设备上限。

超出配额时连接按钮会被禁用，并显示原因提示。

### 终端区

右侧主区域为多标签终端，每个标签对应一个设备会话，支持：

- Shell 类型选择（bash / sh / powershell 等，取决于设备端支持）。
- 连接、断开、重连操作。
- xterm.js 完整终端体验（颜色、光标、滚动历史）。
- 断开后粘贴内容将在重连后自动发送（可选）。

## 常见操作

1. 在设备列表中点击目标设备将其选中。
2. 从下拉菜单选择 Shell 类型。
3. 点击连接，等待会话建立。
4. 在终端中正常输入命令。
5. 需要多任务时，新建标签页并选择另一台设备。

## 说明

- 设备需通过注册令牌完成绑定后才会出现在列表中；令牌在「我的远程终端套餐」页管理。
- 会话通过 WebSocket 建立，网络中断后可手动或自动重连。
- 终端数量受套餐权益限制，如需扩充请先购买或联系管理员分配套餐。

## 相关页面

- `my-monthly-passes`

## 按设备授权

启用 IAM 强制授权后，设备列表、探测、目录浏览和偏好操作由以下 Action 分别控制：

| 操作         | Action                                      | 资源       |
| ------------ | ------------------------------------------- | ---------- |
| 查看设备列表 | `quyan:remote_terminal:ListDevices`         | 逐设备过滤 |
| 浏览目录     | `quyan:remote_terminal:BrowseDirectories`   | 选定设备   |
| 读取偏好     | `quyan:remote_terminal:GetAgentPreferences` | 选定设备   |

设备 ARN 格式为 `acs:remote-terminal:*:<accountId>:device/<userId>/<deviceId>`。账号 ID、绑定用户和设备 ID 以服务端确认的归属为准。授权不会让你访问其他用户的设备，也不会延长套餐有效期。

以下策略仅允许查看一个设备及读取其目录和偏好。将示例占位符替换为实际 ID 后，可在 [RAM 管理](/docs/ram-management) 中校验、模拟并绑定；这份策略不授予修改偏好或创建终端会话的权限。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "quyan:remote_terminal:ListDevices",
        "quyan:remote_terminal:BrowseDirectories",
        "quyan:remote_terminal:GetAgentPreferences"
      ],
      "Resource": "acs:remote-terminal:*:account-id:device/user-id/device-id"
    }
  ]
}
```

显式 Deny 覆盖 Allow；未获准的设备不出现在设备列表中。目录或偏好读取被拒绝时返回权限错误，设备不可用和策略详情不会通过该错误公开。读取期间权限被撤销或设备套餐失效，结果也不会返回。

仍使用兼容授权模式的部署保留原有权限行为；差异比较模式只记录 IAM 结果，不会为比较结果重复向设备发送请求。

设备探测只向获准的设备发送请求，并更新对应设备的在线状态。无匹配 Allow 的设备不会被探测，也不会因这次操作更新状态。设备归属、套餐或授权在探测期间变化时，受影响的状态写入会被拒绝。

修改偏好需要独立的写入 Action。服务端会在发送修改请求前复核权限；如果请求已发给设备后权限才被撤销，权限撤销不会撤回设备已经执行的修改。请先核对目标设备和修改内容，再提交保存。

## 会话可见范围与用量权限

`quyan:remote_terminal:ListSessions` 按 `acs:remote-terminal:*:<accountId>:session/<userId>/<sessionId>` 逐会话授权。列表仅包含当前认证用户自己的会话；显式 Deny 优先，缺少 Allow 的会话不显示。返回内容仅为公开摘要，不包含工作目录或浏览器连接 Token。会话资源也可以加入资源组，限定授权的生效范围。

`quyan:remote_terminal:GetUsageSummary` 需要用户资源 `acs:quyan:*:<accountId>:user/<userId>` 的权限。用量包含全部自有的活动会话和有效套餐绑定设备，包括列表策略隐藏的设备与会话。列表可见范围不会减少配额占用；设备列表和会话列表权限不会自动授予用量查询或创建会话权限。

这些独立 Action 在 IAM 强制授权模式下生效；兼容授权部署保留原有权限行为。

创建 pending 会话需要所选设备 ARN 上的 `quyan:remote_terminal:CreateSession` 权限；只有设备列表或用量查询权限不能创建会话。创建时会检查实际配额占用，包括列表中不可见的会话。重连仅替换该设备的旧 pending 会话，保留 connected 会话。创建完成前授权复核失败时，新 pending 会话会被清理，浏览器连接凭据不会返回。
