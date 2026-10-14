# 远程终端管理

此页面供管理员维护远程终端产品套餐、用户权益分配及设备绑定。

启用 IAM 强制授权后，套餐管理列表使用 `quyan:remote_terminal:ListTemplates`，逐条检查 `acs:platform:*:platform:remote-terminal-template/<templateId>`。分页记录和总数只包含获准查看的模板；未匹配 Allow 或匹配 Deny 的模板不会返回。模板属于部署共享资源，除了 IAM 策略，还必须保留部署管理员配置的全局管理组权限上限，账号自己的策略或用户组不能自行取得这项管理资格。这一读取权限不会授予创建、修改或发布模板的权限。

权益筛选和分配对话框中的套餐选择器支持服务端搜索与分页。启用 IAM 强制模式后，`quyan:remote_terminal:ListTemplateOptions` 按套餐 ARN 分别控制可选范围，仅返回获准套餐的名称、发布状态和启用状态，不授予价格或完整套餐详情的读取权限。选项总数只计算获准套餐；未获得授权或命中显式 Deny 的套餐不会出现在选择器中。切换搜索、翻页或刷新失败时会清空旧选项。

启用 IAM 强制模式后，套餐写操作分别使用 `quyan:remote_terminal` 服务下的 `CreateTemplate`、`UpdateTemplate`、`PublishTemplate`、`UnpublishTemplate` 和 `DeleteTemplate`。通过更新接口将套餐改为删除状态也需要 `DeleteTemplate`。创建操作需要同时获得对 `acs:platform:*:platform:remote-terminal-template-control` 和新生成套餐 ARN 的 `CreateTemplate` 授权；未来套餐可使用 `acs:platform:*:platform:remote-terminal-template/*` 匹配。这些授权仍受部署管理员配置的全局管理用户组范围限制。操作完成前若权限或套餐数据发生变化，写入会被拒绝并回滚。

管理端权益列表仅展示注册令牌的元数据与脱敏值，不返回完整令牌。个人权益页面保留安装所需的令牌；管理员通过单独受保护的轮换操作管理注册令牌。

## 页面用途

- 创建、发布和管理产品套餐模板。
- 向用户分配或修改权益（entitlement）。
- 查看和撤销已绑定的设备。
- 查看所有用户的权益及设备列表。

## 你会看到什么

### 套餐模板（Templates）标签

- 套餐名称、描述。
- 支持的计费单元：**设备单元**（按绑定设备数计费）和 **终端单元**（按并发终端数计费）。
- 每个单元的单价、货币和最低购买单位。
- 状态（草稿 / 已发布）及发布 / 下架操作。
- 创建、编辑、删除按钮。

### 用户权益（Entitlements）标签

- 按用户 / 套餐 / 状态筛选。
- 分配给用户的设备上限与终端上限。
- 权益到期时间、购买记录。
- 分配新权益 / 编辑 / 删除 / 查看注册令牌。

### 设备管理（Devices）标签

- 已绑定设备列表（所有用户）。
- 设备信息：主机名、平台、架构、上线状态、最后上线时间。
- 按用户 / 权益 / 状态筛选。
- 撤销（强制解绑）设备。

## 权限要求

| 操作                   | 所需权限                                   |
| ---------------------- | ------------------------------------------ |
| 查看套餐模板           | `REMOTE_TERMINAL_PRODUCT_READ`             |
| 创建 / 编辑 / 删除模板 | `REMOTE_TERMINAL_PRODUCT_WRITE`            |
| 查看用户权益           | `REMOTE_TERMINAL_ASSIGNMENT_READ`          |
| 分配 / 更新 / 删除权益 | `REMOTE_TERMINAL_ASSIGNMENT_WRITE`         |
| 查看注册令牌           | `REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE` |
| 查看设备列表（管理端） | `REMOTE_TERMINAL_DEVICE_MANAGE_READ`       |
| 撤销设备               | `REMOTE_TERMINAL_DEVICE_WRITE`             |

## 常见操作

1. 先创建套餐模板，填写计费单元和价格，保存后发布。
2. 在权益标签中为目标用户分配套餐，设置设备上限和终端上限。
3. 通知用户在「我的远程终端套餐」页获取注册令牌，按指引在设备上安装 Agent 完成绑定。
4. 如需回收某台设备，在设备标签中找到并撤销。

## 说明

- 所有写入操作（创建、编辑、发布、删除、分配）均需通过 **二次验证步骤（step-up）**。
- 套餐发布后对所有用户可见，用户可自行领取（`POST /remote-terminal/products/me/entitlements/claim`）。
- 权益支持续期和升级（调整设备 / 终端数量）。
- **管理员撤销设备不受解绑频率限制** — 管理员可随时撤销任意设备，不受速率限制约束。
- **限制上限大幅提高（最高 999999）** — 管理员可根据特殊需求设置远超常规范围的设备和终端上限。
- 权益表格中提供专用的 **调整限制** 操作，可快速修改设备 / 终端限制，无需打开完整编辑表单。
- 调整限制对话框中还包含 **重置计数** 按钮，可重置用户的设备解绑频率窗口，让用户能立即再次自行解绑设备。

## 相关页面

- `relay-settings`
- `user-management`
