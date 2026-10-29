# 兑换码管理

此页面用于创建、复制和追踪兑换码。

## 页面用途

- 批量生成兑换码。
- 查看兑换码状态。
- 删除不再需要的兑换码。
- 支持用户充值或活动发放。

## 你会看到什么

### 列表信息

- 兑换码内容。
- 未使用、已使用、已过期等状态。
- 分页列表。

### 管理动作

- 批量创建。
- 点击复制。
- 删除兑换码。

## 常见操作

1. 设置每个兑换码的金额和数量；每个金额须为 0.01 至 100000，管理页面每次可创建 1 至 100 个。需要限制使用期限时，再选择过期时间。
2. 生成成功后页面返回列表第一页；点击列表中的兑换码逐个复制，再交给预期收款人。查看列表需要独立的读取权限，创建权限本身不包含该权限。
3. 在用户反馈无法兑换时，先检查状态是否已使用或过期。
4. 删除错误生成或不再需要的兑换码。页面点击删除后直接提交，请先确认目标；未使用的兑换码删除后将无法兑换。

过期时间可留空；填写时必须晚于当前时间。通过 API 提交时使用带时区的 ISO datetime 格式。

## 所需权限

| 操作               | 所需权限                 |
| ------------------ | ------------------------ |
| 查看兑换码         | `REDEMPTION_CODE_READ`   |
| 创建兑换码（批量） | `REDEMPTION_CODE_CREATE` |
| 删除兑换码         | `REDEMPTION_CODE_DELETE` |

## 资源级读取

IAM 强制模式下，列表接口 `GET /v1/redemption-codes/list` 使用 `quyan:redemption_code:ListCodes`。认证主体还必须属于有效的部署管理全局组，且该组具有 `REDEMPTION_CODE_READ`；个人附加权限、私有用户组或账号所有者身份不能替代这一资格。

列表集合需要允许 `acs:platform:*:platform:redemption-code-control/default`；每个兑换码使用 `acs:platform:*:platform:redemption-code/<兑换码 ID>`。只有获准记录会返回兑换码原文、金额和使用状态。匹配的 Deny 优先，未获准记录不会出现在列表、分页或总数中。此处按兑换码 ID 授权，不应把兑换码原文写入资源 ARN。

强制模式的 `page` 从 1 开始，最大 10000；`pageSize` 默认 50，最大 100。旧权限和影子模式保留原默认分页。禁用记录不会返回。列表按创建时间从新到旧排列，读取期间记录内容、授权、资格或角色会话变化，或条件不再满足时，请求会失败，不返回旧快照。

## 资源级创建与删除

强制模式下，批量创建使用 `quyan:redemption_code:CreateCodes`，需要部署管理全局组的 `REDEMPTION_CODE_CREATE` 资格。策略须允许集合 `acs:platform:*:platform:redemption-code-control/default` 及新记录资源 `acs:platform:*:platform:redemption-code/<兑换码 ID>`；新记录 ID 由服务端生成，通常以 `acs:platform:*:platform:redemption-code/*` 声明创建范围。集合授权不覆盖记录级 Deny。API 每批最多 1000 条；管理页面每批最多 100 条。任一记录被拒绝或提交前授权失效，整批回滚，不返回或留下部分生成结果。

删除使用 `quyan:redemption_code:DeleteCode`，需要部署管理全局组的 `REDEMPTION_CODE_DELETE` 资格以及目标记录 ARN 的 Allow。删除过程中目标内容或授权发生变化时，操作被拒绝。创建和删除都保留二次验证及重放保护；创建权限不替代列表读取权限。

## 说明

- 每个管理员兑换码只能使用一次，兑换成功后对应金额记入用户余额。请妥善保管兑换码，仅向预期收款人提供。
- 状态异常时，可联动查看余额记录与业务日志。
- 用户输入兑换码的页面通常在 [账户余额与转出]({{DOCS_BASE_URL}}/zh-CN/balance-history)。

## 相关页面

- [账户余额与转出]({{DOCS_BASE_URL}}/zh-CN/balance-history)
- [余额管理]({{DOCS_BASE_URL}}/zh-CN/balance-management)
