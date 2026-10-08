# RAM (资源访问管理)

RAM 是授权与访问控制中心，用于创建子用户、定义角色、编写权限策略并进行绑定。所有变更操作均需通过 2FA 二次验证，且角色/策略/绑定变更会触发安全通知事件。

## 功能概览

- **RAM 用户** — 主账号下的子账号，拥有独立的登录凭据。
- **RAM 角色** — 命名的权限集合，可配置信任策略和会话时长。
- **权限策略** — 可复用的自定义权限列表，可绑定到用户、角色或用户组。
- **角色绑定** — 将角色授予用户或用户组。
- **策略绑定** — 将权限策略附加到用户、角色或用户组。
- **角色会话** — 用户扮演角色后产生的活跃会话。
- **授权概览** — 查看用户的最终有效权限（综合所有来源）。

## 页面结构

RAM 控制台使用独立 URL 组织概览、身份管理、权限管理和会话，不需要依赖单一大页面中的标签页。旧版带 `tab` 参数的用户、角色、绑定、策略、授权和会话链接会跳转到对应页面。

### 用户

创建和管理 RAM 子用户。每个用户可拥有控制台访问、API 访问密钥或两者兼备。

- 显示名称、RAM 用户名、邮箱、所属组、状态和创建时间。
- 支持自定义密码或自动生成随机密码。
- 支持首次登录强制修改密码。
- 密码仅在创建成功时展示一次，请及时复制保存。

### 角色

定义命名的权限角色。

- 角色名称、描述、最大会话时长。
- 权限通过绑定的策略继承。
- 信任策略限制哪些实体可以扮演该角色。

### 策略

创建可复用的权限列表，可绑定到多个目标。

- 策略名称、描述、类型（系统/自定义）。
- 从权限分类树中勾选所需权限。
- 点击"绑定列表"查看和解除已有绑定。
- 支持绑定到用户、角色和用户组。

### 会话

监控活跃的角色会话。

- 查看谁扮演了哪个角色、会话名称、过期时间。
- 可撤销不再需要的会话。

### 授权

选择用户查看其完整有效权限。

- 用户直接分配的权限。
- 用户组继承的权限。
- 角色绑定的权限。
- 策略绑定的权限。
- 被排除的权限。

## 所需权限

| 操作              | 所需权限             |
| ----------------- | -------------------- |
| 查看 RAM 用户列表 | `RAM_USER_READ`      |
| 创建 RAM 用户     | `RAM_USER_CREATE`    |
| 更新 RAM 用户     | `RAM_USER_UPDATE`    |
| 删除 RAM 用户     | `RAM_USER_DELETE`    |
| 查看 RAM 角色列表 | `RAM_ROLE_READ`      |
| 创建 RAM 角色     | `RAM_ROLE_CREATE`    |
| 更新 RAM 角色     | `RAM_ROLE_UPDATE`    |
| 删除 RAM 角色     | `RAM_ROLE_DELETE`    |
| 查看角色绑定      | `RAM_BINDING_READ`   |
| 创建角色绑定      | `RAM_BINDING_CREATE` |
| 删除角色绑定      | `RAM_BINDING_DELETE` |
| 查看权限策略      | `RAM_POLICY_READ`    |
| 创建权限策略      | `RAM_POLICY_CREATE`  |
| 更新权限策略      | `RAM_POLICY_UPDATE`  |
| 删除权限策略      | `RAM_POLICY_DELETE`  |
| 绑定策略          | `RAM_POLICY_ATTACH`  |
| 解绑策略          | `RAM_POLICY_DETACH`  |
| 扮演角色          | `RAM_ASSUME_ROLE`    |
| 查看会话          | `RAM_SESSION_READ`   |
| 撤销会话          | `RAM_SESSION_REVOKE` |

## 安全说明

- **2FA 验证**: 所有创建、更新、删除、绑定、解绑操作均需 2FA 验证。
- **强制验证**: 删除用户、角色、策略以及解绑策略需要强制 2FA 验证（不接受受信任设备窗口）。
- **通知事件**: 所有 RAM 变更操作均会触发安全通知，请确保通知偏好中包含 RAM 相关事件。

## 常见操作流程

1. **创建 RAM 用户**: RAM 用户 → 创建用户 → 填写用户名和 RAM 用户名 → 选择访问方式 → 提交。
2. **定义角色**: 角色 → 创建角色 → 命名角色并设置会话时长 → 绑定策略。
3. **授权**: 将角色绑定到用户，或将策略直接附加到用户。
4. **权限审计**: 权限诊断 → 选择用户 → 查看其综合有效权限。

## IAM JSON 策略

策略编辑抽屉提供 **权限树** 和 **IAM JSON** 两种格式。选择 IAM JSON 后粘贴策略，点击 **校验 JSON** 由服务端检查；校验结果会提示显式 Deny 和过宽通配符。修改文本后之前的校验结果失效，保存时会先校验未验证的内容。已有 IAM 策略固定使用 JSON 格式，列表显示当前默认版本。更新携带原文档 hash，并发变更返回 409；请重新打开策略并核对变更后再保存。拥有策略读取权限时可加载服务端 Action 清单，将光标放入 Action 字符串内后选择 Action 插入。Resource 示例说明当前可用的全局和账户范围。**模拟授权** 抽屉接受同账户主体用户 ID、清单中的 Action 和 Resource，仅评估已保存策略，不包含编辑器未保存的内容。结果显示决策、原因和匹配标识，修改输入会清除结果。即使抽屉可见，调用模拟仍需要专用权限。在 IAM 策略行点击**版本历史**可分页查看不可变版本并预览 JSON。有更新权限时，可对非默认的自定义版本点击**恢复**并确认；操作需要主账号授权及二次验证，会立即改变所有绑定身份使用的权限。恢复发生冲突或失败后，需刷新并确认当前默认版本再重试。身份策略仅支持 `Version: "1"`、`Statement`、可选 `Sid`、`Effect`、`Action`、`Resource` 和可选 `Condition`。Statement 可为对象或数组，Action/Resource 可为字符串或数组。仅 `*` 为通配符，大小写敏感；未知字段、未知版本、Principal、NotAction、NotResource 和策略变量均拒绝，不会被忽略。阿里云 DNS Action 仅作为文档示例，不属于生产 Action 清单。

RAM 管理操作当前使用账户级 Resource：`acs:quyan:*:<主账号ID>:account`。Action 由服务端声明，目标资源归属仍单独检查。这些管理操作遵循配置的 legacy/shadow/enforce 切换模式；专用的模拟 Action 始终强制执行 IAM。

评估顺序是 **匹配的显式 Deny > 匹配的 Allow > 默认拒绝**。Action 与 Resource 必须同时匹配。用户、启用的用户组、绑定角色和有效角色会话的策略共同参与评估；旧用户排除权限转换为 Deny。账户归属、角色会话有效性和业务所有权检查仍保留。Action 来自服务端定义，不能由请求头覆盖；无法可靠解析 Resource 的请求被拒绝。

### 条件约束

`Condition` 支持字符串、数值、日期、布尔、IPv4/IPv6 和存在性运算符。`GET /v1/iam/catalog/condition-keys` 返回条件键、类型、允许的运算符和可用状态。当前可用属性包括客户端 IP、当前时间、User-Agent、HTTPS 状态及主体 ID、类型、账户；资源标签、资源组和 MFA 尚不可用，提交这些条件会被拒绝。User-Agent 由客户端提供，不应作为唯一的安全保证。

不同运算符与条件键之间为 AND，同一键多个值为 OR。`StringLike` 支持 `*` 和 `?`；Action/Resource 仍只支持 `*`。`IpAddress` 不包含网段首尾地址，`IpAddressIncludeBorder` 包含首尾地址。除了显式 `Null` 检查，匹配语句所需的属性缺失时会安全拒绝，包括条件 Deny；模拟器不提供真实 IP/HTTPS 等请求属性，会返回 `missing-condition-context`，不会猜测属性。

### 服务和资源目录

具有策略读取权限时，可调用 `GET /v1/iam/catalog/services`、`GET /v1/iam/catalog/services/{service}/actions` 和 `GET /v1/iam/catalog/resources` 获取本平台服务、操作分类与 ARN 模板。API 关联由服务端路由声明生成。目录中的 `legacy` 表示该操作仍使用旧权限兼容语义；资源模板用于描述资源格式，不表示所有接口已完成资源级授权。现有 Action 名称保持兼容，不会将 `ReadUser` 自动改名为 `GetUser`。

### JSON 诊断和 Schema

提供原始 JSON 文本给 `POST /v1/ram/policies/diagnose`（字段 `documentText`），可获得错误、安全警告、警告和建议。每条诊断含稳定错误码、JSON Pointer、从 1 开始的行号和列号。语法错误、重复键、原型键、未知字段、未知 Action、条件值错误和明确的跨账户 ARN 会阻止验证；过宽 Allow、IAM 管理授权、重复语句和资源类型不匹配会提示风险。诊断不回显策略中的任意值。

`GET /v1/iam/catalog/policy-schema` 提供从同一策略校验器生成的 JSON Schema，供编辑器和 AI 构造草稿。Schema 包含当前生产 Action、资源模板、已实现条件键和限制；目录及账户归属等自定义语义仍须经过服务端诊断。获取 Schema 需要策略读取权限，诊断需要策略创建或更新任一权限。验证通过只说明文档符合当前语法，返回的 `delegation: "not-evaluated"` 表示尚未证明操作者可以发布或委派；保存和绑定继续执行已有授权检查。

JSON 编辑器的“校验 JSON”会提交原始文本，并按错误、安全警告、警告和建议分组展示诊断；点击诊断可定位到对应文本位置。编辑内容后原有诊断和校验结果立即失效。“格式化已校验 JSON”先完成服务端校验，再格式化规范化后的文档；“下载 JSON Schema”可将当前规范提供给外部 AI 辅助编写草稿。

### API 和权限

- `POST /v1/ram/policies`：提供 name 和 document，或旧 permissions；不可同时提交两种格式。
- `POST /v1/ram/policies/validate`：提供 document，返回规范化文档、SHA-256 hash 和过宽通配符提示；需策略创建或更新任一权限。
- `GET /v1/ram/iam/actions`：查看 Action 清单；需策略读取权限。Action 清单只包含本平台已实现的 API；阿里云 DNS 策略示例仅用于说明兼容的 JSON 结构。
- `GET /v1/ram/policies/{policyId}/versions`：通过 `page`（默认 1）和 `pageSize`（默认 20，最大 100）分页查看不可变版本；返回 `items`、`total`、`page`、`pageSize`、`defaultVersionId` 和 `defaultDocumentHash`。需策略读取权限。
- `POST /v1/ram/policies/{policyId}/versions`：新增版本并设为默认；提交 document 和当前 expectedDocumentHash。首次转换旧策略可不传 hash；已有 IAM 版本时必需。需策略更新权限、2FA 和重放保护。
- `PUT /v1/ram/policies/{policyId}/default-version`：提交 versionId 和当前 expectedDocumentHash，恢复某个历史版本；需策略更新权限、强制 2FA 和重放保护。hash 过期返回 409，不覆盖其他更新。
- `POST /v1/ram/policies/simulate`：提交同账户 principalId、action、resource；单独要求 `quyan:iam:SimulatePolicy` 对账户资源的 Allow，策略读取权限不足以调用。仅返回决策、原因和匹配的策略/版本/语句标识，不返回策略内容或凭据。

IAM 文档的创建、更新、默认版本切换和绑定目前仅限拥有相应操作权限的账户所有者，并且部署必须已启用 enforce 模式。RAM 子用户不能委派 JSON 策略。系统托管策略不可通过这些版本接口修改。新 IAM 策略不能降级成旧权限数组。

### 部署与迁移边界

`IAM_AUTHORIZATION_MODE` 默认为 `legacy`：保持旧权限强制。`shadow` 仍由旧权限强制，只比较并审计 IAM 差异；`enforce` 对已接入的旧权限检查使用 IAM，授权数据异常时不退回旧逻辑。明确采用 IAM 中间件的接口（例如模拟器）始终强制 IAM。**当前并非全部 JWT 接口都完成了独立 Action/Resource 迁移，不能仅打开 enforce 就视为全量覆盖。**

旧策略转换时保留旧权限字段，回滚配置无需删除版本数据；新建纯 JSON 策略在 legacy 模式下不会凭空获得旧权限。授权结果不使用缓存，策略解绑、禁用和会话撤销在后续请求中重新读取。列表行过滤、批量操作逐资源检查和业务归属检查不能被账户级授权替代；全量路由切换前应逐个完成迁移与差异校验。

## 相关页面

- `user-management`
- `group-management`
- `permission-management`
- `access-key-management`
