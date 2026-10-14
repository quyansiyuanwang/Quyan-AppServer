# 我的远程终端产品

此页面用于浏览已发布的远程终端产品方案、购买或领取权益，以及管理已注册的设备。

启用 IAM 强制模式后，解绑使用 `quyan:remote_terminal:RevokeMyDeviceBinding`，查看解绑提示使用 `quyan:remote_terminal:GetMyUnbindReminder`。两个操作均需获准访问本人绑定的 `acs:remote-terminal:*:<accountId>:product-binding/<userId>/<bindingId>` 和所属权益的 `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>`；访问其他用户的绑定始终拒绝。已登录用户可查看自己的解绑提示，解绑仍需对应权限。次数限制按权益共享，并发解绑也不会超过剩余额度；操作期间授权或次数配置发生变化会使操作失败。

本人注册令牌轮换使用 `quyan:remote_terminal:RotateMyRegistrationToken`，同时检查权益 `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>` 和令牌 `acs:remote-terminal:*:<accountId>:product-registration-token/<userId>/<entitlementId>/<tokenId>`。登录身份保留本人轮换能力，匹配的显式拒绝仍会阻止操作；首次创建可对当前权益下的令牌使用 `*`。轮换失败会保留原令牌，成功后需用新令牌更新 Agent 配置。

安装令牌签发使用 `quyan:remote_terminal:GetMyInstallToken`，资源为 `acs:remote-terminal:*:<accountId>:product-entitlement/<userId>/<entitlementId>`。已登录用户保留本人权益的签发能力，匹配的显式拒绝仍会阻止操作；其他用户权益或设备额度为零时不能签发。服务端在返回令牌前复查权益和授权，操作期间变化时不返回凭据。安装令牌仍按响应中的到期时间失效，安装协议保持不变。

IAM 强制模式下，购买及续期使用 `quyan:remote_terminal:ClaimPublishedTemplate`，同时检查本人用户资源、已发布商品 `acs:remote-terminal:*:<accountId>:published-template/<userId>/<templateId>` 和最终权益。商品资源表示向该身份开放的已发布套餐，不授予平台模板管理权限。认证用户保留购买本人资源的能力，匹配的显式 Deny 仍可阻止购买。余额扣减、交易流水与权益变更在同一事务中提交；授权失败时不会返回权益或凭据，扣款一并回滚。续期只收取本次续期或升级费用，权益中的购买金额记录累计值。购买结果不返回注册凭据，获取凭据需另行使用注册令牌轮换操作。

个人权益列表使用 `quyan:remote_terminal:ListMyEntitlements`，在计算总数及分页之前逐项检查 `product-entitlement` 资源，拒绝的权益不会出现在列表中。模板名称、注册令牌元数据及已注册设备数量还需要同一 Action 对对应关联资源的读取权限；权限不完整时省略相关字段。IAM 强制模式下，列表不会返回注册令牌明文，获取凭据需使用单独授权的令牌轮换操作。列表始终限制为当前身份的权益，即使其他用户属于同一账号也不会混入。

个人设备列表使用 `quyan:remote_terminal:ListMyDevices`，先逐项检查 `product-binding` 资源，再计算总数和分页，拒绝的设备不会出现在列表中。父权益被拒绝时省略权益名称，注册令牌资源被拒绝时省略令牌引用。列表只返回支持的 Shell 名称，不读取心跳凭据或完整主机快照。设备和所属权益必须归属于当前身份，归属关系不一致时拒绝读取。

在 IAM 强制模式下，已发布套餐列表使用 `quyan:remote_terminal:ListPublishedTemplates`，逐项检查 `acs:remote-terminal:*:<accountId>:published-template/<userId>/<templateId>`。只显示已启用、已发布且当前身份可访问的套餐。显式 Deny 可隐藏指定套餐或全部套餐。查看套餐不授予购买或管理平台模板的权限，这些操作使用独立 Action。

## 页面用途

- 浏览已发布的远程终端产品方案与价格。
- 购买新方案或将升级合并到已有权益中。
- 查看当前权益、有效期、设备/终端配额及注册 Token。
- 管理已绑定设备并按需解绑。
- 生成远程终端 Agent 的安装命令。

## 你会看到什么

### 已发布方案

- 每个已发布方案的卡片，包含名称、描述与单价。
- 计费单位（天/周/月）、购买限制及最低购买要求。
- 购买表单：方案名称、购买模式（新购或合并）、购买单位数、设备数、终端数。
- 预估价格及费用明细（续费 vs 升级费用）。
- **领取**按钮确认并完成购买。

### 我的权益

- 表格列出活跃、待生效、已过期和已禁用的权益。
- 每行显示：方案名称、模板、有效期、持续天数、设备/终端限制。
- 注册 Token（脱敏显示），支持复制与轮换。
- **连接设备**按钮跳转至远程终端控制台。

### 我的设备

- 表格列出已注册设备：主机名、设备 ID、所属权益、平台、最后在线时间。
- **连接设备**操作打开终端会话。
- **解绑**操作，附带解绑提醒对话框（剩余次数、冷却时间、已用次数）。

## 常见操作

1. 浏览方案并调整购买表单以匹配需求。
2. 领取免费方案或购买付费方案 — 确认预估价格后继续。
3. 复制或轮换权益的注册 Token。
4. 打开安装 Agent 对话框，生成对应操作系统与架构的安装命令。
5. 解绑不再需要的设备（注意冷却时间与次数限制）。

## 说明

- 合并模式允许在已有权益的基础上升级，而非重新购买。
- 免费方案（预估价格为 0）可零成本领取。
- Token 轮换后旧 Token 立即失效，需同步更新 Agent 配置。
- 设备解绑受窗口次数限制与冷却时间约束。

## 相关页面

- `remote-terminal`
- `remote-terminal-management`
- `balance-history`
